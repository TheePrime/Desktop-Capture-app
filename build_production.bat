@echo off
echo ========================================
echo Desktop Capture App - Production Build
echo ========================================
echo.

REM Check if in project root
if not exist "backend" (
    echo ERROR: Please run this script from the project root directory
    pause
    exit /b 1
)

if not exist "frontend" (
    echo ERROR: Frontend directory not found
    pause
    exit /b 1
)

echo This script will build the complete production-ready application.
echo.
echo The process includes:
echo   1. Building Python backend into standalone executable
echo   2. Building Electron frontend with installer
echo   3. Creating a complete package
echo.
pause

REM ============================================
REM Step 1: Build Backend
REM ============================================
echo.
echo ========================================
echo Step 1/2: Building Backend
echo ========================================
cd backend

if not exist "build_backend.bat" (
    echo ERROR: build_backend.bat not found in backend directory
    cd ..
    pause
    exit /b 1
)

call build_backend.bat

if not exist "dist\backend_service.exe" (
    echo.
    echo ERROR: Backend build failed!
    cd ..
    pause
    exit /b 1
)

cd ..

REM ============================================
REM Step 2: Build Frontend
REM ============================================
echo.
echo ========================================
echo Step 2/2: Building Frontend
echo ========================================
cd frontend

if not exist "build_frontend.bat" (
    echo ERROR: build_frontend.bat not found in frontend directory
    cd ..
    pause
    exit /b 1
)

call build_frontend.bat

cd ..

REM ============================================
REM Final Summary
REM ============================================
echo.
echo ========================================
echo Build Complete!
echo ========================================
echo.

if exist "frontend\dist\*.exe" (
    echo ✅ SUCCESS! Your installer is ready:
    echo.
    echo Location: frontend\dist\
    echo.
    dir /b frontend\dist\*.exe
    echo.
    echo Next steps:
    echo   1. Run the installer to install the app
    echo   2. The app will automatically start the backend service
    echo   3. Load the Chrome extension from the extension\ folder
    echo.
    echo To distribute:
    echo   - Share the .exe installer from frontend\dist\
    echo   - Package the extension\ folder as a .zip for Chrome
    echo.
) else (
    echo ❌ Build completed but installer not found
    echo Please check the output above for errors
    echo.
)

pause
