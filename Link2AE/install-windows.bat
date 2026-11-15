@echo off
REM ============================================================
REM  Link2AE - Windows installer helper (AE CC 2017 / CEP 6)
REM
REM  What it does:
REM    1. Copies this Link2AE folder to the per-user CEP extensions dir.
REM    2. Enables unsigned (debug) extensions for CEP 6 via the registry.
REM
REM  Run by double-clicking, or from an Administrator Command Prompt if you
REM  prefer the all-users location instead.
REM ============================================================

setlocal

set "EXT_NAME=Link2AE"
set "SRC=%~dp0"
REM Strip trailing backslash from SRC for clean concatenation.
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"

set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_NAME%"

echo.
echo === Link2AE Installer (After Effects CC 2017) ===
echo.
echo Source      : %SRC%
echo Destination : %DEST%
echo.

if not exist "%APPDATA%\Adobe\CEP\extensions" (
    mkdir "%APPDATA%\Adobe\CEP\extensions"
)

echo Copying extension files...
xcopy "%SRC%\*" "%DEST%\" /E /I /Y >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy files. Try running as Administrator.
    pause
    exit /b 1
)
echo Copy complete.
echo.

echo Enabling unsigned extensions for CEP 6 ^(CSXS.6^)...
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.6" /v PlayerDebugMode /t REG_SZ /d 1 /f
if errorlevel 1 (
    echo [WARN] Could not write the registry key. You can set it manually:
    echo        HKEY_CURRENT_USER\Software\Adobe\CSXS.6  ->  PlayerDebugMode = 1
) else (
    echo Registry set: PlayerDebugMode = 1
)
echo.

echo Done. Now:
echo   1. Close and reopen After Effects CC 2017.
echo   2. Open  Window ^> Extensions ^> Link2AE.
echo.
pause
endlocal
