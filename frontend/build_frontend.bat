@echo off
echo ========================================
echo Building Desktop Capture Frontend
echo ========================================

REM Check if in frontend directory
if not exist "main.js" (
    echo ERROR: Please run this script from the frontend directory
    pause
    exit /b 1
)

echo.
echo Step 1: Installing electron-builder...
call npm install --save-dev electron-builder

echo.
echo Step 2: Checking for backend executable...
if not exist "..\backend\dist\backend_service.exe" (
    echo WARNING: Backend executable not found!
    echo Please build the backend first:
    echo   1. cd ..\backend
    echo   2. run build_backend.bat
    echo.
    pause
    exit /b 1
)

echo ✅ Backend executable found!

echo.
echo Step 3: Building Electron app with electron-builder...
call npm run build

if exist "dist\*.exe" (
    echo.
    echo ========================================
    echo ✅ Build successful!
    echo ========================================
    echo.
    echo Installer location: dist\
    dir /b dist\*.exe
    echo.
    echo You can now install and run the application!
    echo.
) else (
    echo.
    echo ❌ Build failed! Check the output above for errors.
    echo.
)

pause
