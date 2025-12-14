@echo off
chcp 65001 >nul

echo.
echo ========================================
echo   Medical OP Systems - Deploy
echo ========================================
echo.

cd /d f:\medicop

set VERSION=1.5.3

echo 📦 Version: %VERSION%
echo.

:: Step 1: Remind to sync versions
echo [1/3] ตรวจสอบ Version...
echo    ⚠️  กรุณาอัพเดท version ทั้ง 2 ไฟล์ให้ตรงกัน:
echo       - public/index.html (Web version)
echo       - electron-app/src/index.html (Electron version)
echo       - electron-app/package.json
echo.

:: Step 2: Deploy Firebase
echo [2/3] กำลัง Deploy Firebase Hosting...
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
echo [3/3] Push ไป GitHub เพื่อ trigger EXE build...
git add .
git commit -m "v%VERSION%: Deploy update"
git push origin main

echo.
echo ========================================
echo   ✅ Deploy Complete! v%VERSION%
echo ========================================
echo.
echo 🌐 Web: https://medic-op.web.app
echo.
echo 📦 EXE: จะถูก build อัตโนมัติบน GitHub Actions
echo    ดูสถานะที่: https://github.com/Smallzoamz/medicop/actions
echo    หลัง build เสร็จ: https://github.com/Smallzoamz/medicop/releases
echo.
pause
