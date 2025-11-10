# Desktop Capture App - Build Instructions

## 🚀 Quick Start

To build the complete production-ready application, simply run:

```bash
build_production.bat
```

This will automatically:
1. ✅ Build the Python backend into a standalone executable
2. ✅ Build the Electron frontend with installer
3. ✅ Create a distributable package

---

## 📦 Prerequisites

### Required Software

1. **Python 3.8+** (for backend build)
   - Install from: https://www.python.org/downloads/
   - Make sure `pip` is available

2. **Node.js 16+** (for frontend build)
   - Install from: https://nodejs.org/
   - Make sure `npm` is available

3. **Visual Studio Build Tools** (for Python native modules)
   - Install from: https://visualstudio.microsoft.com/downloads/
   - Select "Desktop development with C++"
   - Or install via: `npm install --global windows-build-tools`

### Install Dependencies

**Backend:**
```bash
cd backend
pip install -r requirements.txt
pip install pyinstaller
```

**Frontend:**
```bash
cd frontend
npm install
npm install --save-dev electron-builder
```

---

## 🔨 Building Step-by-Step

### Option 1: Automated Build (Recommended)

From the project root:

```bash
build_production.bat
```

### Option 2: Manual Build

#### Step 1: Build Backend

```bash
cd backend
build_backend.bat
```

This creates: `backend/dist/backend_service.exe`

**Manual PyInstaller command (if script fails):**
```bash
cd backend
pyinstaller backend_service.spec --clean
```

#### Step 2: Build Frontend

```bash
cd frontend
build_frontend.bat
```

This creates: `frontend/dist/Desktop Capture Setup 1.0.0.exe`

**Manual electron-builder command (if script fails):**
```bash
cd frontend
npm run build
```

#### Step 3: Package Extension

```bash
cd extension
package_extension.bat
```

This creates: `extension/desktop-capture-extension.zip`

---

## 📁 Build Output

After a successful build, you'll have:

```
desktop-capture-app/
├── backend/
│   └── dist/
│       └── backend_service.exe          # Backend executable (bundled in Electron app)
├── frontend/
│   └── dist/
│       ├── Desktop Capture Setup 1.0.0.exe    # 📦 MAIN INSTALLER
│       └── win-unpacked/                       # Unpacked app files
└── extension/
    └── desktop-capture-extension.zip    # 📦 Chrome extension package
```

---

## 🎯 Distribution

### For End Users

**Share these files:**
1. `frontend/dist/Desktop Capture Setup 1.0.0.exe` - Main installer
2. `extension/desktop-capture-extension.zip` - Chrome extension

**Installation Instructions:**

