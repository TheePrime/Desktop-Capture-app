const { app, BrowserWindow, ipcMain, desktopCapturer, screen, dialog, shell } = require('electron');
const path = require('path');
const fsPromises = require('fs').promises;
const fs = require('fs');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const os = require('os');

let mainWindow = null;
let isTracking = false;
let trackingInterval = null;
let currentHz = 1;
let wsServer = null;
let logWatcher = null;
let watchedFile = null;
let prevLen = 0;
let backendProcess = null;

// Screenshot capture settings
const SCREENSHOT_QUALITY = 0.8;

// Use Documents folder for easy access to screenshots
function getDataRoot() {
  const documentsPath = path.join(os.homedir(), 'Documents', 'DesktopCapture');
  return documentsPath;
}

// Function to start the backend service
function startBackendService() {
  try {
    let backendPath;
    
    // In production (packaged app), backend is in resources
    if (app.isPackaged) {
      backendPath = path.join(process.resourcesPath, 'backend_service.exe');
    } else {
      // In development, use the dist folder from backend build
      backendPath = path.join(__dirname, '..', 'backend', 'dist', 'backend_service.exe');
      
      // If not built yet, skip (user must run uvicorn manually)
      if (!fs.existsSync(backendPath)) {
        console.log('[Backend] Development mode - backend_service.exe not found');
        console.log('[Backend] Please run: cd backend && uvicorn main:app --reload');
        return;
      }
    }
    
    console.log('[Backend] Starting backend service:', backendPath);
    
    // Start the backend process
    backendProcess = spawn(backendPath, [], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    backendProcess.stdout.on('data', (data) => {
      console.log(`[Backend] ${data.toString().trim()}`);
    });
    
    backendProcess.stderr.on('data', (data) => {
      console.error(`[Backend ERROR] ${data.toString().trim()}`);
    });
    
    backendProcess.on('close', (code) => {
      console.log(`[Backend] Process exited with code ${code}`);
      backendProcess = null;
    });
    
    backendProcess.on('error', (err) => {
      console.error('[Backend] Failed to start:', err);
      backendProcess = null;
    });
    
    console.log('[Backend] Backend service started successfully');
  } catch (error) {
    console.error('[Backend] Error starting backend:', error);
  }
}

// Function to stop the backend service
function stopBackendService() {
  if (backendProcess) {
    console.log('[Backend] Stopping backend service...');
    try {
      backendProcess.kill();
      backendProcess = null;
      console.log('[Backend] Backend service stopped');
    } catch (error) {
      console.error('[Backend] Error stopping backend:', error);
    }
  }
}

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
      const dataRoot = getDataRoot();
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
  ipcMain.handle('tracking:start', async () => { 
    startTrackingLoop(); 
    // Start backend screenshot capture
    try {
      const https = require('http');
      const postData = '';
      const options = {
        hostname: '127.0.0.1',
        port: 8000,
        path: '/start',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            console.log('[Electron] Backend /start response:', data);
            resolve(data);
          });
        });
        req.on('error', (e) => {
          console.error('[Electron] Failed to start backend:', e);
          reject(e);
        });
        req.write(postData);
        req.end();
      });
    } catch (e) {
      console.error('[Electron] Error calling backend /start:', e);
    }
    return { success: true }; 
  });
  ipcMain.handle('tracking:stop', async () => { 
    stopTrackingLoop(); 
    // Stop backend screenshot capture
    try {
      const https = require('http');
      const postData = '';
      const options = {
        hostname: '127.0.0.1',
        port: 8000,
        path: '/stop',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            console.log('[Electron] Backend /stop response:', data);
            resolve(data);
          });
        });
        req.on('error', (e) => {
          console.error('[Electron] Failed to stop backend:', e);
          reject(e);
        });
        req.write(postData);
        req.end();
      });
    } catch (e) {
      console.error('[Electron] Error calling backend /stop:', e);
    }
    return { success: true }; 
  });
  ipcMain.handle('tracking:setHz', async (_event, hz) => { 
    const val = parseFloat(hz);
    if (!Number.isNaN(val) && val > 0) {
      currentHz = val;
      // Update backend Hz
      try {
        const https = require('http');
        const postData = JSON.stringify({ hz: val });
        const options = {
          hostname: '127.0.0.1',
          port: 8000,
          path: '/config',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        
        await new Promise((resolve, reject) => {
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              console.log('[Electron] Backend /config response:', data);
              resolve(data);
            });
          });
          req.on('error', (e) => {
            console.error('[Electron] Failed to update backend Hz:', e);
            reject(e);
          });
          req.write(postData);
          req.end();
        });
      } catch (e) {
        console.error('[Electron] Error calling backend /config:', e);
      }
      if (isTracking) {
        restartTrackingLoop();
      }
    }
    return { success: true };
  });
  ipcMain.handle('take-screenshot', async () => await captureScreenshot());

  // Settings Handlers
  ipcMain.handle('settings:getDataPath', async () => {
    return getDataPath();
  });

  ipcMain.handle('settings:browseDataPath', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Data Folder',
      defaultPath: getDataPath()
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const newPath = result.filePaths[0];
      // Save the custom path to config
      app.setPath('userData', newPath);
      
      // Update backend config to use new path
      try {
        const response = await fetch('http://127.0.0.1:8000/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ output_base: path.join(newPath, 'data') })
        });
        
        if (!response.ok) {
          console.error('[Settings] Failed to update backend config');
        }
      } catch (err) {
        console.error('[Settings] Backend not running:', err);
      }
      
      return newPath;
    }
    return null;
  });

  ipcMain.handle('settings:resetDataPath', async () => {
    // Reset to default location
    const defaultPath = app.getPath('userData');
    app.setPath('userData', defaultPath);
    
    // Update backend
    try {
      await fetch('http://127.0.0.1:8000/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_base: path.join(defaultPath, 'data') })
      });
    } catch (err) {
      console.error('[Settings] Backend not running:', err);
    }
    
    return defaultPath;
  });

  ipcMain.handle('settings:openDataFolder', async () => {
    const dataPath = getDataPath();
    const dataFolder = path.join(dataPath, 'data');
    
    // Create folder if it doesn't exist
    try {
      await fsPromises.mkdir(dataFolder, { recursive: true });
    } catch (err) {
      console.error('[Settings] Failed to create data folder:', err);
    }
    
    // Open in file explorer
    shell.openPath(dataFolder);
  });
}

// Helper function to get current data path
function getDataPath() {
  return app.getPath('userData');
}

app.whenReady().then(() => {
  // Start backend service first
  startBackendService();
  
  // Wait a moment for backend to initialize
  setTimeout(() => {
    setupWebSocketServer();
    createWindow();
  }, 2000);
  
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
  stopBackendService();  // Stop backend when app closes
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
    const screenshotsDir = path.join(getDataRoot(), dayFolder, 'screenshots');
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
  // Determine clicks.ndjson path for today - using Documents folder
  const dataRoot = getDataRoot();
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
  console.log('[Electron] Tracking started - screenshots captured by backend only');
  // No screenshot display loop needed - backend handles all screenshot capture
  // Screenshots are only shown in Activities view when attached to click data
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


