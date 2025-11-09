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
                    mainWindow.webContents.send('click-captured', {
                        ...data,
                        screenshot
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
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'],
      thumbnailSize: {
        width: 1920,
        height: 1080
      }
    });

    // Combine all screenshots into one base64 string
    const screenshots = sources.map(source => {
      return source.thumbnail.toDataURL();
    });

    return screenshots[0]; // For now just return the primary display
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
  ipcMain.handle('tracking:start', () => { isTracking = true; return { success: true }; });
  ipcMain.handle('tracking:stop', () => { isTracking = false; return { success: true }; });
  ipcMain.handle('tracking:setHz', (_event, hz) => { currentHz = parseFloat(hz); return { success: true }; });
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


