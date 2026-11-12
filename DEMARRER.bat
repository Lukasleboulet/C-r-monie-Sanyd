@echo off
chcp 65001 >nul
title SAMP Sandy Shore - tunnel Cloudflare
cd /d "%~dp0"
where node >nul 2>&1 || (echo [!] Node.js introuvable : lance dabord INSTALLER.bat puis redemarre le PC. & pause & exit /b 1)
where cloudflared >nul 2>&1 || (echo [!] cloudflared introuvable : lance dabord INSTALLER.bat puis redemarre le PC. & pause & exit /b 1)
if not exist config.json copy config.example.json config.json >nul
start "Serveur SAMP Sandy Shore (ne pas fermer)" cmd /k node server.js
timeout /t 3 /nobreak >nul
echo.
echo  ==================================================================
echo   Le serveur tourne. Cherche ci-dessous une ligne du type :
echo      https://quelque-chose.trycloudflare.com
echo   Cest ladresse de ton site, a donner a tes collegues.
echo   Dans le portail Discord (OAuth2 - Redirects), mets :
echo      https://quelque-chose.trycloudflare.com/discord.php
echo   (elle saffiche aussi dans la fenetre du serveur).
echo   Garde ces deux fenetres ouvertes : les fermer coupe le site.
echo  ==================================================================
echo.
cloudflared tunnel --url http://localhost:3000
pause
