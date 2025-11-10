@echo off
echo ========================================
echo Packaging Chrome Extension
echo ========================================

REM Check if in extension directory
if not exist "manifest.json" (
    echo ERROR: Please run this script from the extension directory
    pause
    exit /b 1
)

echo.
echo Creating extension package...
echo.

REM Create a zip file of the extension
if exist "desktop-capture-extension.zip" (
    del "desktop-capture-extension.zip"
)

REM Use PowerShell to create zip
powershell -Command "Compress-Archive -Path manifest.json, background.js, content.js, *.html -DestinationPath desktop-capture-extension.zip -Force"

if exist "desktop-capture-extension.zip" (
    echo.
    echo ========================================
    echo ✅ Extension packaged successfully!
    echo ========================================
    echo.
    echo Package: desktop-capture-extension.zip
    echo.
    echo To install in Chrome:
    echo   1. Open Chrome and go to chrome://extensions/
    echo   2. Enable "Developer mode" (top right)
    echo   3. Click "Load unpacked"
    echo   4. Select the extension folder
    echo.
    echo To distribute:
    echo   - Share desktop-capture-extension.zip
    echo   - Users extract and load unpacked
    echo   - Or submit to Chrome Web Store for public distribution
    echo.
) else (
    echo.
    echo ❌ Failed to create extension package
    echo.
)

pause
