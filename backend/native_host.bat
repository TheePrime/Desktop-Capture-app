@echo off
echo [%date% %time%] Native host bat file starting >> "C:\Users\Admin\OneDrive\Desktop\Projects\desktop-capture-app\backend\native_host_bat.log" 2>&1
"C:\Users\Admin\OneDrive\Desktop\Projects\desktop-capture-app\backend\venv\Scripts\python.exe" "C:\Users\Admin\OneDrive\Desktop\Projects\desktop-capture-app\backend\native_host.py" 2>> "C:\Users\Admin\OneDrive\Desktop\Projects\desktop-capture-app\backend\native_host_bat.log"

