const { ipcRenderer } = require('electron');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const refreshBtn = document.getElementById('refreshBtn');
const setHzBtn = document.getElementById('setHzBtn');
const hzInput = document.getElementById('hzInput');
const statusPre = document.getElementById('statusPre');

async function refresh() {
  const status = await ipcRenderer.invoke('backend:status');
  statusPre.textContent = JSON.stringify(status, null, 2);
}

startBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('backend:start');
  await refresh();
});

stopBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('backend:stop');
  await refresh();
});

setHzBtn.addEventListener('click', async () => {
  const hz = parseFloat(hzInput.value || '1');
  await ipcRenderer.invoke('backend:setHz', hz);
  await refresh();
});

refreshBtn.addEventListener('click', refresh);

refresh();


