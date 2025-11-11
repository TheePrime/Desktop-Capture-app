# Distribution Checklist

Use this checklist when distributing the Desktop Capture App to other devices.

## Pre-Distribution Build

### 1. Verify All Code Changes
- [ ] All features tested and working on development machine
- [ ] Backend CORS/PNA headers configured correctly
- [ ] Extension simplified (no Native Messaging)
- [ ] Data folder defaults to Documents\DesktopCapture
- [ ] UI screenshot preview area optimized

### 2. Clean Build Environment
```powershell
# Remove old build artifacts
Remove-Item -Path "backend\dist" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "backend\build" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "frontend\dist" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "frontend\out" -Recurse -Force -ErrorAction SilentlyContinue
```

### 3. Build Production Files
```powershell
# From project root
.\build_production.bat
```

**Expected Output:**
- `frontend\dist\Desktop Capture Setup 1.0.0.exe` (~100-150 MB)
- `backend\dist\backend_service.exe` (~30-40 MB, embedded in installer)

### 4. Package Extension
```powershell
# Create extension zip
Compress-Archive -Path extension\* -DestinationPath desktop-capture-extension.zip -Force
```

**Verify extension contents:**
- [ ] manifest.json
- [ ] background.js (simplified, no Native Messaging)
- [ ] content.js (HTTP only, no port connections)
- [ ] popup.html
- [ ] popup.js
- [ ] icon files (if any)

## Files to Distribute

### Required Files
1. **Desktop Capture Setup 1.0.0.exe** - Main installer
2. **desktop-capture-extension.zip** - Chrome extension package

### Optional Files
3. **PORTABLE_SETUP.md** - Setup instructions
4. **README.md** - General documentation
5. **EXTENSION_FIX.md** - Technical details about CORS fixes

## Distribution Package

Create a folder structure:
```
DesktopCapture-v1.0.0/
├── Desktop Capture Setup 1.0.0.exe
├── desktop-capture-extension.zip
├── SETUP_INSTRUCTIONS.txt
└── README.txt
```

### SETUP_INSTRUCTIONS.txt Template
```
DESKTOP CAPTURE APP - INSTALLATION INSTRUCTIONS
================================================

STEP 1: Install the Desktop App
---------------------------------
1. Double-click "Desktop Capture Setup 1.0.0.exe"
2. Follow the installation wizard
3. Click Install
4. Wait for installation to complete
5. Click Finish

STEP 2: Install Chrome Extension
---------------------------------
1. Unzip "desktop-capture-extension.zip"
2. Open Google Chrome
3. Go to: chrome://extensions
4. Turn ON "Developer mode" (top right corner)
5. Click "Load unpacked"
6. Select the unzipped "extension" folder
7. Extension icon should appear in toolbar

STEP 3: Start Using
--------------------
1. Launch "Desktop Capture" from desktop shortcut
2. Click "Start Tracking" button
3. Browse any website in Chrome
4. Click on posts, articles, or any content
5. View captured data in the app's Activities tab

DATA LOCATION
-------------
All screenshots and click data are saved to:
C:\Users\[YourUsername]\Documents\DesktopCapture

REQUIREMENTS
------------
- Windows 10 or later (64-bit)
- Google Chrome browser
- 4 GB RAM minimum
- 500 MB disk space + space for screenshots

TROUBLESHOOTING
---------------
If extension shows CORS errors:
1. Make sure Desktop Capture app is running
2. Status should show "Active" (green)
3. Reload extension: chrome://extensions → click reload
4. Refresh the webpage

If screenshots aren't captured:
1. Click "Start Tracking" in the app
2. Wait 1-2 seconds for first screenshot
3. Check Documents\DesktopCapture folder

SUPPORT
-------
Check the PORTABLE_SETUP.md file for detailed troubleshooting.
```

## Target Device Requirements

### Check Before Distribution
- [ ] Target device is Windows 10 or later (64-bit)
- [ ] Google Chrome is installed (or will be)
- [ ] At least 4 GB RAM
- [ ] At least 500 MB free disk space
- [ ] User has admin rights (for installation)

### Antivirus Considerations
- [ ] Warn users that some antivirus may flag backend_service.exe
- [ ] Provide instructions to add to exclusions if needed

## Installation Testing (Target Device)

