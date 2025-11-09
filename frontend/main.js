const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Use global fetch if available, otherwise try to fall back to node-fetch
let fetchImpl = globalThis.fetch || undefined;
if (!fetchImpl) {
  try {
    const nf = require('node-fetch');
    fetchImpl = nf.default || nf;
  } catch (e) {
    // leave undefined; handlers will surface errors to the UI
    fetchImpl = undefined;
  }
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

async function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 540,
    webPreferences: {
      preload: undefined,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Notify backend when window is ready
  await notifyBackendStatus(true);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  // Notify backend we're shutting down
  await notifyBackendStatus(false);
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('backend:status', async () => {
  try {
    if (!fetchImpl) throw new Error('fetch not available in main process');
    const res = await fetchImpl(`${BACKEND}/status`);
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('backend:start', async () => {
  try {
    if (!fetchImpl) throw new Error('fetch not available in main process');
    const res = await fetchImpl(`${BACKEND}/start`, { method: 'POST' });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('backend:stop', async () => {
  try {
    if (!fetchImpl) throw new Error('fetch not available in main process');
    const res = await fetchImpl(`${BACKEND}/stop`, { method: 'POST' });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('backend:setHz', async (_evt, hz) => {
  try {
    if (!fetchImpl) throw new Error('fetch not available in main process');
    const res = await fetchImpl(`${BACKEND}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hz }),
    });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});

// New: endpoint to check for recent screenshots
ipcMain.handle('backend:recentScreenshots', async (_evt, seconds = 1.0) => {
  try {
    if (!fetchImpl) throw new Error('fetch not available in main process');
    const res = await fetchImpl(`${BACKEND}/recent_screenshots?seconds=${seconds}`);
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});


