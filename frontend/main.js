const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const fsPromises = require('fs').promises;
const fs = require('fs');
const WebSocket = require('ws');

let mainWindow = null;
let isTracking = false;
let trackingInterval = null;
let currentHz = 1;
let wsServer = null;
let logWatcher = null;
let watchedFile = null;
let prevLen = 0;

// Screenshot capture settings
const SCREENSHOT_QUALITY = 0.8;

// Create WebSocket server for extension communication
function setupWebSocketServer() {
    wsServer = new WebSocket.Server({ port: 8000 });
    
    wsServer.on('connection', (ws) => {
        console.log('Extension connected');
        
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                if (mainWindow && isTracking) {
                    const screenshot = await captureScreenshot();
                    // save to disk for persistence
                    let screenshot_path = null;
                    if (screenshot) {
                      screenshot_path = await saveScreenshotToDisk(screenshot);
                    }
                    mainWindow.webContents.send('click-captured', {
                      ...data,
                      screenshot,
                      screenshot_path
                    });
                }
            } catch (err) {
                console.error('Error handling WebSocket message:', err);
            }
        });
    });
}

const BACKEND = 'http://127.0.0.1:8000';

// Track if we've notified backend of app status
let backendNotified = false;

async function notifyBackendStatus(active) {
  try {
    if (!fetchImpl) return;
    const res = await fetchImpl(`${BACKEND}/electron_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    });
    backendNotified = active;
    console.log('[Electron] Backend status notification:', await res.json());
  } catch (e) {
    console.error('[Electron] Failed to notify backend:', e);
  }
}

// Capture screenshot of all displays
async function captureScreenshot() {
  try {
    // Prefer renderer capture path which can use getUserMedia to include the cursor.
    if (mainWindow && mainWindow.webContents) {
      try {
        const dataUrl = await mainWindow.webContents.executeJavaScript('window.captureScreenWithCursor && window.captureScreenWithCursor()', true);
        if (dataUrl) return dataUrl;
      } catch (e) {
        console.warn('[Electron] captureScreenshot: renderer capture failed, falling back to thumbnail:', e);
      }
    }

    // Fallback: desktopCapturer thumbnail (may not include cursor on some platforms)
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'],
      thumbnailSize: {
        width: 1920,
        height: 1080
      }
    });
    const screenshots = sources.map(source => source.thumbnail.toDataURL());
    // If backend has recently saved a screenshot (which includes a cursor overlay via backend/capture.py),
    // prefer that image to ensure the cursor is visible. Look for recent files in data/<today>/screenshots.
    try {
      const dataRoot = path.resolve(__dirname, '..', 'data');
      const dayFolder = getTodayFolder();
      const shotsDir = path.join(dataRoot, dayFolder, 'screenshots');
      const maxAgeMs = 3000; // 3 seconds
      const now = Date.now();
      let files = [];
      try {
        files = await fsPromises.readdir(shotsDir);
      } catch (e) {
        files = [];
      }
      let newest = null;
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.png')) continue;
        try {
          const st = await fsPromises.stat(path.join(shotsDir, f));
          if (!newest || st.mtimeMs > newest.mtimeMs) {
            newest = { name: f, mtimeMs: st.mtimeMs };
          }
        } catch (e) {
          continue;
        }
      }
      if (newest && now - newest.mtimeMs <= maxAgeMs) {
        try {
          const buf = await fsPromises.readFile(path.join(shotsDir, newest.name));
          return `data:image/png;base64,${buf.toString('base64')}`;
        } catch (e) {
          // fall through to thumbnail
        }
      }
    } catch (e) {
      console.warn('[Electron] captureScreenshot: recent backend screenshot check failed:', e);
    }

    return screenshots[0] || null;
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    return null;
  }
}

// Create main application window
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Register all IPC handlers (only once in app lifecycle)
  registerIpcHandlersOnce();

  // Start watching backend logs once window is ready to receive events
  startLogWatcher().catch(err => console.error('[Electron] Log watcher failed to start:', err));
}

// Ensure we only register handlers once
let ipcHandlersRegistered = false;
function registerIpcHandlersOnce() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  ipcMain.handle('tracking:status', () => ({ isTracking, hz: currentHz }));
  ipcMain.handle('tracking:start', () => { startTrackingLoop(); return { success: true }; });
  ipcMain.handle('tracking:stop', () => { stopTrackingLoop(); return { success: true }; });
  ipcMain.handle('tracking:setHz', (_event, hz) => { 
    const val = parseFloat(hz);
    if (!Number.isNaN(val) && val > 0) {
      currentHz = val;
      if (isTracking) {
        restartTrackingLoop();
      }
    }
    return { success: true };
  });
  ipcMain.handle('take-screenshot', async () => await captureScreenshot());
}

app.whenReady().then(() => {
  setupWebSocketServer();
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  if (wsServer) {
    wsServer.close();
  }
  if (logWatcher) {
    try { logWatcher.close(); } catch {}
  }
  stopTrackingLoop();
  if (process.platform !== 'darwin') app.quit();
});

// Remove duplicate global registrations; events will be wired via registerIpcHandlersOnce()

function getTodayFolder() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function ensureFile(filePath) {
  try {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.appendFile(filePath, '');
  } catch {}
}

async function ensureDir(dirPath) {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (e) {
    // ignore
  }
}

// Save a dataURL (base64 PNG) to disk and return absolute path
async function saveScreenshotToDisk(dataUrl) {
  try {
    if (!dataUrl) return null;
    const dayFolder = getTodayFolder();
    const screenshotsDir = path.join(path.resolve(__dirname, '..', 'data'), dayFolder, 'screenshots');
    await ensureDir(screenshotsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `shot-${ts}.png`;
    const filePath = path.join(screenshotsDir, filename);

    const matches = dataUrl.match(/^data:(image\/(png|jpeg));base64,(.+)$/);
    let buffer;
    if (matches && matches[3]) {
      buffer = Buffer.from(matches[3], 'base64');
    } else {
      // If it's not a data URL, maybe it's already a file path
      return null;
    }

    await fsPromises.writeFile(filePath, buffer);
    return filePath;
  } catch (e) {
    console.error('[Electron] Failed to save screenshot to disk:', e);
    return null;
  }
}

async function startLogWatcher() {
  // Determine clicks.ndjson path for today
  const dataRoot = path.resolve(__dirname, '..', 'data');
  const dayFolder = getTodayFolder();
  const filePath = path.join(dataRoot, dayFolder, 'clicks.ndjson');
  watchedFile = filePath;

  await ensureFile(filePath);
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    prevLen = content.length; // don't emit existing lines on startup
  } catch {
    prevLen = 0;
  }

  // Watch the file for appends
  logWatcher = fs.watch(filePath, { persistent: true }, async (eventType) => {
    if (eventType !== 'change') return;
    try {
      const content = await fsPromises.readFile(filePath, 'utf8');
      if (content.length <= prevLen) return;
      const delta = content.slice(prevLen);
      prevLen = content.length;
      const lines = delta.split(/\r?\n/).filter(l => l.trim().length > 0);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (mainWindow) {
            mainWindow.webContents.send('click-captured', rec);
          }
        } catch (e) {
          console.warn('[Electron] Failed to parse NDJSON line:', e);
        }
      }
    } catch (e) {
      console.error('[Electron] Error reading log file:', e);
    }
  });
}

function startTrackingLoop() {
  if (isTracking) {
    console.log('[Electron] Already tracking, skipping start');
    return; // already running
  }
  isTracking = true;
  const intervalMs = Math.max(100, Math.round(1000 / (currentHz || 1)));
  console.log(`[Electron] Starting screenshot display loop at ${currentHz} Hz (interval: ${intervalMs}ms)`);
  if (trackingInterval) clearInterval(trackingInterval);
  trackingInterval = setInterval(async () => {
    try {
      // Read the latest screenshot from backend's saved files
      const dataRoot = path.resolve(__dirname, '..', 'data');
      const dayFolder = getTodayFolder();
      const shotsDir = path.join(dataRoot, dayFolder);  // Backend saves directly to data/YYYY-MM-DD/
      
      let files = [];
      try {
        files = await fsPromises.readdir(shotsDir);
      } catch (e) {
        console.warn('[Electron] Cannot read screenshots folder:', e);
        return;
      }
      
      // Find the newest .png file from backend
      let newest = null;
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.png')) continue;
        try {
          const fullPath = path.join(shotsDir, f);
          const st = await fsPromises.stat(fullPath);
          if (!newest || st.mtimeMs > newest.mtimeMs) {
            newest = { name: f, path: fullPath, mtimeMs: st.mtimeMs };
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!newest) {
        console.warn('[Electron] No screenshots found');
        return;
      }
      
      // Check if this is a new screenshot (within last 2 seconds)
      const age = Date.now() - newest.mtimeMs;
      if (age > 3000) {
        // Too old, backend may not be running
        return;
      }
      
      // Read and send to renderer
      try {
        const buf = await fsPromises.readFile(newest.path);
        const screenshot = `data:image/png;base64,${buf.toString('base64')}`;
        
        if (mainWindow) {
          mainWindow.webContents.send('screenshot-tick', {
            timestamp: new Date().toISOString(),
            screenshot,
            screenshot_path: newest.path
          });
        }
      } catch (e) {
        console.error('[Electron] Failed to read screenshot:', e);
      }
    } catch (e) {
      console.error('[Electron] Screenshot display loop error:', e);
    }
  }, intervalMs);
  console.log('[Electron] Screenshot display loop started - showing backend screenshots');
}

function stopTrackingLoop() {
  isTracking = false;
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
}

function restartTrackingLoop() {
  if (!isTracking) return;
  stopTrackingLoop();
  startTrackingLoop();
}


