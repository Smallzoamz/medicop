@echo off
setlocal enabledelayedexpansion

:: Read APP_VERSION from index.html using PowerShell (more reliable)
for /f "usebackq tokens=*" %%a in (`powershell -Command "(Get-Content public\index.html | Select-String 'const APP_VERSION').ToString() -replace '.*= ''(.*)''.*', '$1'"`) do set VERSION=%%a

echo.
echo ===============================================
echo   Deploying Medical OP Systems v%VERSION%
echo ===============================================
echo.

:: Deploy hosting
echo [1/2] Deploying to Firebase Hosting...
call firebase deploy --only hosting

if %errorlevel% neq 0 (
    echo ERROR: Deploy failed!
    exit /b 1
)

:: Update version in Firebase to trigger Force Refresh
echo.
echo [2/2] Updating Firebase version to trigger Force Refresh...
curl "https://asia-southeast1-medic-op.cloudfunctions.net/updateVersion?version=%VERSION%&secret=medic2024"

echo.
echo ===============================================
echo   Deploy Complete! Version: %VERSION%
echo   All users will get Force Refresh popup.
echo ===============================================
