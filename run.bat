@echo off
setlocal EnableExtensions
title ComfyForge Starter
cd /d "%~dp0"

echo =========================================================
echo   ComfyForge - Lancement local
echo =========================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js 22 est requis.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] npm est introuvable.
  pause
  exit /b 1
)

if not exist "backend\.env" (
  echo [ERREUR] backend\.env est absent.
  echo Creez-le avec :
  echo powershell -ExecutionPolicy Bypass -File scripts\init-env.ps1 -Development
  pause
  exit /b 1
)

if not exist "backend\node_modules" (
  echo [ERREUR] Les dependances backend ne sont pas installees.
  echo Executez : cd backend ^&^& npm ci
  pause
  exit /b 1
)

if not exist "frontend\node_modules" (
  echo [ERREUR] Les dependances frontend ne sont pas installees.
  echo Executez : cd frontend ^&^& npm ci
  pause
  exit /b 1
)

call :release_port 3001
if errorlevel 1 exit /b 1
call :release_port 5173
if errorlevel 1 exit /b 1

echo Attente du backend...
start "ComfyForge Backend" cmd /k "cd /d ""%~dp0backend"" && npm run dev"
call :wait_for_port 3001 60
if errorlevel 1 (
  echo [ERREUR] Le backend n'a pas demarre sur le port 3001.
  pause
  exit /b 1
)

echo Attente du frontend...
start "ComfyForge Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"
call :wait_for_port 5173 60
if errorlevel 1 (
  echo [ERREUR] Le frontend n'a pas demarre sur le port 5173.
  pause
  exit /b 1
)

echo ComfyForge est pret sur http://localhost:5173
start "" http://localhost:5173
exit /b 0

:release_port
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release-port.ps1" -Port %~1 -Workspace "%~dp0."
if errorlevel 1 (
  echo [ERREUR] Impossible de liberer le port %~1.
  pause
  exit /b 1
)
exit /b 0

:wait_for_port
powershell -NoProfile -Command ^
  "$deadline = (Get-Date).AddSeconds(%~2); while ((Get-Date) -lt $deadline) { if (Get-NetTCPConnection -State Listen -LocalPort %~1 -ErrorAction SilentlyContinue) { exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1"
exit /b %errorlevel%
