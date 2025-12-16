@echo off
chcp 65001 >nul

echo.
echo ========================================
echo   Medical OP Systems - Deploy
echo ========================================
echo.

cd /d f:\medicop

:: Step 1: Increment build number and sync all versions
echo [1/4] กำลังอัพเดท Build Number...
cd electron-app
call node increment-build.js
cd ..

:: Read new version from package.json for display
for /f "tokens=2 delims=:," %%a in ('findstr "version" electron-app\package.json') do (
    set VERSION=%%~a
)
set VERSION=%VERSION: =%
set VERSION=%VERSION:"=%

echo.
echo 📦 New Version: %VERSION%
echo.

:: Step 2: Deploy Firebase
echo [2/4] กำลัง Deploy Firebase Hosting...
call firebase deploy --only hosting
if errorlevel 1 (
    echo ⚠️ Firebase Deploy มีปัญหา แต่จะดำเนินการต่อ...
)

:: Update Firebase version for Force Refresh
echo.
echo กำลังอัพเดท Firebase version...
curl -s "https://asia-southeast1-medic-op.cloudfunctions.net/updateVersion?version=%VERSION%&secret=medic2024"
echo.
echo ✅ Firebase Deploy สำเร็จ

:: Step 3: Push to GitHub (triggers GitHub Actions to build EXE)
echo.
echo [3/4] Push ไป GitHub เพื่อ trigger EXE build...
git add .
git commit -m "v%VERSION%: Deploy update"
git push origin main

echo.
echo ========================================
echo   ✅ Deploy Complete! %VERSION%
echo ========================================
echo.
echo 🌐 Web: https://medic-op.web.app
echo.
echo 📦 EXE: จะถูก build อัตโนมัติบน GitHub Actions
echo    ดูสถานะที่: https://github.com/Smallzoamz/medicop/actions
echo    หลัง build เสร็จ: https://github.com/Smallzoamz/medicop/releases
echo.
echo [4/4] สรุป:
echo    ✅ Build Number เพิ่มอัตโนมัติ
echo    ✅ Web + Desktop ใช้ version เดียวกัน
echo    ✅ Force Refresh จะทำงานเมื่อ user เปิดเว็บ
echo.
pause
