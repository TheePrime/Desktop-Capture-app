# Portable Setup Guide

This guide explains how to use the Desktop Capture App on any Windows device.

## Quick Start (Production Build)

### Option 1: Using the Installer (Recommended)

1. **Install the Desktop App:**
   - Run `Desktop Capture Setup 1.0.0.exe`
   - Follow the installation wizard
   - The app will be installed to `C:\Users\[Username]\AppData\Local\Programs\desktop-capture-app`
   - A desktop shortcut will be created

2. **Install the Chrome Extension:**
   - Unzip `desktop-capture-extension.zip`
   - Open Chrome and go to `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the unzipped `extension` folder
   - The extension icon should appear in your toolbar

3. **Start Using:**
   - Launch the Desktop Capture app from the desktop shortcut
   - Click "Start Tracking" in the app
   - Browse any website in Chrome
   - Click on content (posts, articles, etc.)
   - Screenshots and click data are saved to `C:\Users\[Username]\Documents\DesktopCapture`

### Option 2: Portable Mode (No Installation)

If you want to run without installing:

1. **Copy the entire project folder** to the target device
2. **Install Python 3.8+** if not already installed
3. **Install dependencies:**
   ```powershell
   cd backend
   pip install -r requirements.txt
   ```
4. **Install Node.js** if not already installed
5. **Install Electron:**
   ```powershell
   cd frontend
   npm install
   ```
6. **Load the extension** as described above
7. **Run the app:**
   ```powershell
   # Terminal 1: Start backend
   cd backend
   python main.py

   # Terminal 2: Start Electron
   cd frontend
   npx electron .
   ```

## Data Storage

### Default Location
All captured data is saved to:
```
C:\Users\[YourUsername]\Documents\DesktopCapture\
```

### Folder Structure
```
DesktopCapture/
├── 2025-11-11/
│   ├── screenshots/
│   │   ├── 2025-11-11_14-30-00.png
│   │   ├── 2025-11-11_14-30-01.png
│   │   └── ...
│   ├── click_2025-11-11_14-35-22.png
│   ├── clicks.ndjson
│   └── clicks.csv
├── 2025-11-12/
│   └── ...
```

### Changing Data Location

1. Open the Desktop Capture app
2. Click "Settings" in the sidebar
3. Click "Browse..." to select a new folder
4. The backend will automatically use the new location

## Extension Configuration

### Toggle Extension On/Off
- Click the extension icon in Chrome toolbar
- Use the toggle switch to enable/disable click capture
- When OFF, the extension won't capture any clicks

### How It Works
1. Extension captures clicks and text from web pages
2. Sends data to backend at `http://127.0.0.1:8000/ext_event`
3. Backend triggers an on-demand screenshot
4. Data is saved to clicks.ndjson and clicks.csv
5. Electron app displays everything in the Activities tab

## Troubleshooting

### Extension Shows CORS Error

**Symptom:**
```
Access to fetch at 'http://127.0.0.1:8000/ext_event' has been blocked by CORS policy
```

**Solution:**
1. Make sure the backend is running (check if app shows "Active" status)
2. Restart the Desktop Capture app
3. Reload the extension in Chrome (`chrome://extensions` → click reload button)

### No Screenshots Being Captured

**Check:**
1. Backend is running (app status should be "Active")
2. Click "Start Tracking" in the app
3. Check the backend terminal for errors
4. Verify Python dependencies are installed: `pip install -r backend/requirements.txt`

### Extension Not Capturing Clicks

**Check:**
1. Extension toggle is ON (click extension icon, check switch is green)
2. Backend is running on port 8000
3. Open browser console (F12) and look for `[Capture]` messages
4. Should see: `[Capture] Successfully sent to backend via HTTP`

### Port 8000 Already in Use