1. **Install the App:**
   - Run `Desktop Capture Setup 1.0.0.exe`
   - Follow the installer wizard
   - App will be installed to `C:\Program Files\Desktop Capture\`
   - Desktop shortcut will be created

2. **Install Chrome Extension:**
   - Extract `desktop-capture-extension.zip`
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the extracted extension folder

3. **Run the App:**
   - Launch "Desktop Capture" from Desktop or Start Menu
   - Backend service starts automatically in the background
   - Click "Start Tracking" to begin capturing

---

## 🐛 Troubleshooting Build Issues

### Backend Build Fails

**Error: PyInstaller not found**
```bash
pip install pyinstaller
```

**Error: Module not found during build**
- Add missing module to `hiddenimports` in `backend_service.spec`
- Example: `'module.name'`

**Error: Permission denied**
- Close any running instances of the backend
- Run terminal as Administrator

### Frontend Build Fails

**Error: electron-builder not found**
```bash
cd frontend
npm install --save-dev electron-builder
```

**Error: Backend executable not found**
- Build the backend first: `cd backend && build_backend.bat`
- Verify `backend/dist/backend_service.exe` exists

**Error: NSIS build failed**
- Install NSIS: `npm install nsis` or download from https://nsis.sourceforge.io/

### Extension Package Fails

**Error: PowerShell not available**
- Manual zip: Select files → Right-click → Send to → Compressed folder
- Rename to `desktop-capture-extension.zip`

---

## ⚙️ Build Configuration

### Backend (`backend/backend_service.spec`)

Key settings:
- `name='backend_service'` - Executable name
- `console=True` - Shows console window (for debugging)
- `hiddenimports=[...]` - Modules to include
- `upx=True` - Compression enabled

To change:
1. Edit `backend_service.spec`
2. Run `pyinstaller backend_service.spec --clean`

### Frontend (`frontend/package.json`)

Key settings under `"build"`:
- `appId` - Application ID
- `productName` - Display name
- `win.target` - Build target (NSIS installer)
- `extraResources` - Files to include (backend exe, data folder)

To change:
1. Edit `package.json` → `"build"` section
2. Run `npm run build`

---

## 🔐 Code Signing (Optional)

For production distribution, you should sign your executables:

### Windows Code Signing

1. **Get a Code Signing Certificate**
   - Purchase from: DigiCert, Sectigo, or GlobalSign
   - Costs ~$200-400/year

2. **Configure electron-builder**

In `frontend/package.json`:
```json
{
  "build": {
    "win": {
      "certificateFile": "path/to/certificate.pfx",
      "certificatePassword": "your-password",
      "signingHashAlgorithms": ["sha256"]
    }
  }
}
```

3. **Sign Backend Executable**
```bash
signtool sign /f certificate.pfx /p password /tr http://timestamp.digicert.com /td sha256 /fd sha256 backend_service.exe
```

---

## 📊 Build Performance

**Typical Build Times:**
- Backend (PyInstaller): 2-5 minutes
- Frontend (electron-builder): 3-7 minutes
- **Total**: ~5-12 minutes

**Disk Usage:**
- Backend source: ~50 MB
- Backend dist: ~80 MB
- Frontend source: ~200 MB (with node_modules)
- Frontend dist: ~200 MB (installer)
- **Total build output**: ~280 MB

---

## 🆕 Version Updates

To release a new version:

1. **Update version number:**
   - `frontend/package.json` → `"version": "1.0.1"`

2. **Rebuild:**
   ```bash
   build_production.bat
   ```

3. **New installer will be:**
   - `Desktop Capture Setup 1.0.1.exe`

---

## 📝 Build Checklist

Before distributing:

- [ ] Backend builds successfully (`backend/dist/backend_service.exe` exists)
- [ ] Frontend builds successfully (installer created)
- [ ] Extension packages successfully (.zip created)
- [ ] Test installer on clean Windows machine
- [ ] Test backend starts automatically with Electron app
- [ ] Test extension connects to backend
- [ ] Test click capture and screenshot functionality
- [ ] Test data is saved to correct location
- [ ] Test uninstaller works correctly
- [ ] (Optional) Code signing applied
- [ ] Update README with version number
- [ ] Create release notes

---

## 🚢 Production Checklist

Before releasing to users:

### Testing
- [ ] Install on clean Windows 10/11 machine
- [ ] Verify no Python/Node.js required
- [ ] Test all features (screenshot, click capture, export)
- [ ] Check error handling (backend not running, etc.)
- [ ] Monitor memory usage over time
- [ ] Test with multiple monitors
- [ ] Test with high-DPI displays

### Security
- [ ] Antivirus scan (VirusTotal, etc.)
- [ ] Code signing (recommended)
- [ ] Privacy policy included
- [ ] Data storage location documented

### Documentation
- [ ] User guide (README or separate doc)
- [ ] Installation instructions
- [ ] Troubleshooting guide
- [ ] System requirements listed
- [ ] Known issues documented

---

## 🆘 Support

If you encounter build issues:

1. **Check logs:**
   - Backend: `backend/build/warn-*.txt`
   - Frontend: `frontend/dist/builder-debug.yml`

2. **Clean build:**
   ```bash
   # Backend
   cd backend
   rmdir /s /q build dist
   pyinstaller backend_service.spec --clean
   
   # Frontend
   cd frontend
   rmdir /s /q dist
   npm run build
   ```

3. **Search existing issues:**
   - PyInstaller: https://github.com/pyinstaller/pyinstaller/issues
   - Electron Builder: https://github.com/electron-userland/electron-builder/issues

---

**Build System Version**: 1.0
**Last Updated**: November 10, 2025
