# Production Build - Quick Reference

## 🎯 One-Command Build

From the project root directory, run:

```bash
build_production.bat
```

That's it! This will:
✅ Build backend into standalone executable
✅ Build Electron app with installer
✅ Package everything together

---

## 📦 What You'll Get

After the build completes, you'll have:

### Main Installer
📍 `frontend/dist/Desktop Capture Setup 1.0.0.exe`

**This is what you distribute to users!**
- Single .exe installer
- Includes backend service
- No Python or Node.js required
- ~200 MB file size

### Chrome Extension
📍 `extension/desktop-capture-extension.zip`

**Distribute alongside the installer**
- Users load it as unpacked extension
- Or extract and zip as needed

---

## 🚀 For Distribution

Share with users:
1. `Desktop Capture Setup 1.0.0.exe` - Main app
2. `desktop-capture-extension.zip` - Chrome extension
3. Installation instructions (see below)

---

## 📖 User Installation Instructions

### Step 1: Install Desktop App

1. Run `Desktop Capture Setup 1.0.0.exe`
2. Follow the installer wizard
3. App installs to `C:\Program Files\Desktop Capture\`
4. Desktop shortcut is created automatically

### Step 2: Install Chrome Extension

1. Extract `desktop-capture-extension.zip`
2. Open Chrome → go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select the extracted folder

### Step 3: Launch & Use

1. Open "Desktop Capture" from desktop shortcut
2. Backend starts automatically in background
3. Click "Start Tracking" in the app
4. Click anywhere in Chrome to capture

**Data Location:**
- Windows: `C:\Users\[YourName]\AppData\Local\Programs\desktop-capture\resources\data\`
- Or wherever you installed the app

---

## 🔧 Developer Build Workflow

### First Time Setup

1. **Install build tools:**
   ```bash
   # Backend
   cd backend
   pip install pyinstaller
   
   # Frontend
   cd frontend
   npm install --save-dev electron-builder
   ```

2. **Build everything:**
   ```bash
   build_production.bat
   ```

### Subsequent Builds

**Quick rebuild (after code changes):**
```bash
# Backend only
cd backend
build_backend.bat

# Frontend only
cd frontend
build_frontend.bat

# Full rebuild
build_production.bat
```

---

## ⚡ Development vs Production

### Development Mode (Current Setup)

**Backend:**
```bash
cd backend
uvicorn main:app --reload
```

**Frontend:**
```bash
cd frontend
npx electron .
```

**Extension:**
- Load unpacked from `extension/` folder

### Production Mode (After Build)

**Everything in one installer:**
- Double-click `Desktop Capture Setup 1.0.0.exe`
- Backend runs automatically
- No command line needed
- No Python/Node.js required

---

## 📋 Build Checklist

Before distributing to users:

**Build:**
- [ ] Run `build_production.bat`
- [ ] Verify `backend/dist/backend_service.exe` created
- [ ] Verify `frontend/dist/Desktop Capture Setup 1.0.0.exe` created
- [ ] Package extension with `extension/package_extension.bat`

**Test:**
- [ ] Install on clean Windows machine (no Python/Node)
- [ ] Verify backend starts automatically
- [ ] Test "Start Tracking" button
- [ ] Test Chrome extension click capture
- [ ] Test screenshot capture and storage
- [ ] Test data export functionality

**Distribute:**
- [ ] Upload installer to release location
- [ ] Include extension .zip file
- [ ] Provide installation instructions
- [ ] Include README and documentation

---

## 🆘 Troubleshooting

### "Backend executable not found" during frontend build
**Solution:** Build backend first
```bash
cd backend
build_backend.bat
```

### "PyInstaller not found"
**Solution:** Install it
```bash
pip install pyinstaller
```

### "electron-builder not found"
**Solution:** Install it
```bash
cd frontend
npm install --save-dev electron-builder
```

### Build fails with permission errors
**Solution:** Close all running instances and try again
- Close Electron app
- Stop backend (Ctrl+C in terminal)
- Close any file explorers in project folders

---

## 📏 File Sizes

**Backend:**
- Source: ~50 MB
- Built executable: ~80 MB

**Frontend:**
- Source (with node_modules): ~200 MB
- Built installer: ~200 MB

**Total distribution:**
- Main installer: ~200 MB
- Extension zip: <1 MB

---

## 🔄 Updating Version

To release version 1.0.1:

1. Edit `frontend/package.json`:
   ```json
   {
     "version": "1.0.1"
   }
   ```

2. Rebuild:
   ```bash
   build_production.bat
   ```

3. New installer: `Desktop Capture Setup 1.0.1.exe`

---

## 📞 Support

For detailed build instructions, see:
- `BUILD_INSTRUCTIONS.md` - Complete build guide
- `README.md` - Project overview
- `DOCUMENTATION.md` - Technical details

---

**Ready to build?** Run `build_production.bat` now! 🚀