### Test on Fresh Windows Installation
1. [ ] Install app from exe
2. [ ] Launch app successfully
3. [ ] Backend starts (status shows "Active")
4. [ ] Click "Start Tracking"
5. [ ] Install extension from zip
6. [ ] Extension loads without errors
7. [ ] Navigate to any website (e.g., Twitter, LinkedIn)
8. [ ] Click on content
9. [ ] Verify in browser console: "Successfully sent to backend via HTTP"
10. [ ] Check app Activities tab - click should appear
11. [ ] Verify screenshot was captured
12. [ ] Check Documents\DesktopCapture folder - files exist

### Test CORS/PNA Handling
1. [ ] Go to HTTPS website (LinkedIn, Twitter, etc.)
2. [ ] Open browser console (F12)
3. [ ] Click on content
4. [ ] Should NOT see CORS errors
5. [ ] Should see: `[Capture] Successfully sent to backend via HTTP`
6. [ ] Backend should log the request

### Test Extension Toggle
1. [ ] Click extension icon
2. [ ] Toggle OFF (switch should turn gray)
3. [ ] Click on content - should NOT capture
4. [ ] Toggle ON (switch should turn green)
5. [ ] Click on content - should capture

### Test Data Storage
1. [ ] Check default folder: `C:\Users\[Username]\Documents\DesktopCapture`
2. [ ] Verify folder structure: `YYYY-MM-DD\screenshots\`
3. [ ] Verify files: clicks.ndjson, clicks.csv, *.png
4. [ ] Open Settings in app
5. [ ] Browse to new folder
6. [ ] Click on content
7. [ ] Verify new folder is used

## Known Issues & Workarounds

### Issue: CORS "Permission was denied" Error
**Cause:** Chrome's Private Network Access policy  
**Fix:** Backend now includes OPTIONS preflight handler  
**Status:** Fixed in v1.0.0

### Issue: "Could not establish connection" Errors
**Cause:** Old extension code trying to connect to background script  
**Fix:** Extension simplified to use HTTP only  
**Status:** Fixed in v1.0.0

### Issue: Screenshots Not Visible in UI
**Cause:** Preview area too small  
**Fix:** UI layout optimized, screenshot area enlarged  
**Status:** Fixed in v1.0.0

## Version Tracking

### v1.0.0 - Release Candidate
**Date:** November 11, 2025

**Changes:**
- ✅ Fixed CORS/PNA for extension → backend communication
- ✅ Removed Native Messaging dependency
- ✅ Changed default data location to Documents folder
- ✅ Added Settings panel for data folder configuration
- ✅ Added extension ON/OFF toggle
- ✅ Enlarged screenshot preview area in UI
- ✅ Complete production build system

**Known Issues:**
- None

**Testing Status:**
- [x] Works on primary device
- [ ] Works on secondary device (pending)
- [ ] Works on fresh Windows install (pending)

## Post-Distribution Support

### User Feedback Checklist
- [ ] Installation successful?
- [ ] App launches without errors?
- [ ] Extension loads in Chrome?
- [ ] Click capture working?
- [ ] Screenshots being saved?
- [ ] Data folder accessible?
- [ ] Any antivirus warnings?
- [ ] Performance acceptable?

### Common User Questions

**Q: Where are my screenshots?**  
A: `C:\Users\[YourUsername]\Documents\DesktopCapture\[Date]\screenshots\`

**Q: Can I change where files are saved?**  
A: Yes, click Settings in the app, then Browse to select a new folder.

**Q: Does this work on Mac/Linux?**  
A: No, currently Windows only.

**Q: Does this upload my data anywhere?**  
A: No, all data stays on your local machine. No internet required.

**Q: Can I use this with Firefox?**  
A: Not yet, currently Chrome only.

**Q: How do I uninstall?**  
A: Windows Settings → Apps → Desktop Capture → Uninstall

## Update Distribution (Future Versions)

When releasing updates:
1. Update version number in `frontend\package.json`
2. Update version in `PORTABLE_SETUP.md`
3. Rebuild: `.\build_production.bat`
4. Create changelog
5. Test on clean device
6. Distribute new installer
7. Users can install over existing version

---

## Quick Distribution Checklist

**Before sending to users:**
- [ ] Build completed successfully
- [ ] Tested on development machine
- [ ] Extension packaged as zip
- [ ] Setup instructions included
- [ ] Version number documented
- [ ] Known issues documented

**Files to send:**
- [ ] Desktop Capture Setup 1.0.0.exe
- [ ] desktop-capture-extension.zip
- [ ] SETUP_INSTRUCTIONS.txt

**User receives:**
- [ ] All files downloaded
- [ ] Instructions read
- [ ] Antivirus configured (if needed)
- [ ] Installation successful
- [ ] Extension working
- [ ] Clicks being captured ✅
