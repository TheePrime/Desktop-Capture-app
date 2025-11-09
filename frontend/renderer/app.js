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
const clickList = document.getElementById('clickList');
const previewContent = document.getElementById('previewContent');
const previewDetails = document.getElementById('previewDetails');

// State
let updateInterval;
let clickData = [];
let selectedEntryId = null;

// Load saved data on startup
try {
    clickData = JSON.parse(localStorage.getItem('clickData') || '[]');
    refreshClickList();
} catch (e) {
    console.error('Failed to load saved data:', e);
    clickData = [];
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
    
    refreshClickList();
}

// Refresh the click list UI
function refreshClickList() {
    clickList.innerHTML = '';
    clickData.forEach(entry => {
        const entryDiv = document.createElement('div');
        entryDiv.className = `click-entry ${entry.id === selectedEntryId ? 'selected' : ''}`;
        entryDiv.innerHTML = `
            <div class="click-time">${new Date(entry.timestamp).toLocaleTimeString()}</div>
            <div class="click-app">${entry.app_name || 'Unknown App'}</div>
            <div class="click-title">${entry.window_title || 'No title'}</div>
        `;
        
        entryDiv.addEventListener('click', () => {
            selectedEntryId = entry.id;
            refreshClickList();
            showEntryDetails(entry);
        });
        
        clickList.appendChild(entryDiv);
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

// Handle incoming click data from extension
ipcRenderer.on('click-captured', async (event, clickInfo) => {
    try {
        // Take a screenshot when click is captured
        const screenshot = await ipcRenderer.invoke('take-screenshot');
        await addClickEntry(clickInfo, screenshot);
    } catch (err) {
        console.error('Failed to process click:', err);
    }
});

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
        refreshClickList();
        previewContent.innerHTML = `
            <div class="preview-placeholder">
                <div class="placeholder-icon">📸</div>
                <p>Select an activity from the sidebar to view details</p>
            </div>
        `;
        previewDetails.innerHTML = '';
    }
});

// Initialize
updateStatus();
refreshClickList();

// Start periodic updates
updateInterval = setInterval(updateStatus, 2000);

// Clean up on window close
window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});


