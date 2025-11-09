// UI Elements
const connectionStatus = document.getElementById('connectionStatus');
const captureCount = document.getElementById('captureCount');
const currentRate = document.getElementById('currentRate');
const activityList = document.getElementById('activityList');
const appStatus = document.getElementById('appStatus');
const openAppBtn = document.getElementById('openApp');

// State
let isConnected = false;
let todaysCaptureCount = 0;
let recentActivity = [];
let ws = null;

// Check connection to Electron app
async function checkConnection() {
    try {
        // Close existing connection if any
        if (ws) {
            ws.close();
        }

        ws = new WebSocket('ws://localhost:8000');
        
        ws.onopen = () => {
            isConnected = true;
            updateConnectionStatus();
            // Request current stats
            ws.send(JSON.stringify({ type: 'get_stats' }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleMessage(data);
            } catch (err) {
                console.error('Failed to parse message:', err);
            }
        };

        ws.onerror = () => {
            isConnected = false;
            updateConnectionStatus();
            ws = null;
        };

        ws.onclose = () => {
            isConnected = false;
            updateConnectionStatus();
            ws = null;
        };

    } catch {
        isConnected = false;
        updateConnectionStatus();
        ws = null;
    }
}

// Handle messages from WebSocket
function handleMessage(message) {
    switch (message.type) {
        case 'stats':
            todaysCaptureCount = message.data.captureCount || 0;
            currentRate.textContent = message.data.rate ? `${message.data.rate.toFixed(1)} Hz` : '0.0 Hz';
            updateStats();
            break;
        case 'capture':
            handleCapture(message.data);
            break;
    }
}

// Update UI elements
function updateConnectionStatus() {
    connectionStatus.className = 'status ' + (isConnected ? 'connected' : 'disconnected');
    connectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
    appStatus.textContent = `App: ${isConnected ? 'Connected' : 'Not Connected'}`;
}

function updateStats() {
    captureCount.textContent = todaysCaptureCount;
}

function addActivityItem(activity) {
    const item = document.createElement('div');
    item.className = 'activity-item';
    
    const time = new Date(activity.timestamp);
    const timeStr = time.toLocaleTimeString(undefined, { 
        hour: '2-digit', 
        minute: '2-digit'
    });

    const iconEmoji = activity.type === 'click' ? '🖱️' : '📸';
    
    item.innerHTML = `
        <div class="activity-icon">${iconEmoji}</div>
        <div class="activity-content">
            <div class="activity-title">${activity.title || 'Unnamed Window'}</div>
            <div class="activity-time">${timeStr}</div>
        </div>
    `;

    // Keep only last 5 items
    const items = activityList.children;
    if (items.length >= 5) {
        activityList.removeChild(items[items.length - 1]);
    }

    activityList.insertBefore(item, activityList.firstChild);
}

// Handle new capture
function handleCapture(data) {
    todaysCaptureCount++;
    recentActivity.unshift(data);
    if (recentActivity.length > 50) {
        recentActivity.pop();
    }
    
    // Save to storage
    chrome.storage.local.set({
        recentActivity,
        captureCount: todaysCaptureCount
    });

    // Update UI
    addActivityItem(data);
    updateStats();
}

// Load recent activity from storage
async function loadRecentActivity() {
    try {
        const data = await chrome.storage.local.get(['recentActivity', 'captureCount']);
        recentActivity = data.recentActivity || [];
        todaysCaptureCount = data.captureCount || 0;
        
        // Clear existing items
        activityList.innerHTML = '';
        
        // Add recent items
        recentActivity.slice(0, 5).forEach(addActivityItem);
        updateStats();
    } catch (err) {
        console.error('Failed to load activity:', err);
    }
}

// Reset stats at midnight
function setupDailyReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow - now;
    
    setTimeout(() => {
        todaysCaptureCount = 0;
        updateStats();
        chrome.storage.local.set({ captureCount: 0 });
        
        // Setup next day's reset
        setupDailyReset();
    }, timeUntilMidnight);
}

// Open Electron app
openAppBtn.addEventListener('click', () => {
    if (!isConnected) {
        // Try to launch the app via native messaging
        chrome.runtime.sendMessage({ type: 'launch_app' }, (response) => {
            if (response && response.success) {
                setTimeout(checkConnection, 1000); // Check connection after a delay
            } else {
                alert('Please ensure the Desktop Capture app is running');
            }
        });
    } else {
        // Send focus command to existing app
        ws.send(JSON.stringify({ type: 'focus_app' }));
    }
});

// Listen for background script messages
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'capture') {
        handleCapture(message.data);
    }
});

// Initialize
loadRecentActivity();
setupDailyReset();
checkConnection();
setInterval(checkConnection, 5000); // Check connection every 5 seconds if disconnected