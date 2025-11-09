const { ipcRenderer, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// UI Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const setHzBtn = document.getElementById('setHzBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const hzInput = document.getElementById('hzInput');
const status = document.getElementById('status');
const navActivities = document.getElementById('navActivities');
const navScreenshots = document.getElementById('navScreenshots');
const viewActivities = document.getElementById('viewActivities');
const viewScreenshots = document.getElementById('viewScreenshots');
const activityList = document.getElementById('activityList');
const previewContent = document.getElementById('previewContent');
const previewDetails = document.getElementById('previewDetails');
const dataTable = document.getElementById('dataTable');
const screenshotGrid = document.getElementById('screenshotGrid');

// State
let updateInterval;
let clickData = [];
let selectedEntryId = null;
let screenshotsData = [];
const MAX_SCREENSHOTS = 300;
let currentView = 'activities';

// Load saved data on startup
try {
    clickData = JSON.parse(localStorage.getItem('clickData') || '[]');
    refreshActivityList();
    renderDataTable();
} catch (e) {
    console.error('Failed to load saved data:', e);
    clickData = [];
}

try {
    screenshotsData = JSON.parse(localStorage.getItem('screenshotsData') || '[]');
    refreshScreenshotGrid();
} catch (e) {
    console.error('Failed to load screenshots:', e);
    screenshotsData = [];
}

async function updateStatus() {
    try {
        const trackingStatus = await ipcRenderer.invoke('tracking:status');
        
        // Update status badge
        status.textContent = trackingStatus.isTracking ? 'Active' : 'Inactive';
        status.className = 'status-badge ' + (trackingStatus.isTracking ? 'active' : 'inactive');
        
        // Update button states
        startBtn.disabled = trackingStatus.isTracking;
        stopBtn.disabled = !trackingStatus.isTracking;

    } catch (err) {
        console.error('Status update failed:', err);
        status.textContent = 'Error';
        status.className = 'status-badge inactive';
    }
}

// Add a new click entry with screenshot
async function addClickEntry(clickInfo, screenshotData) {
    const entry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        screenshot: screenshotData,
        ...clickInfo
    };

    clickData.unshift(entry);
    localStorage.setItem('clickData', JSON.stringify(clickData));
    
    refreshActivityList();
}

// Refresh the activity list UI (in main view)
function refreshActivityList() {
    if (!activityList) return;
    activityList.innerHTML = '';
    clickData.forEach(entry => {
        const row = document.createElement('div');
        row.className = `click-entry ${entry.id === selectedEntryId ? 'selected' : ''}`;
        row.innerHTML = `
            <div class="click-time">${new Date(entry.timestamp).toLocaleTimeString()}</div>
            <div class="click-app">${entry.app_name || 'Unknown App'}</div>
            <div class="click-title">${entry.window_title || 'No title'}</div>
        `;
        row.addEventListener('click', () => {
            selectedEntryId = entry.id;
            refreshActivityList();
            showEntryDetails(entry);
        });
        activityList.appendChild(row);
    });
}

// Show entry details in preview panel
function showEntryDetails(entry) {
    // Clear existing content
    previewContent.innerHTML = '';
    previewDetails.innerHTML = '';

    // Show screenshot if available
    if (entry.screenshot) {
        const img = document.createElement('img');
        img.src = entry.screenshot;
        img.className = 'preview-image';
        previewContent.appendChild(img);
    }

    // Show details grid
    const detailsGrid = document.createElement('div');
    detailsGrid.className = 'details-grid';
    
    const details = [
        { label: 'Time', value: new Date(entry.timestamp).toLocaleString() },
        { label: 'Application', value: entry.app_name },
        { label: 'Window Title', value: entry.window_title },
        { label: 'Coordinates', value: `(${entry.x}, ${entry.y})` },
        { label: 'URL/Path', value: entry.url_or_path },
        { label: 'Selected Text', value: entry.text }
    ];

    details.forEach(({ label, value }) => {
        if (value) {
            const item = document.createElement('div');
            item.className = 'detail-item';
            item.innerHTML = `
                <div class="detail-label">${label}</div>
                <div class="detail-value">${value}</div>
            `;
            detailsGrid.appendChild(item);
        }
    });

    previewDetails.appendChild(detailsGrid);
}

