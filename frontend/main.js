const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const WebSocket = require('ws');

let mainWindow = null;
let isTracking = false;
let trackingInterval = null;
let currentHz = 1;
let wsServer = null;

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
  
  // Register all IPC handlers
  ipcMain.handle('tracking:status', () => {
    return {
      isTracking,
      hz: currentHz
    };
  });

  ipcMain.handle('tracking:start', () => {
    isTracking = true;
    return { success: true };
  });

  ipcMain.handle('tracking:stop', () => {
    isTracking = false;
    return { success: true };
  });

  ipcMain.handle('tracking:setHz', (_event, hz) => {
    currentHz = parseFloat(hz);
    return { success: true };
  });

  ipcMain.handle('take-screenshot', async () => {
    return await captureScreenshot();
  });
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
  if (process.platform !== 'darwin') app.quit();
});

// Take screenshot on demand
ipcMain.handle('take-screenshot', async () => {
  return await captureScreenshot();
});

// Handle click data from extension
ipcMain.on('click-data', async (event, clickData) => {
  if (mainWindow && isTracking) {
    const screenshot = await captureScreenshot();
    mainWindow.webContents.send('click-captured', {
      ...clickData,
      screenshot
    });
  }
});

// Status check
ipcMain.handle('tracking:status', () => {
  return {
    isTracking,
    hz: currentHz
  };
});

// Start tracking
ipcMain.handle('tracking:start', () => {
  isTracking = true;
  return { success: true };
});

// Stop tracking
ipcMain.handle('tracking:stop', () => {
  isTracking = false;
  return { success: true };
});

// Update capture rate
ipcMain.handle('tracking:setHz', (_event, hz) => {
  currentHz = parseFloat(hz);
  return { success: true };
});


