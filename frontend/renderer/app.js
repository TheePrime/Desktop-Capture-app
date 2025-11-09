const { ipcRenderer } = require('electron');
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
ipcRenderer.on('screenshot-tick', async (event, { timestamp, screenshot }) => {
    try {
        await addScreenshotEntry({ timestamp, screenshot });
    } catch (err) {
        console.error('Failed to add screenshot:', err);
    }
});

async function addScreenshotEntry({ timestamp, screenshot }) {
    const entry = { id: Date.now(), timestamp, screenshot };
    screenshotsData.unshift(entry);
    if (screenshotsData.length > MAX_SCREENSHOTS) {
        screenshotsData = screenshotsData.slice(0, MAX_SCREENSHOTS);
    }
    localStorage.setItem('screenshotsData', JSON.stringify(screenshotsData));
    refreshScreenshotGrid();
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


