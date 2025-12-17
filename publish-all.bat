@echo off
chcp 65001 >nul

echo.
echo ========================================
echo   Medical OP Systems - Auto Deploy
echo ========================================
echo.

cd /d f:\medicop

:: Step 0: Handle local changes before syncing
echo [0/4] กำลังเตรียมความพร้อมของ Code...

:: Check for local changes (unstaged or uncommitted)
git status --porcelain | find /c /v "" > tmp_changes.txt
set /p CHANGES=<tmp_changes.txt
del tmp_changes.txt

if "%CHANGES%" NEQ "0" (
    echo 📝 ตรวจพบการแก้ไขในเครื่อง... กำลัง Save งานเบื้องต้น...
    git add .
    git commit -m "Save local changes before auto-sync (Auto)"
)

:: Sync with GitHub
echo 🔍 กำลังตรวจสอบความล่าช้าของ Code กับ GitHub...
git fetch origin main >nul 2>&1
git pull --rebase origin main
if errorlevel 1 (
    echo.
    echo ❌ ERROR: ไม่สามารถ Pull ข้อมูลจาก GitHub ได้ (อาจมี Conflict รุนแรง)
    echo กรุณาจัดการ Conflict ด้วยตนเองก่อนรันใหม่อีกครั้ง
    pause
    exit /b 1
)

:: Step 1: Increment build number and sync all versions
echo.
echo [1/4] กำลังอัพเดท Build Number...
cd electron-app
call node increment-build.js
if errorlevel 1 (
    echo ❌ ERROR: ไม่สามารถเพิ่ม Build Number ได้
    pause
    exit /b 1
)
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
curl -s "https://asia-southeast1-medic-op.cloudfunctions.net/updateVersion?version=%VERSION%&secret=medic2024" >nul
echo.
echo ✅ Firebase Deploy สำเร็จ

:: Step 3: Push to GitHub (triggers GitHub Actions to build EXE)
echo.
echo [3/4] Push ไป GitHub เพื่อ trigger EXE build...
git add .
git commit -m "v%VERSION%: Deploy update (Auto)"
git push origin main
if errorlevel 1 (
    echo ❌ ERROR: ไม่สามารถ Push ไป GitHub ได้
    pause
    exit /b 1
)

echo.
echo ========================================
echo   ✅ Deploy Complete! %VERSION%
echo ========================================
echo.
echo 🌐 Web: https://medic-op.web.app
echo 📦 EXE: จะถูก build อัตโนมัติบน GitHub Actions
echo.
echo [4/4] สรุป:
echo    ✅ Build Number เพิ่มอัตโนมัติ
echo    ✅ Sync ทุก Version เรียบร้อย
echo    ✅ Force Refresh อัปเดตแล้ว
echo.
echo ⏳ จะปิดหน้าต่างใน 10 วินาที...
timeout /t 10
