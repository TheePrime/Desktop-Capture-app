# Desktop Capture App

🖥️ **Desktop Capture App + Chrome Extension** - A comprehensive activity tracking system that captures desktop screenshots, monitors clicks, and extracts text content from web pages.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Configuration](#configuration)
- [Data Storage](#data-storage)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

The Desktop Capture App is a three-component system designed to track user activity across desktop and web browser:

1. **Backend (Python/FastAPI)** - Captures desktop screenshots at 1Hz and processes click events
2. **Electron Frontend** - Desktop UI for monitoring captured activities and managing the system
3. **Chrome Extension** - Captures clicks and text content from web pages

## ✨ Features

### Desktop Screenshot Capture
- **1Hz Continuous Capture**: Automatically captures desktop screenshots every second
- **Cursor Overlay**: Red circle indicator showing cursor position in each screenshot
- **Multi-Monitor Support**: Detects and captures from the active monitor
- **Organized Storage**: Screenshots saved to `data/YYYY-MM-DD/screenshots/` folders

### Click Tracking
- **OS-Level Click Detection**: Tracks clicks anywhere on desktop (Windows)
- **Web Page Click Capture**: Chrome extension captures clicks with text extraction
- **On-Demand Screenshots**: Captures screenshot immediately when click occurs
- **Intelligent Merging**: Matches extension clicks with OS clicks based on coordinates and timing

### Text Extraction
- **LinkedIn Posts**: Extracts full post content from LinkedIn feed
- **X/Twitter Posts**: Captures tweet text and engagement options
- **General Web Content**: Extracts text from clicked elements on any webpage
- **PDF Support**: Handles file:// URLs for embedded PDF viewers

### Data Management
- **Dual Format Storage**: Saves click data in both CSV and NDJSON formats
- **Screenshot Association**: Each click record includes path to screenshot
- **Export Functionality**: Export all data from Electron UI
- **Persistent Storage**: All data organized by date in `data/` folder

## 🏗️ Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Chrome         │         │   Backend        │         │   Electron      │
│  Extension      │────────▶│   (FastAPI)      │◀────────│   Frontend      │
│                 │  HTTP   │                  │  HTTP   │                 │
│  - Click Track  │         │  - Screenshot    │         │  - UI Display   │
│  - Text Extract │         │  - Click Log     │         │  - Controls     │
│  - Content.js   │         │  - Data Storage  │         │  - Activities   │
└─────────────────┘         └──────────────────┘         └─────────────────┘
         │                           │                            │
         │                           │                            │
         └───────────────────────────┴────────────────────────────┘
                                     │
                              ┌──────▼──────┐
                              │    Data     │
                              │  Storage    │
                              │             │
                              │ - CSV       │
                              │ - NDJSON    │
                              │ - PNG       │
                              └─────────────┘
```

### Component Communication

1. **Extension → Backend**: HTTP POST to `/ext_event` with click data and extracted text
2. **Backend → Storage**: Writes to `clicks.csv`, `clicks.ndjson`, and `screenshots/`
3. **Electron → Backend**: HTTP requests to control capture (`/start`, `/stop`, `/config`)
4. **Backend → Electron**: Log file watching for real-time activity updates

## 📦 Installation

### Prerequisites

- **Python 3.8+** (for backend)
- **Node.js 16+** (for Electron)
- **Chrome Browser** (for extension)
- **Windows OS** (for OS-level click tracking)

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
```

**Dependencies:**
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `mss` - Multi-monitor screenshot capture
- `pyautogui` - Cursor position detection
- `pillow` - Image processing
- `pynput` - OS-level click listening (Windows)

### Frontend Setup

```bash
cd frontend
npm install
```

**Dependencies:**
- `electron` - Desktop application framework
- `ws` - WebSocket support (legacy)

### Extension Setup

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension/` folder
5. Extension will appear in toolbar

## 🚀 Usage

### Starting the System

#### 1. Start Backend (Required First)
```bash
cd backend
uvicorn main:app --reload
```
Backend will run on `http://127.0.0.1:8000`

#### 2. Start Electron App
```bash
cd frontend
npx electron .
```

#### 3. Start Tracking

**From Electron UI:**
1. Click **"Start Tracking"** button
2. Adjust Hz (capture rate) if needed using the input and **"Apply"** button
3. Backend begins capturing screenshots at specified rate
4. Click data appears in Activities view

**From Command Line:**
```bash
# Start screenshot capture
curl -X POST http://127.0.0.1:8000/start

# Stop capture
curl -X POST http://127.0.0.1:8000/stop

# Set capture rate to 2 Hz
curl -X POST http://127.0.0.1:8000/config -H "Content-Type: application/json" -d "{\"hz\": 2}"

# Check status
curl -X GET http://127.0.0.1:8000/status
```

### Using the Extension

1. **Browse any website** with the extension enabled
2. **Click anywhere** on the page
3. Extension automatically:
   - Captures click coordinates
   - Extracts text from clicked element
   - Sends data to backend
   - Backend captures screenshot and logs click

### Viewing Data

**Electron Activities View:**
- **Activity List**: Shows all captured clicks with timestamps
- **Preview Pane**: Displays screenshot when activity is selected
- **Details Panel**: Shows extracted text, URL, window title, coordinates
- **Data Table**: Live view of exportable data

**File System:**
```
data/
  └── 2025-11-10/
      ├── screenshots/           # 1Hz continuous screenshots
      │   ├── 2025-11-10T13-45-01.png
      │   ├── 2025-11-10T13-45-02.png
      │   └── ...
      ├── 2025-11-10T12-42-11.png  # On-demand click screenshots
      ├── 2025-11-10T12-42-14.png
      ├── clicks.csv            # CSV format click data
      └── clicks.ndjson         # NDJSON format click data
```

## 📁 Project Structure

```
desktop-capture-app/
├── backend/
│   ├── main.py              # FastAPI application, endpoints
│   ├── capture.py           # Screenshot capture logic
│   ├── listener.py          # OS-level click listener
│   ├── logger.py            # Data logging (CSV/NDJSON)
│   ├── requirements.txt     # Python dependencies
│   └── __pycache__/
├── frontend/
│   ├── main.js              # Electron main process
│   ├── package.json         # Node dependencies
│   └── renderer/
│       ├── index.html       # UI structure
│       └── app.js           # UI logic, event handlers
├── extension/
│   ├── manifest.json        # Extension configuration (V3)
│   ├── background.js        # Service worker (minimal)
│   ├── content.js           # Page script, click capture
│   └── test.html            # Extension test page
├── data/                    # Generated data storage
│   └── YYYY-MM-DD/
│       ├── screenshots/     # 1Hz screenshots
│       ├── *.png           # Click screenshots
│       ├── clicks.csv      # CSV format
│       └── clicks.ndjson   # NDJSON format
└── README.md
```

## 📡 API Documentation

### Backend Endpoints

#### `POST /start`
Start screenshot capture and click listener.

**Response:**
```json
{
  "started": true
}
```

#### `POST /stop`
Stop screenshot capture and click listener.

**Response:**
```json
{
  "stopped": true
}
```

#### `POST /config`
Update capture rate (Hz).

**Request Body:**
```json
{
  "hz": 2.0
}
```

**Response:**
```json
{
  "hz": 2.0
}
```

#### `GET /status`
Get current system status.

**Response:**
```json
{
  "capture_running": true,
  "listener_running": false,
  "hz": 1.0,
  "output_base": "C:\\...\\data",
  "electron_active": false
}
```

#### `POST /ext_event`
Receive click event from Chrome extension.

**Request Body:**
```json
{
  "x": 654,
  "y": 458,
  "global_x": 1654,
  "global_y": 458,
  "url": "https://linkedin.com/feed/",
  "title": "Feed | LinkedIn",
  "text": "Extracted post content...",
  "display_id": 2
}
```

**Response:**
```json
{
  "ok": true,
  "merged": true,
  "screenshot_path": "C:\\...\\2025-11-10\\2025-11-10T12-42-11.364Z.png"
}
```

#### `GET /screenshots`
List available screenshots for current day.

**Response:**
```json
{
  "screenshots": [
    "2025-11-10T13-45-01.png",
    "2025-11-10T13-45-02.png"
  ]
}
```

#### `POST /electron_status`
Notify backend of Electron app status.

**Request Body:**
```json
{
  "active": true
}
```

## ⚙️ Configuration

### Backend Configuration

**Capture Settings** (`backend/capture.py`):
- `hz`: Capture rate (default: 1.0 Hz)
- `output_base`: Data storage directory (default: `../data`)
- `cursor_radius`: Cursor indicator size (default: 8px)
- `cursor_color`: Cursor indicator color (default: red RGB(255,0,0))
- `cursor_outline_width`: Cursor indicator thickness (default: 3px)

**Click Merging** (`backend/main.py`):
- `_merge_timeout`: Time window to match clicks (default: 2.0 seconds)
- `_merge_distance_px`: Distance threshold to match clicks (default: 50 pixels)

### Frontend Configuration

**UI Settings** (`frontend/renderer/app.js`):
- Default Hz: 1.0
- Activity list auto-updates every 1 second

### Extension Configuration

**Content Script** (`extension/content.js`):
- Capture delay: 50ms after click
- Text extraction depth: Traverses up to parent elements
- Screenshot path included in click data

## 💾 Data Storage

### CSV Format (`clicks.csv`)
Columns:
- `timestamp_utc`: ISO timestamp with milliseconds
- `x`, `y`: Click coordinates (display-relative)
- `app_name`: Application name (e.g., "chrome.exe")
- `process_id`: Process ID
- `window_title`: Window title at time of click
- `display_id`: Monitor number (1, 2, etc.)
- `source`: Data source ("ext" or "os")
- `url_or_path`: URL or file path
- `doc_path`: PDF path (for file:// URLs)
- `text`: Extracted text content
- `screenshot_path`: Absolute path to screenshot

### NDJSON Format (`clicks.ndjson`)
Newline-delimited JSON with same fields as CSV, one record per line.

**Example Record:**
```json
{
  "timestamp_utc": "2025-11-10T12:42:11.364Z",
  "x": 654,
  "y": 458,
  "app_name": "chrome.exe",
  "process_id": 22520,
  "window_title": "Feed | LinkedIn",
  "display_id": 2,
  "source": "ext",
  "url_or_path": "https://www.linkedin.com/feed/",
  "text": "Full post content extracted...",
  "screenshot_path": "C:\\...\\2025-11-10\\2025-11-10T12-42-11.364Z.png",
  "doc_path": null
}
```

### Screenshot Files

**1Hz Continuous Screenshots:**
- Location: `data/YYYY-MM-DD/screenshots/`
- Naming: `YYYY-MM-DDTHH-MM-SS.mmmZ.png`
- Purpose: Full desktop activity archival
- Not linked to specific clicks

**On-Demand Click Screenshots:**
- Location: `data/YYYY-MM-DD/`
- Naming: `YYYY-MM-DDTHH-MM-SS.mmmZ.png`
- Purpose: Visual context for each click
- Path stored in click records

## 🔧 Troubleshooting

### Backend Issues

**Screenshots not being captured:**
```bash
# Check if backend is running
curl http://127.0.0.1:8000/status

# Start capture manually
curl -X POST http://127.0.0.1:8000/start
```

**Permission errors on Windows:**
- Run terminal as Administrator for OS-level click tracking
- Check antivirus isn't blocking `pynput`

**Import errors:**
```bash
# Reinstall dependencies
pip install -r requirements.txt --force-reinstall
```

### Extension Issues

**Clicks not being captured:**
1. Check extension is loaded: `chrome://extensions/`
2. Verify backend is running: `curl http://127.0.0.1:8000/status`
3. Check browser console (F12) for errors
4. Look for `[Capture]` logs in console

**CORS errors:**
- Backend has `allow_origins=["*"]` configured
- Should not have CORS issues

**Text extraction not working:**
- Extension may need page refresh after installation
- Some sites use shadow DOM (may not extract correctly)

### Electron Issues

**App won't start:**
```bash
# Clear node_modules and reinstall
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**Screenshots not showing in Activities:**
- Check that clicks have `screenshot_path` in `clicks.ndjson`
- Verify backend `/start` was called (check status)

**"Start Tracking" doesn't work:**
- Ensure backend is running first
- Check Electron console for HTTP errors
- Backend must be on `http://127.0.0.1:8000`

### Data Issues

**CSV/NDJSON not updating:**
- Check file permissions in `data/` folder
- Verify backend has write access
- Check backend logs for errors

**Screenshots folder empty:**
- Confirm `/start` endpoint was called
- Check `capture_running` in `/status` response
- Look for errors in backend terminal

## 📝 Development Notes

### Key Design Decisions

1. **Separate Screenshot Storage**: 1Hz screenshots go to `screenshots/` subfolder to avoid mixing with click-specific screenshots
2. **No Screenshots UI in Electron**: Removed to prevent confusion; screenshots only shown in Activities when attached to clicks
3. **HTTP vs Native Messaging**: Extension uses direct HTTP to backend (simpler than native messaging)
4. **Dual Format Storage**: CSV for spreadsheet analysis, NDJSON for programmatic processing

### Future Enhancements

- [ ] Add filter/search in Activities view
- [ ] Support for macOS and Linux
- [ ] Video recording instead of screenshots
- [ ] Cloud storage integration
- [ ] Privacy mode (pause capture)
- [ ] Screenshot compression options
- [ ] Export to database (SQLite/PostgreSQL)

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.

---

**Built with:** Python • FastAPI • Electron • Chrome Extension API • MSS • Pillow

