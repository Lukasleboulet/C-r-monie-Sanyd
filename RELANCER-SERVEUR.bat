@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Relance seulement le serveur : le tunnel Cloudflare (et donc l'adresse du site) reste le meme.
start "Serveur SAMP Sandy Shore (ne pas fermer)" cmd /k node server.js
