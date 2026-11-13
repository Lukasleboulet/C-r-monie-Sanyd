@echo off
chcp 65001 >nul
title Mise a jour - SAMP Sandy Shore
cd /d "%~dp0"
echo.
echo  Telechargement de la derniere version depuis GitHub...
echo  (tes donnees "data" et ton "config.json" ne sont jamais modifies)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $z=Join-Path $env:TEMP 'samp-maj.zip'; $d=Join-Path $env:TEMP 'samp-maj'; Invoke-WebRequest 'https://github.com/Lukasleboulet/c-r-monie-sanyd/archive/refs/heads/main.zip' -OutFile $z -UseBasicParsing; if (Test-Path $d) { Remove-Item $d -Recurse -Force }; Expand-Archive $z $d; $src=(Get-ChildItem $d -Directory | Select-Object -First 1).FullName; $n=0; Get-ChildItem $src -Recurse -File | ForEach-Object { $rel=$_.FullName.Substring($src.Length+1); if ($rel -notmatch '^(data\\|config\.json$|config\.php$|METTRE-A-JOUR\.bat$)') { $dst=Join-Path (Get-Location) $rel; New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null; Copy-Item $_.FullName $dst -Force; $n++ } }; Remove-Item $z -Force; Remove-Item $d -Recurse -Force; Write-Host ('  ' + $n + ' fichiers mis a jour.')"
if errorlevel 1 (
  echo.
  echo  [!] La mise a jour a echoue : verifie ta connexion internet et reessaie.
  pause
  exit /b 1
)
echo.
echo  ==================================================================
echo   Mise a jour terminee. Dans ton navigateur : Ctrl + F5 sur le site.
echo   Si "server.js" a change : ferme UNIQUEMENT la fenetre du serveur
echo   puis lance RELANCER-SERVEUR.bat (l'adresse du site ne change pas).
echo  ==================================================================
echo.
pause
