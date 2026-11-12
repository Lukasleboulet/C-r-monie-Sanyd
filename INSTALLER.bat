@echo off
chcp 65001 >nul
title Installation - SAMP Sandy Shore
echo.
echo  Installation de Node.js et de Cloudflare Tunnel (cloudflared)...
echo  (Windows peut demander une autorisation : accepte.)
echo.
winget --version >nul 2>&1
if errorlevel 1 (
  echo  [!] winget est introuvable. Installe "App Installer" depuis le Microsoft Store, puis relance ce fichier.
  pause
  exit /b 1
)
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
cd /d "%~dp0"
if not exist config.json copy config.example.json config.json >nul
echo.
echo  ============================================================
echo   Installation terminee.
echo   1. Ouvre config.json (Bloc-notes) et colle ton Client ID
echo      et ta cle secrete Discord.
echo   2. Lance DEMARRER.bat
echo  ============================================================
echo.
pause
