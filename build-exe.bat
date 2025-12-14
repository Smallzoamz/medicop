@echo off
chcp 65001 >nul
echo ========================================
echo   Medical OP Systems - Build Script
echo ========================================
echo.

cd /d f:\MedicRecruitment

echo [1/4] กำลัง Copy ไฟล์ index.html ล่าสุด...
copy "public\index.html" "electron-app\src\index.html" /Y
if errorlevel 1 (
    echo ❌ Copy ไม่สำเร็จ!
    pause
    exit /b 1
)
echo ✅ Copy index.html สำเร็จ

echo.
echo [2/4] กำลัง Copy ไฟล์ logo.jpg...
copy "electron-app\src\logo.jpg" "electron-app\src\logo.jpg" /Y 2>nul
echo ✅ Logo พร้อมใช้งาน

echo.
echo [3/4] กำลัง Build Electron App...
cd electron-app
call npm run build
if errorlevel 1 (
    echo ❌ Build ไม่สำเร็จ!
    pause
    exit /b 1
)
echo ✅ Build สำเร็จ!

echo.
echo ========================================
echo   ✅ เสร็จสมบูรณ์!
echo ========================================
echo.
echo ไฟล์อยู่ที่:
echo   - dist\win-unpacked\Medical OP Systems.exe
echo   - dist\Medical OP Systems Setup [VERSION].exe
echo.
pause
