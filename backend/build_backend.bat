@echo off
echo ========================================
echo Building Desktop Capture Backend
echo ========================================

REM Check if in backend directory
if not exist "main.py" (
    echo ERROR: Please run this script from the backend directory
    pause
    exit /b 1
)

echo.
echo Step 1: Installing PyInstaller...
pip install pyinstaller

echo.
echo Step 2: Building executable with PyInstaller...
python -m PyInstaller backend_service.spec --clean

if exist "dist\backend_service.exe" (
    echo.
    echo ========================================
    echo ✅ Build successful!
    echo ========================================
    echo.
    echo Executable location: dist\backend_service.exe
    echo.
    echo To test the build:
    echo   1. cd dist
    echo   2. backend_service.exe
    echo   3. Open browser to http://127.0.0.1:8000/status
    echo.
) else (
    echo.
    echo ❌ Build failed! Check the output above for errors.
    echo.
)

pause