// Handle incoming click data from logs/extension
ipcRenderer.on('click-captured', async (event, clickInfo) => {
    try {
        let screenshot = null;
        if (clickInfo && clickInfo.screenshot) {
            screenshot = clickInfo.screenshot;
        } else if (clickInfo && clickInfo.screenshot_path) {
            const p = clickInfo.screenshot_path;
            const fileUrl = p.startsWith('file://') ? p : 'file://' + p.replace(/\\/g, '/');
            screenshot = fileUrl;
        } else {
            screenshot = await ipcRenderer.invoke('take-screenshot');
        }
        await addClickEntry(clickInfo, screenshot);
        renderDataTable();
    } catch (err) {
        console.error('Failed to process click:', err);
    }
});

// Handle periodic screenshot ticks
ipcRenderer.on('screenshot-tick', async (event, { timestamp, screenshot, screenshot_path }) => {
    console.log('[Renderer] Received screenshot-tick event');
    try {
        console.log('[Renderer] Screenshot timestamp:', timestamp);
        // prefer saved file path if provided to avoid huge base64 payloads in renderer
        let shot = null;
        if (screenshot_path) {
            shot = screenshot_path.startsWith('file://') ? screenshot_path : 'file://' + screenshot_path.replace(/\\/g, '/');
            console.log('[Renderer] Using screenshot_path:', shot);
        } else {
            shot = screenshot;
            console.log('[Renderer] Screenshot data length:', shot ? shot.length : 'null');
        }
        await addScreenshotEntry({ timestamp, screenshot: shot });
    } catch (err) {
        console.error('[Renderer] Failed to add screenshot:', err);
    }
});

async function addScreenshotEntry({ timestamp, screenshot }) {
    console.log('[Renderer] addScreenshotEntry called');
    console.log('[Renderer] screenshotGrid element:', screenshotGrid);
    const entry = { id: Date.now(), timestamp, screenshot };
    screenshotsData.unshift(entry);
    if (screenshotsData.length > MAX_SCREENSHOTS) {
        screenshotsData = screenshotsData.slice(0, MAX_SCREENSHOTS);
    }
    localStorage.setItem('screenshotsData', JSON.stringify(screenshotsData));
    console.log('[Renderer] Calling refreshScreenshotGrid, total screenshots:', screenshotsData.length);
    refreshScreenshotGrid();
    console.log('[Renderer] Screenshot saved successfully');
}

function refreshScreenshotGrid() {
    if (!screenshotGrid) return;
    screenshotGrid.innerHTML = '';
    screenshotsData.forEach((shot) => {
        const card = document.createElement('div');
        card.className = 'shot-card';
        card.innerHTML = `
          <img src="${shot.screenshot}" alt="screenshot" />
          <div class="time">${new Date(shot.timestamp).toLocaleTimeString()}</div>
        `;
                card.addEventListener('click', () => {
                    // Switch to Activities view previewing the image
                    switchView('activities');
          // Show in preview area too for consistency
          previewContent.innerHTML = '';
          const img = document.createElement('img');
          img.src = shot.screenshot;
          img.className = 'preview-image';
          previewContent.appendChild(img);
          previewDetails.innerHTML = '';
        });
        screenshotGrid.appendChild(card);
    });
}

function renderDataTable() {
    if (!dataTable) return;
    const headers = ['Time', 'App', 'Window Title', 'X', 'Y', 'URL/Path', 'Text'];
    const rows = clickData.map(e => [
        new Date(e.timestamp).toLocaleString(),
        e.app_name || '',
        e.window_title || '',
        e.x ?? '',
        e.y ?? '',
        e.url_or_path || e.url || '',
        (e.text || '').slice(0, 200)
    ]);
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach(cols => {
        const tr = document.createElement('tr');
        cols.forEach(val => {
            const td = document.createElement('td');
            td.textContent = String(val ?? '');
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    dataTable.innerHTML = '';
    dataTable.appendChild(table);
}

function switchView(view) {
    currentView = view;
    // Sidebar nav
    navActivities.classList.toggle('active', view === 'activities');
    navScreenshots.classList.toggle('active', view === 'screenshots');
    // Sections
    viewActivities.classList.toggle('active', view === 'activities');
    viewScreenshots.classList.toggle('active', view === 'screenshots');
}

navActivities.addEventListener('click', () => switchView('activities'));
navScreenshots.addEventListener('click', () => switchView('screenshots'));

// UI Event Handlers
startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
        await ipcRenderer.invoke('tracking:start');
        await updateStatus();
        
        // Start periodic updates
        if (!updateInterval) {
            updateInterval = setInterval(updateStatus, 1000);
        }
    } catch (err) {
        console.error('Start failed:', err);
    } finally {
        startBtn.disabled = false;
    }
});

stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    try {
        await ipcRenderer.invoke('tracking:stop');
        await updateStatus();
    } catch (err) {
        console.error('Stop failed:', err);
    } finally {
        stopBtn.disabled = false;
    }
});

