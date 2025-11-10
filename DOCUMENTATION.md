# Desktop Capture App - Technical Documentation

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Backend Components](#backend-components)
3. [Frontend Components](#frontend-components)
4. [Extension Components](#extension-components)
5. [Data Flow](#data-flow)
6. [Implementation Details](#implementation-details)
7. [Performance Considerations](#performance-considerations)
8. [Security & Privacy](#security--privacy)

---

## System Architecture

### Overview

The Desktop Capture App is a distributed system with three main components that work together to provide comprehensive activity tracking:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         System Components                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐     │
│  │   Chrome     │      │   Backend    │      │   Electron   │     │
│  │  Extension   │─────▶│   FastAPI    │◀─────│   Frontend   │     │
│  │              │ HTTP │              │ HTTP │              │     │
│  └──────────────┘      └──────────────┘      └──────────────┘     │
│         │                      │                      │             │
│         │                      │                      │             │
│    Click Events          Screenshot Capture      UI Controls       │
│    Text Extraction       Data Logging            Display           │
│                                                                      │
│                    ┌─────────────────┐                              │
│                    │  File System    │                              │
│                    │  - Screenshots  │                              │
│                    │  - CSV Data     │                              │
│                    │  - NDJSON Data  │                              │
│                    └─────────────────┘                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Communication Protocols

1. **Extension ↔ Backend**: HTTP POST requests to `/ext_event`
2. **Electron ↔ Backend**: HTTP requests (GET/POST) for control and status
3. **Backend ↔ File System**: Direct file I/O for screenshots and data logs
4. **Electron ↔ File System**: Watches `clicks.ndjson` for real-time updates

---

## Backend Components

### 1. Main Application (`main.py`)

**Purpose**: FastAPI application server, request routing, and business logic.

#### Key Classes

**`AppState`**
```python
class AppState:
    def __init__(self):
        self.config = CaptureConfig(hz=1.0, output_base=...)
        self.capture = ScreenCapture(self.config)
        self.listener = GlobalClickListener(...)
        self.logger = ClickLogger(output_base)
        self._pending = {}  # Pending OS clicks for merging
        self._merge_timeout = 2.0  # seconds
        self._merge_distance_px = 50  # pixels
```

#### Endpoints

| Endpoint | Method | Purpose | Request | Response |
|----------|--------|---------|---------|----------|
| `/start` | POST | Start capture & listener | None | `{"started": true}` |
| `/stop` | POST | Stop capture & listener | None | `{"stopped": true}` |
| `/config` | POST | Update Hz rate | `{"hz": 2.0}` | `{"hz": 2.0}` |
| `/status` | GET | System status | None | `{capture_running, listener_running, hz, ...}` |
| `/ext_event` | POST | Click from extension | Click data + text | `{ok, merged, screenshot_path}` |
| `/screenshots` | GET | List screenshots | None | `{screenshots: [...]}` |
| `/electron_status` | POST | Electron app status | `{"active": true}` | `{"ok": true}` |

#### Click Merging Logic

**Problem**: Extension and OS both detect the same click - need to merge them.

**Solution**:
1. OS click detected → stored in `_pending` dict with 2-second expiry timer
2. Extension click arrives → checks `_pending` for matches within:
   - **Distance threshold**: ≤50 pixels
   - **Time window**: ≤2 seconds
3. If match found:
   - Merge data (extension text + OS metadata)
   - Cancel expiry timer
   - Log merged record
4. If no match:
   - Log as extension-only click

**Code Flow**:
```python
# OS click arrives (from listener callback)
_pending[click_id] = {
    "record": {...},
    "created_at": time.time(),
    "timer": Timer(2.0, lambda: _flush_pending(click_id))
}

# Extension click arrives
best_match = find_closest_pending_click(x, y, within=50px, within_time=2s)
if best_match:
    merged_record = merge(best_match, extension_data)
    log_click(merged_record)
else:
    log_click(extension_only_record)
```

### 2. Screenshot Capture (`capture.py`)

**Purpose**: Continuous desktop screenshot capture with cursor overlay.

#### Key Features

**Multi-Monitor Support**:
```python
def _get_monitor_index_for_point(monitors, x, y):
    # monitors[0] = virtual screen (all monitors combined)
    # monitors[1+] = individual physical monitors
    for idx in range(1, len(monitors)):
        mon = monitors[idx]
        if mon["left"] <= x < mon["left"] + mon["width"]:
            if mon["top"] <= y < mon["top"] + mon["height"]:
                return idx
    return 1  # fallback to primary
```

**Cursor Overlay**:
```python
def _draw_cursor(image, cursor_pos, monitor):
    # Transform global coords to monitor-local coords
    mx = cursor_x - monitor["left"]
    my = cursor_y - monitor["top"]
    
    # Draw red circle at cursor position
    draw.ellipse(
        (mx - radius, my - radius, mx + radius, my + radius),
        outline=(255, 0, 0),
        width=3
    )
```

**Screenshot Loop**:
```python
def _run_loop(self):
    interval = 1.0 / self.config.hz  # e.g., 1.0 seconds for 1 Hz
    
    while not self._stop_event.is_set():
        # 1. Get cursor position
        cursor_x, cursor_y = pyautogui.position()
        
        # 2. Determine which monitor cursor is on
        mon_idx = _get_monitor_index_for_point(monitors, cursor_x, cursor_y)
        
        # 3. Capture that monitor
        raw = sct.grab(monitors[mon_idx])
        img = Image.frombytes("RGB", raw.size, raw.rgb)
        
        # 4. Draw cursor overlay
        _draw_cursor(img, (cursor_x, cursor_y), monitors[mon_idx])
        
        # 5. Save to data/YYYY-MM-DD/screenshots/
        folder = day_folder(output_base)
        screenshots_folder = os.path.join(folder, "screenshots")
        path = os.path.join(screenshots_folder, f"{timestamp}.png")
        img.save(path)
        
        time.sleep(interval)
```

**On-Demand Capture**:
```python
def capture_once(self):
    # Same as loop, but single capture
    # Used when extension click arrives
    # Saves to data/YYYY-MM-DD/ (NOT screenshots/ subfolder)
    # Returns path for inclusion in click record
```

### 3. Click Listener (`listener.py`)

**Purpose**: OS-level click detection on Windows.

#### Implementation

**Windows Hook**:
```python
from pynput import mouse

class GlobalClickListener:
    def __init__(self, callback):
        self.callback = callback
        self._listener = None
    
    def start(self):
        self._listener = mouse.Listener(on_click=self._on_click)
        self._listener.start()
    
    def _on_click(self, x, y, button, pressed):
        if pressed:  # Only track press, not release
            # Get window info at cursor position
            window_title = get_window_at_cursor()
            app_name = get_process_name()
            
            # Call backend callback with click data
            self.callback({
                "x": x,
                "y": y,
                "app_name": app_name,
                "window_title": window_title,
                ...
            })
```

**Window Detection**:
```python
def get_window_at_cursor():
    # Windows API calls to get window handle at cursor
    hwnd = ctypes.windll.user32.WindowFromPoint(point)
    title = get_window_text(hwnd)
    return title
```

### 4. Data Logger (`logger.py`)

**Purpose**: Write click data to CSV and NDJSON files.

#### File Formats

**CSV Structure**:
```csv
timestamp_utc,x,y,app_name,process_id,window_title,display_id,source,url_or_path,doc_path,text,screenshot_path
2025-11-10T12:42:11.364Z,654,458,chrome.exe,22520,Feed | LinkedIn,2,ext,https://linkedin.com/feed/,,Post content...,C:\...\2025-11-10T12-42-11.364Z.png
```

**NDJSON Structure** (one JSON object per line):
```json
{"timestamp_utc":"2025-11-10T12:42:11.364Z","x":654,"y":458,"app_name":"chrome.exe",...}
{"timestamp_utc":"2025-11-10T12:42:15.045Z","x":623,"y":340,"app_name":"chrome.exe",...}
```

#### Thread Safety

```python
class ClickLogger:
    def __init__(self):
        self._csv_lock = Lock()
        self._ndjson_lock = Lock()
    
    def log_click(self, record):
        # NDJSON: Thread-safe append
        with self._ndjson_lock:
            with open(self.ndjson_path, "a") as f:
                f.write(json.dumps(record) + "\n")
        
        # CSV: Thread-safe append
        with self._csv_lock:
            self._ensure_csv_header()
            with open(self.csv_path, "a") as f:
                writer = csv.writer(f)
                writer.writerow([...])
```

---

## Frontend Components

### 1. Main Process (`main.js`)

**Purpose**: Electron main process, IPC handlers, backend communication.

#### IPC Handlers

**Start Tracking**:
```javascript
ipcMain.handle('tracking:start', async () => {
    // 1. Update local state
    isTracking = true;
    
    // 2. Call backend /start endpoint
    const response = await httpPost('http://127.0.0.1:8000/start');
    
    // 3. Start local tracking loop (if needed)
    startTrackingLoop();
    
    return { success: true };
});
```

**Stop Tracking**:
```javascript
ipcMain.handle('tracking:stop', async () => {
    isTracking = false;
    await httpPost('http://127.0.0.1:8000/stop');
    stopTrackingLoop();
    return { success: true };
});
```

**Set Hz**:
```javascript
ipcMain.handle('tracking:setHz', async (event, hz) => {
    currentHz = parseFloat(hz);
    
    // Update backend
    await httpPost('http://127.0.0.1:8000/config', { hz: currentHz });
    
    if (isTracking) {
        restartTrackingLoop();
    }
    return { success: true };
});
```

#### File Watching

**Watch `clicks.ndjson` for Real-Time Updates**:
```javascript
function setupLogWatcher() {
    const logPath = path.join(dataRoot, dayFolder(), 'clicks.ndjson');
    
    fs.watch(logPath, (eventType) => {
        if (eventType === 'change') {
            // Read new lines since last read
            const newLines = readNewLines(logPath, prevLen);
            
            // Parse and send to renderer
            newLines.forEach(line => {
                const clickInfo = JSON.parse(line);
                mainWindow.webContents.send('click-captured', clickInfo);
            });
            
            prevLen = getCurrentLength(logPath);
        }
    });
}
```

### 2. Renderer Process (`app.js`)

**Purpose**: UI logic, event handling, data display.

#### Data Management

**Click Data State**:
```javascript
let clickData = [];  // All captured clicks
let selectedEntryId = null;  // Currently selected activity

// Load from localStorage on startup
clickData = JSON.parse(localStorage.getItem('clickData') || '[]');
```

#### Event Handlers

**Click Captured**:
```javascript
ipcRenderer.on('click-captured', async (event, clickInfo) => {
    // 1. Determine screenshot path
    let screenshot = null;
    if (clickInfo.screenshot_path) {
        screenshot = 'file://' + clickInfo.screenshot_path;
    } else if (clickInfo.screenshot) {
        screenshot = clickInfo.screenshot;
    } else {
        // Fallback: take screenshot (shouldn't happen normally)
        screenshot = await ipcRenderer.invoke('take-screenshot');
    }
    
    // 2. Add to clickData
    const entry = {
        id: Date.now(),
        timestamp: clickInfo.timestamp_utc,
        screenshot: screenshot,
        ...clickInfo
    };
    clickData.unshift(entry);
    
    // 3. Persist to localStorage
    localStorage.setItem('clickData', JSON.stringify(clickData));
    
    // 4. Update UI
    refreshActivityList();
    renderDataTable();
});
```

**Activity Selection**:
```javascript
function showActivityDetails(entry) {
    selectedEntryId = entry.id;
    
    // Show screenshot in preview pane
    if (entry.screenshot) {
        previewContent.innerHTML = `
            <img src="${entry.screenshot}" class="preview-image" />
        `;
    }
    
    // Show metadata in details pane
    previewDetails.innerHTML = `
        <p><strong>Time:</strong> ${formatTime(entry.timestamp)}</p>
        <p><strong>URL:</strong> ${entry.url_or_path}</p>
        <p><strong>Window:</strong> ${entry.window_title}</p>
        <p><strong>Position:</strong> (${entry.x}, ${entry.y})</p>
        <p><strong>Text:</strong></p>
        <div class="text-content">${entry.text}</div>
    `;
}
```

#### Export Functionality

**Export to CSV**:
```javascript
exportBtn.addEventListener('click', async () => {
    // Create clean data without screenshot blobs
    const exportData = clickData.map(entry => {
        const { screenshot, ...cleanEntry } = entry;
        return cleanEntry;
    });
    
    // Convert to CSV
    const csv = convertToCSV(exportData);
    
    // Trigger download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-export-${Date.now()}.csv`;
    a.click();
});
```

### 3. UI Structure (`index.html`)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│  Desktop Capture App                    [Status]    │
├─────────────┬───────────────────────────────────────┤
│  Sidebar    │  Main Content                         │
│             │                                        │
│  Controls   │  ┌─────────────────────────────────┐ │
│  ─────────  │  │  Activities View                │ │
│  [Start]    │  │                                 │ │
│  [Stop]     │  │  ┌──────────┬──────────────────┐ │
│             │  │  │ Activity │  Preview         │ │
│  Hz: [1]    │  │  │ List     │  ┌────────────┐ │ │
│  [Apply]    │  │  │          │  │ Screenshot │ │ │
│             │  │  │  • Click │  │            │ │ │
│  Navigation │  │  │  • Click │  └────────────┘ │ │
│  ─────────  │  │  │  • Click │  Details        │ │
│  Activities │  │  │          │  - Time         │ │
│             │  │  │          │  - URL          │ │
│             │  │  │          │  - Text         │ │
│             │  │  └──────────┴──────────────────┘ │
│             │  │                                 │ │
│             │  │  Data Table (Live View)         │ │
│             │  └─────────────────────────────────┘ │
└─────────────┴───────────────────────────────────────┘
```

---

## Extension Components

### 1. Manifest (`manifest.json`)

**Manifest V3 Configuration**:
```json
{
  "manifest_version": 3,
  "name": "Desktop Capture Helper",
  "version": "1.0",
  "permissions": ["activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "background": {
    "service_worker": "background.js"
  }
}
```

**Key Permissions**:
- `activeTab`: Access current tab DOM
- `scripting`: Inject content scripts
- `<all_urls>`: Work on all websites

### 2. Content Script (`content.js`)

**Purpose**: Capture clicks and extract text from web pages.

#### Click Detection

**Global Click Listener**:
```javascript
document.addEventListener('click', async (e) => {
    // Wait for any navigation/dynamic content
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Extract data
    const clickData = {
        x: e.clientX,
        y: e.clientY,
        global_x: e.screenX,
        global_y: e.screenY,
        url: window.location.href,
        title: document.title,
        text: extractText(e.target),
        display_id: screen.displayId || null
    };
    
    // Send to backend
    await sendToBackend(clickData);
}, true);  // useCapture = true
```

#### Text Extraction

**Generic Extraction**:
```javascript
function extractText(element) {
    // Try multiple strategies
    
    // 1. Direct text content
    let text = element.innerText || element.textContent || '';
    
    // 2. If too short, check parent
    if (text.length < 20 && element.parentElement) {
        text = element.parentElement.innerText;
    }
    
    // 3. Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text || 'No text extracted';
}
```

**LinkedIn-Specific Extraction**:
```javascript
function extractLinkedInPost(element) {
    // Traverse up to find post container
    let container = element;
    while (container && !container.classList.contains('feed-shared-update-v2')) {
        container = container.parentElement;
    }
    
    if (container) {
        // Extract full post content
        const contentEl = container.querySelector('.feed-shared-text');
        return contentEl ? contentEl.innerText : 'No text';
    }
    
    return extractText(element);
}
```

**X/Twitter-Specific Extraction**:
```javascript
function extractTwitterTweet(element) {
    // Find article ancestor (tweet container)
    let article = element.closest('article');
    
    if (article) {
        // Extract tweet text
        const tweetText = article.querySelector('[data-testid="tweetText"]');
        return tweetText ? tweetText.innerText : 'No text';
    }
    
    return extractText(element);
}
```

#### Backend Communication

**HTTP POST**:
```javascript
async function sendToBackend(clickData) {
    try {
        const response = await fetch('http://127.0.0.1:8000/ext_event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(clickData)
        });
        
        const result = await response.json();
        console.log('[Capture] Backend response:', result);
        
        // result.screenshot_path = path to captured screenshot
        // result.merged = true if matched with OS click
    } catch (error) {
        console.error('[Capture] Failed to send:', error);
    }
}
```

---

## Data Flow

### Complete Click Capture Flow

```
1. User clicks on webpage
   │
   ├─→ Extension detects click
   │   ├─ Captures coordinates (client + screen)
   │   ├─ Extracts text from element
   │   ├─ Gets URL and page title
   │   └─ Sends to backend via HTTP POST /ext_event
   │
   └─→ OS listener detects click (if running)
       ├─ Captures global coordinates
       ├─ Gets window title and app name
       └─ Stored in _pending dict for 2 seconds

2. Backend receives extension click
   │
   ├─→ Captures screenshot immediately (capture_once)
   │   └─ Saves to data/YYYY-MM-DD/screenshot_timestamp.png
   │
   ├─→ Searches _pending for matching OS click
   │   ├─ Match found (within 50px, within 2s)?
   │   │  ├─ YES: Merge extension + OS data
   │   │  │      ├─ Extension provides: text, URL
   │   │  │      └─ OS provides: app_name, process_id, window_title
   │   │  │
   │   │  └─ NO: Create extension-only record
   │   │
   │   └─→ Add screenshot_path to record
   │
   └─→ Log to files
       ├─ Append to clicks.ndjson
       └─ Append to clicks.csv

3. Electron detects file change
   │
   ├─→ File watcher notices clicks.ndjson changed
   │
   ├─→ Reads new lines
   │
   └─→ Sends 'click-captured' IPC event to renderer

4. Renderer receives click data
   │
   ├─→ Loads screenshot from path
   │
   ├─→ Adds to clickData array
   │
   ├─→ Saves to localStorage
   │
   └─→ Updates UI
       ├─ Refreshes activity list
       ├─ Updates data table
       └─ Shows screenshot if activity selected
```

### Screenshot Capture Flow (1Hz)

```
1. User clicks "Start Tracking" in Electron
   │
   └─→ Electron sends HTTP POST to /start

2. Backend starts capture loop
   │
   └─→ Every 1 second (1 Hz):
       │
       ├─→ Get cursor position (pyautogui)
       │
       ├─→ Determine active monitor
       │
       ├─→ Capture monitor screenshot (mss)
       │
       ├─→ Draw red cursor overlay
       │
       └─→ Save to data/YYYY-MM-DD/screenshots/timestamp.png

3. Screenshots accumulate in screenshots/ folder
   │
   └─→ NOT linked to click data
       └─→ For archival/review purposes only
```

---

## Implementation Details

### DPI Awareness (Windows)

**Problem**: On high-DPI displays, coordinate systems may not match between screenshot capture and click detection.

**Solution**:
```python
# capture.py
if platform.system() == "Windows":
    try:
        # Per-monitor DPI awareness (Windows 8.1+)
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except:
        # Fallback to system DPI awareness
        ctypes.windll.user32.SetProcessDPIAware()
```

### Timestamp Format

**Requirement**: Filenames must be Windows-safe (no colons).

**Solution**: Use dashes instead of colons in time portion.
```python
# ISO 8601 with dashes: YYYY-MM-DDTHH-MM-SS.mmmZ
def utc_iso_millis():
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H-%M-%S.%f")[:-3] + "Z"

# Example: 2025-11-10T12-42-11.364Z
```

### CORS Configuration

**Backend allows all origins**:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Why**: Extension runs in browser context, needs to make cross-origin requests to localhost:8000.

### Error Handling

**Screenshot Capture Retries**:
```python
# Transient mss.grab failures can occur
for attempt in range(2):
    try:
        raw = sct.grab(monitor)
        break
    except Exception as e:
        logger.warning(f"Grab failed (attempt {attempt+1}): {e}")
        time.sleep(0.02)
```

**File Write Retries**:
```python
# File system may be temporarily locked
for attempt in range(2):
    try:
        img.save(path)
        saved = True
        break
    except Exception as e:
        logger.warning(f"Save failed (attempt {attempt+1}): {e}")
        time.sleep(0.05)
```

---

## Performance Considerations

### Screenshot Compression

**Current**: PNG format, no compression
**File Size**: ~500KB - 2MB per screenshot depending on resolution
**Disk Usage**: At 1 Hz, ~1.8MB/minute, ~108MB/hour, ~2.6GB/day

**Optimization Options**:
1. JPEG format (lossy, ~10x smaller)
2. PNG compression level adjustment
3. Reduced resolution capture
4. Periodic cleanup of old screenshots

### Memory Management

**Electron localStorage Limits**:
- Maximum ~10MB per domain
- clickData array can grow large
- **Current mitigation**: Only stores metadata, not screenshot blobs
- **Future**: Implement pagination or max entry limit

### File I/O

**Concurrent Writes**:
- Multiple threads may write to CSV/NDJSON
- **Solution**: Thread locks (`_csv_lock`, `_ndjson_lock`)

**File Watching**:
- Electron watches `clicks.ndjson` for changes
- Efficient: Only reads new lines since last check
- Tracks `prevLen` to avoid re-reading entire file

---

## Security & Privacy

### Local-Only System

**No Network Communication** (except localhost):
- Backend: `127.0.0.1:8000` (localhost only)
- Extension: Sends data to `http://127.0.0.1:8000`
- Electron: Connects to `http://127.0.0.1:8000`

**Data Storage**: All files stored locally in `data/` folder.

### Screenshot Privacy

**Contains**: Full desktop at time of capture, including:
- Open windows
- Desktop icons
- Taskbar/menu bar
- Cursor position

**Recommendation**: Review screenshots periodically and delete sensitive data.

### Text Extraction Privacy

**Contains**: Exact text from clicked elements, including:
- Private messages
- Email content
- Personal information
- Passwords (if visible as text)

**Recommendation**:
- Don't use on sensitive pages
- Implement "privacy mode" pause functionality
- Clear data regularly

### Data Access

**File Permissions**: Standard user permissions on `data/` folder.

**No Authentication**: Backend has no authentication (assumes trusted localhost environment).

**Risk**: Any process on the machine can access `http://127.0.0.1:8000`.

---

## Maintenance & Monitoring

### Log Files

**Backend Logs**: `backend/backend_ext.log`
```
2025-11-10 13:45:01 [backend] INFO: Saved screenshot: C:\...\2025-11-10T13-45-01.png
2025-11-10 13:45:02 [backend] INFO: Logging click: source=ext, x=654, y=458, text=Post content...
```

**Electron Logs**: Console output in terminal
```
[Electron] Backend /start response: {"started": true}
[Electron] Screenshot display loop started
[Renderer] Received click-captured event
```

### Health Checks

**Backend Status**:
```bash
curl http://127.0.0.1:8000/status
```

**Expected Response**:
```json
{
  "capture_running": true,
  "listener_running": false,
  "hz": 1.0,
  "output_base": "C:\\...\\data",
  "electron_active": false
}
```

### Data Cleanup

**Automated**: None (data accumulates indefinitely)

**Manual Cleanup**:
```bash
# Delete old date folders
rm -rf data/2025-11-01
rm -rf data/2025-11-02

# Keep only last 7 days
find data/ -type d -mtime +7 -exec rm -rf {} \;
```

---

## Future Enhancements

### High Priority

1. **Privacy Mode**: Pause button to stop capture temporarily
2. **Data Cleanup**: Automatic deletion of old screenshots
3. **Search/Filter**: Find specific activities in Electron UI
4. **Export Options**: JSON, XML, database formats

### Medium Priority

5. **Compression**: Reduce screenshot file sizes
6. **Cloud Backup**: Optional upload to cloud storage
7. **Cross-Platform**: macOS and Linux support
8. **Video Recording**: Alternative to screenshots

### Low Priority

9. **OCR Integration**: Extract text from screenshots
10. **Activity Analytics**: Charts and statistics
11. **Tagging System**: Categorize activities
12. **Screenshot Comparison**: Detect changes between captures

---

**Last Updated**: November 10, 2025
**Version**: 1.0
