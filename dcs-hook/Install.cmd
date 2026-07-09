@echo off
REM ==================================================================
REM  DCS:OPT Ops Bot - DCS Hook Installer
REM  Double-click this file. It finds your DCS folder and installs the
REM  hook automatically. Nothing else to configure.
REM ==================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
