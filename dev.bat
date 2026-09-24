@echo off
echo === ERP 3D Print ^& Ontwerp - Lokaal opstarten ===
echo.
echo Backend en frontend starten elk in een apart venster.
echo Sluit zo'n venster om die server te stoppen.
echo.

start "ERP 3D Print ^& Ontwerp - Backend (poort 3010)" cmd /k "cd backend && npm run dev"
start "ERP 3D Print ^& Ontwerp - Frontend (poort 5173)" cmd /k "cd frontend && npm run dev"

echo.
echo Frontend:  http://localhost:5173
echo Backend:   http://localhost:3010
echo.
echo (Nog niet uitgevoerd: install.bat draaien als je dat nog niet deed.)
echo.
pause
