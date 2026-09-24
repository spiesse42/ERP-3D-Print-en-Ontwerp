@echo off
setlocal EnableDelayedExpansion
echo === ERP 3D Print ^& Ontwerp - Build ^& Deploy (add-on) ===
echo.

if not exist .git (
  echo Deze map is nog geen git-repository. Eenmalig:
  echo   git init
  echo   git branch -M main
  echo   git remote add origin https://github.com/spiesse42/ERP-3D-Print-en-Ontwerp.git
  echo Zie README.md, "Eerste keer".
  pause & exit /b 1
)

echo [1/5] Tests backend...
cd backend
call npm test
if %errorlevel% neq 0 ( echo. & echo *** TESTS MISLUKT - niets gebouwd of gepusht. *** & pause & exit /b 1 )
cd ..

echo.
echo [2/5] Frontend bouwen...
cd frontend
call npm run build
if %errorlevel% neq 0 ( echo FOUT bij npm run build & pause & exit /b 1 )
cd ..

echo.
echo [3/5] Bestanden naar de add-on-map kopieren (zonder databank, bijlagen, backups en node_modules)...
robocopy backend addon\backend /MIR /XD node_modules bijlagen backups test /XF *.db *.db-wal *.db-shm package-lock.json /NFL /NDL /NJH /NJS /NP >nul
if %errorlevel% geq 8 ( echo FOUT bij kopieren backend & pause & exit /b 1 )
robocopy frontend\dist addon\frontend\dist /MIR /NFL /NDL /NJH /NJS /NP >nul
if %errorlevel% geq 8 ( echo FOUT bij kopieren frontend & pause & exit /b 1 )
if exist addon\backend\erp.db ( echo FOUT: databank in de add-on-map gevonden, gestopt. & pause & exit /b 1 )

echo.
echo [4/5] Add-on-versie verhogen...
for /f "tokens=2 delims=: " %%a in ('findstr /b "version:" addon\config.yaml') do set VERSIE=%%~a
set VERSIE=%VERSIE:"=%
for /f "tokens=1,2,3 delims=." %%a in ("%VERSIE%") do ( set MAJOR=%%a & set MINOR=%%b & set /a PATCH=%%c+1 )
set MAJOR=%MAJOR: =%
set MINOR=%MINOR: =%
set NIEUW=%MAJOR%.%MINOR%.%PATCH%
powershell -NoProfile -Command "(Get-Content addon\config.yaml) -replace '^version: \"%VERSIE%\"', 'version: \"%NIEUW%\"' | Set-Content -Encoding utf8 addon\config.yaml"
echo Versie: %VERSIE% ^> %NIEUW%

echo.
echo [5/5] Commit en push...
git add -A
git commit -m "Deploy v%NIEUW%"
git push
if %errorlevel% neq 0 ( echo FOUT bij git push & pause & exit /b 1 )

echo.
echo ================================================
echo  Klaar: v%NIEUW% staat op GitHub.
echo  Home Assistant: Instellingen - Add-ons - ERP 3D Print ^& Ontwerp - Bijwerken
echo  (of eerst "Controleren op updates" in de Add-on store).
echo ================================================
pause