**Solution:**
```powershell
# Find and kill process using port 8000
Get-NetTCPConnection -LocalPort 8000 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

### App Can't Find Backend Executable (Production)

**Check:**
1. Make sure `backend_service.exe` exists in `resources/backend/`
2. Reinstall using the setup exe
3. Check antivirus didn't quarantine the exe

## System Requirements

### Minimum Requirements
- **OS:** Windows 10 or later (64-bit)
- **RAM:** 4 GB
- **Disk Space:** 500 MB + space for screenshots
- **Browser:** Google Chrome (latest version)
- **Python:** 3.8+ (for development/portable mode only)
- **Node.js:** 16+ (for development/portable mode only)

### Recommended
- **RAM:** 8 GB or more
- **Disk Space:** 10 GB+ for long-term screenshot storage
- **SSD** for better screenshot write performance

## Network Requirements

### Firewall Settings
- The app runs a local server on `127.0.0.1:8000`
- No external network access required
- If Windows Firewall prompts, allow Python to access local network

### Chrome Extension Permissions
- **Required:** Access to all websites (to capture clicks on any page)
- **Storage:** To save extension toggle state
- **All data is sent to localhost only** - nothing leaves your computer

## File Permissions

### Required Permissions
- **Write access** to Documents folder (or custom data location)
- **Execute** permission for backend_service.exe (production)
- **Read access** to screenshots folder for Electron app

### Antivirus Considerations
Some antivirus software may flag:
- `backend_service.exe` (packaged Python app)
- Keyboard/mouse monitoring (pynput library)

**Solution:** Add the app folder to antivirus exclusions

## Updating the App

### Production Build
1. Download the new installer exe
2. Run it - it will update the existing installation
3. Reload the Chrome extension if it was updated

### Development/Portable Mode
1. Pull latest code from repository
2. Update Python dependencies: `pip install -r backend/requirements.txt`
3. Update Node dependencies: `npm install` (in frontend folder)
4. Reload extension in Chrome

## Data Portability

### Moving Data to Another Device
1. Copy the entire `DesktopCapture` folder from Documents
2. On new device, paste to `C:\Users\[YourUsername]\Documents\`
3. Open the app - it will automatically find the data

### Backup Recommendations
- Regular backups of `C:\Users\[YourUsername]\Documents\DesktopCapture`
- Screenshots can be large - use compression for long-term storage
- clicks.csv and clicks.ndjson are small and contain all metadata

## Privacy & Security

### Data Collection
- **All data stays on your local machine**
- No cloud uploads, no external servers
- Backend only listens on localhost (127.0.0.1)

### What's Captured
- Screenshots of your entire desktop (every 1 second by default)
- Screenshots when you click on web content
- Click coordinates and timestamps
- Text content from clicked elements
- Window titles and application names
- URL of the page where you clicked

### What's NOT Captured
- Keyboard input (except window titles)
- Network traffic
- Passwords or sensitive form data
- Private browsing/incognito activity
- Other users' activity

### Data Deletion
To delete all data:
1. Stop the app
2. Delete the folder: `C:\Users\[YourUsername]\Documents\DesktopCapture`
3. Uninstall app (optional)
4. Remove extension from Chrome (optional)

## Building Production Version

If you want to create your own installer:

```powershell
# From project root
.\build_production.bat
```

Output files:
- `frontend\dist\Desktop Capture Setup 1.0.0.exe` - Installer
- `backend\dist\backend_service.exe` - Backend service

Package the extension:
```powershell
Compress-Archive -Path extension -DestinationPath desktop-capture-extension.zip
```

## Support

### Logs Location
- **Backend logs:** `backend\backend_ext.log`
- **Electron logs:** Check app terminal output
- **Extension logs:** Browser console (F12)

### Common Issues
1. **"Could not establish connection"** - Extension background script error (harmless, ignore)
2. **CORS errors** - Backend not running or needs restart
3. **No screenshots** - Check "Start Tracking" is clicked and status is "Active"

### Getting Help
1. Check logs in `backend\backend_ext.log`
2. Check browser console (F12) for extension errors
3. Verify all dependencies are installed
4. Try restarting: Backend → Electron → Browser

---

## Quick Reference

**Start App (Production):**
- Double-click desktop shortcut
- Click "Start Tracking"

**Start App (Development):**
```powershell
# Terminal 1
cd backend
python main.py

# Terminal 2
cd frontend
npx electron .
```

**Reload Extension:**
- `chrome://extensions` → Click reload button

**View Data:**
- Open app → Activities tab
- Or directly: `C:\Users\[YourUsername]\Documents\DesktopCapture`

**Toggle Extension:**
- Click extension icon → Use toggle switch
