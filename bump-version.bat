@echo off
chcp 65001 >nul

echo.
echo ========================================
echo   Medical OP Systems - Bump Version
echo ========================================
echo.

cd /d f:\medicop\electron-app

:: Show current version
for /f "tokens=2 delims=:," %%a in ('findstr "version" package.json') do (
    set CURRENT=%%~a
)
set CURRENT=%CURRENT: =%
set CURRENT=%CURRENT:"=%

echo 📦 Current Version: %CURRENT%
echo.

:: Ask for new version
set /p NEWVER="🆕 Enter new version (e.g. 1.7.0): "

if "%NEWVER%"=="" (
    echo ❌ ไม่ได้ระบุ version
    pause
    exit /b
)

:: Reset build number to 1
echo {"build": 0} > build-number.json
echo ✅ Build number reset to 0

:: Update package.json with new version
echo.
call node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version='%NEWVER%-build.1';fs.writeFileSync('package.json',JSON.stringify(p,null,4)+'\n');console.log('✅ package.json updated to: '+p.version)"

:: Run increment to update all files
echo.
call node increment-build.js

echo.
echo ========================================
echo   ✅ Version Bump Complete!
echo ========================================
echo.
echo New Version: %NEWVER%-build.1
echo.
echo Next Steps:
echo   1. Test the application
echo   2. Run publish-all.bat to deploy
echo.
pause