setHzBtn.addEventListener('click', async () => {
    const hz = parseFloat(hzInput.value || '1');
    if (hz >= 0.1 && hz <= 10) {
        setHzBtn.disabled = true;
        try {
            await ipcRenderer.invoke('tracking:setHz', hz);
            await updateStatus();
        } catch (err) {
            console.error('Set Hz failed:', err);
        } finally {
            setHzBtn.disabled = false;
        }
    }
});

exportBtn.addEventListener('click', async () => {
    try {
        const exportData = clickData.map(entry => {
            // Create a clean version for export without the screenshot data
            const { screenshot, ...cleanEntry } = entry;
            return cleanEntry;
        });
        
        // Export to JSON
        const jsonData = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `click-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Export failed:', err);
    }
});

clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
        clickData = [];
        localStorage.removeItem('clickData');
        selectedEntryId = null;
        refreshActivityList();
        previewContent.innerHTML = `
            <div class="preview-placeholder">
                <div class="placeholder-icon">📸</div>
                <p>Select an activity from the list to view details</p>
            </div>
        `;
        previewDetails.innerHTML = '';
        dataTable.innerHTML = '';
    }
});

// --- DEBUG: Confirm renderer script loaded and IPC event delivery ---
try {
    // ipcRenderer is already required at the top of this file; avoid redeclaring it.
    ipcRenderer.on('screenshot-tick', (event, data) => {
        console.log('[Renderer TEST] screenshot-tick received:', data);
    });
    console.log('[Renderer TEST] IPC listener registered');
} catch (e) {
    console.error('[Renderer TEST] Failed to register IPC listener:', e);
}

// Expose a capture function on window that captures the screen including the cursor.
// Uses desktopCapturer + getUserMedia, draws a single frame to canvas, then returns a dataURL.
let lastCursorPosition = { x: 0, y: 0 };

// Track cursor position globally
document.addEventListener('mousemove', (e) => {
    lastCursorPosition = {
        x: e.screenX,
        y: e.screenY
    };
});

window.captureScreenWithCursor = async function () {
    try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        if (!sources || sources.length === 0) {
            throw new Error('No screen sources available');
        }
        // Pick primary display (first source). Could be improved to pick by display id.
        const source = sources[0];

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: source.id,
                    maxWidth: window.screen.width * devicePixelRatio,
                    maxHeight: window.screen.height * devicePixelRatio,
                },
                cursor: 'always'  // Request cursor to be included
            }
        });

        // Create a video element to render the stream and capture one frame
        const video = document.createElement('video');
        video.style.position = 'fixed';
        video.style.left = '-10000px';
        video.style.top = '-10000px';
        document.body.appendChild(video);
        video.srcObject = stream;
        await video.play();

        // Wait a tick for the video to have current frame
        await new Promise(resolve => setTimeout(resolve, 50));

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || window.screen.width * devicePixelRatio;
        canvas.height = video.videoHeight || window.screen.height * devicePixelRatio;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Draw a more visible cursor indicator at the last known position
        const scaleX = canvas.width / window.screen.width;
        const scaleY = canvas.height / window.screen.height;
        const cursorX = lastCursorPosition.x * scaleX;
        const cursorY = lastCursorPosition.y * scaleY;

        // Outer glow
        const gradient = ctx.createRadialGradient(cursorX, cursorY, 2, cursorX, cursorY, 20);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, 20, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Main cursor circle
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, 10, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(66, 133, 244, 0.9)';
        ctx.fill();
        
        // Inner highlight
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, 4, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fill();

        // stop all tracks
        stream.getTracks().forEach(t => t.stop());
        video.remove();

        const dataUrl = canvas.toDataURL('image/png');
        return dataUrl;
    } catch (e) {
        console.error('[Renderer] captureScreenWithCursor failed:', e);
        return null;
    }
};

// Initialize
updateStatus();
refreshActivityList();
renderDataTable();

// Start periodic updates
updateInterval = setInterval(updateStatus, 2000);

// Clean up on window close
window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});


