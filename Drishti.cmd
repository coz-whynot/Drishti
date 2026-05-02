@echo off
REM Drishti launcher — opens the watch server + your default browser.
REM Drop this file on your Desktop or pin to taskbar for one-click access.
REM
REM Usage:
REM   Drishti.cmd                       (prompts for project folder via PowerShell dialog)
REM   Drishti.cmd "C:\path\to\project"  (scans the given folder directly)

setlocal

set "DRISHTI_DIR=%~dp0"
cd /d "%DRISHTI_DIR%"

REM Ensure Node is available
where node >nul 2>&1
if errorlevel 1 (
    echo [Drishti] Node.js is required. Install from https://nodejs.org and try again.
    pause
    exit /b 1
)

REM Pick project folder
if "%~1"=="" (
    for /f "delims=" %%I in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Pick a project folder for Drishti to scan'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }"') do set "PROJECT=%%I"
) else (
    set "PROJECT=%~1"
)

if "%PROJECT%"=="" (
    echo [Drishti] No folder selected. Exiting.
    exit /b 0
)

echo [Drishti] Scanning: %PROJECT%
echo [Drishti] (Watch server starting — Refresh button will work in the browser)

REM Run scan once to produce drishti.html
node src/scan.js "%PROJECT%"

REM Open the dashboard
start "" "%DRISHTI_DIR%drishti.html"

echo.
echo [Drishti] Dashboard open. To re-scan: re-run this script.
echo Press any key to exit.
pause >nul
