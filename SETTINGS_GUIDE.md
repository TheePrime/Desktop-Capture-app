# Settings Guide

## Data Folder Configuration

The Desktop Capture App now includes a **Settings** panel where you can configure where your screenshots and click data are saved.

### Accessing Settings

1. **Open the Desktop Capture App**
2. **Click "Settings"** in the left sidebar navigation
3. You'll see the Settings panel with data storage options

### Default Data Locations

**Development Mode:**
```
C:\Users\Admin\OneDrive\Desktop\Projects\desktop-capture-app\data\
```

**Production (Installed App):**
```
C:\Users\Admin\AppData\Local\Desktop Capture\data\
```

### Folder Structure

Regardless of location, data is organized as:
```
<Data Folder>/
└── YYYY-MM-DD/              (e.g., 2025-11-10)
    ├── screenshots/          ← 1Hz background screenshots
    │   ├── screenshot_001.png
    │   ├── screenshot_002.png
    │   └── ...
    ├── clicks.csv            ← Click data (CSV format)
    ├── clicks.ndjson         ← Click data (NDJSON format)
    └── screenshot_*.png      ← On-demand click screenshots
```

## Available Settings

### 1. Change Data Folder

**Steps:**
1. Go to **Settings** → **Data Storage**
2. Click **"Browse..."** button
3. Select a new folder (or create one)
4. The app will immediately start saving to the new location

**Use Cases:**
- Save to an external drive for backups
- Use a cloud-synced folder (OneDrive, Dropbox, etc.)
- Organize data by project or timeframe
- Save to a network drive for team sharing

### 2. Reset to Default

Click **"Reset to Default"** to restore the default data location:
- Development: `project/data/`
- Production: `AppData\Local\Desktop Capture\data\`

### 3. Open Data Folder

Click **"Open Data Folder in Explorer"** to quickly access your saved screenshots and data files.

This is useful for:
- Viewing screenshots outside the app
- Backing up data manually
- Sharing specific screenshots
- Analyzing CSV/NDJSON files

## Technical Details

### How It Works

1. **Electron Frontend** stores the custom path in app settings
2. **Backend API** receives the new path via `/config` endpoint
3. **All new captures** save to the updated location
4. **Existing data** remains in the old location (not moved automatically)

### Backend API Update

The `/config` endpoint now accepts:
```json
{
  "hz": 1.0,
  "output_base": "C:\\Users\\Admin\\Documents\\DesktopCapture\\data"
}
```

### Data Migration

**To move existing data to a new folder:**

1. Stop tracking in the app
2. Manually copy/move files from old folder to new folder
   ```
   Old: C:\Users\Admin\AppData\Local\Desktop Capture\data\
   New: <Your New Folder>\data\
   ```
3. Change data folder in Settings
4. Start tracking again

## Quick Access to Data

### Windows Quick Access

**Add to Quick Access:**
1. Open Data Folder from Settings
2. Right-click the folder in Explorer
3. Click "Pin to Quick Access"

**Create Desktop Shortcut:**
1. Open Data Folder from Settings
2. Right-click the folder
3. Send to → Desktop (create shortcut)

### Command Line Access

**PowerShell:**
```powershell
# Production app data
explorer "$env:LOCALAPPDATA\Desktop Capture\data"

# Development data
explorer "C:\Users\Admin\OneDrive\Desktop\Projects\desktop-capture-app\data"
```

## Best Practices

### Storage Location

✅ **Good locations:**
- Local SSD for fast access
- Cloud-synced folder for automatic backup
- External drive for large datasets

❌ **Avoid:**
- Network drives (slow, connection issues)
- System folders (requires admin rights)
- Temporary folders (may be cleaned up)

### Backup Strategy

**Automatic Backup:**
- Use OneDrive/Dropbox sync folder
- Data automatically backs up to cloud

**Manual Backup:**
- Use Settings → "Open Data Folder"
- Copy entire date folders to backup location
- Consider weekly/monthly archives

### Disk Space

**Monitor disk usage:**
- 1Hz screenshots ≈ 100-500 KB each
- 3600 screenshots/hour ≈ 360-1800 MB/hour
- Adjust capture rate in Settings if needed

## Troubleshooting

### "Failed to change data folder"

**Solution:**
- Ensure folder is writable (not read-only)
- Check permissions for the selected folder
- Try creating a new folder instead of using existing

### "Screenshots not appearing in new folder"

**Solution:**
1. Stop tracking
2. Restart the app
3. Start tracking again
4. Verify Settings shows correct path

### "Backend not updating path"

**Solution:**
- Backend must be running
- Check if backend started successfully
- Restart the entire application

## Future Enhancements

Planned features:
- Automatic data migration when changing folders
- Compression options for old screenshots
- Retention policies (auto-delete after X days)
- Export entire dataset to ZIP
- Cloud storage integration (S3, Azure Blob)
