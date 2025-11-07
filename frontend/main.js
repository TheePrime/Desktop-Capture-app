const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const BACKEND = 'http://127.0.0.1:8000';

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
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('backend:status', async () => {
  try {
    const res = await fetch(`${BACKEND}/status`);
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('backend:start', async () => {
  try {
    const res = await fetch(`${BACKEND}/start`, { method: 'POST' });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('backend:stop', async () => {
  try {
    const res = await fetch(`${BACKEND}/stop`, { method: 'POST' });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('backend:setHz', async (_evt, hz) => {
  try {
    const res = await fetch(`${BACKEND}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hz }),
    });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
});


