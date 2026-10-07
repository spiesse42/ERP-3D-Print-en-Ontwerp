@echo off
setlocal EnableDelayedExpansion
rem map van de add-on (= slug)
set ADDON=erp_3d_print_ontwerp
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

rem Eerst de nieuwste code van GitHub ophalen (vervangt Fetch/Pull in
rem GitHub Desktop). gc.auto uit: anders telkens "Deletion of directory
rem '.git/objects/..' failed". Lokale wijzigingen? Dan stoppen.
echo [ophalen] Nieuwste code van GitHub...
rem GIT_ASK_YESNO=false: vragen als "Should I try again? (y/n)" automatisch "nee"
set "GIT_ASK_YESNO=false"
git config gc.auto 0
git config maintenance.auto false
for /f %%i in ('git status --porcelain --untracked-files^=no') do (
  echo.
  echo *** Er zijn lokale wijzigingen - eerst nakijken in GitHub Desktop: ***
  git status --short --untracked-files=no
  echo Niet nodig? Kies daar "Discard changes" en start dit bestand opnieuw.
  pause & exit /b 1
)
git fetch origin
if %errorlevel% neq 0 ( echo. & echo *** GitHub niet bereikbaar - internet? *** & pause & exit /b 1 )
git checkout main
if %errorlevel% neq 0 ( echo. & echo *** Kon niet naar de branch main. *** & pause & exit /b 1 )
git merge --ff-only origin/main
if %errorlevel% neq 0 ( echo. & echo *** Nieuwste code niet automatisch binnen te halen - stuur een screenshot. *** & pause & exit /b 1 )
git log --oneline -1
echo.

rem Nieuwe onderdelen (dependencies) na het ophalen meteen installeren,
rem anders vinden de tests ze niet (bv. qrcode voor de factuur). Snel als er
rem niets veranderd is.
echo [0/5] Onderdelen bijwerken (npm install)...
cd backend
call npm install --no-audit --no-fund
if %errorlevel% neq 0 ( echo. & echo *** FOUT bij npm install backend. Faalt het op better-sqlite3, dan ontbreken de Windows build-tools: https://github.com/nodejs/node-gyp#on-windows *** & pause & exit /b 1 )
cd ..\frontend
call npm install --no-audit --no-fund
if %errorlevel% neq 0 ( echo. & echo *** FOUT bij npm install frontend. *** & pause & exit /b 1 )
cd ..

echo.
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
echo [3/5] Bestanden naar de add-on-map (%ADDON%) kopieren (zonder databank, bijlagen, backups en node_modules)...
robocopy backend %ADDON%\backend /MIR /XD node_modules bijlagen backups test /XF *.db *.db-wal *.db-shm package-lock.json /NFL /NDL /NJH /NJS /NP >nul
if %errorlevel% geq 8 ( echo FOUT bij kopieren backend & pause & exit /b 1 )
robocopy frontend\dist %ADDON%\frontend\dist /MIR /NFL /NDL /NJH /NJS /NP >nul
if %errorlevel% geq 8 ( echo FOUT bij kopieren frontend & pause & exit /b 1 )
if exist %ADDON%\backend\erp.db ( echo FOUT: databank in de add-on-map gevonden, gestopt. & pause & exit /b 1 )

echo.
echo [4/5] Add-on-versie verhogen...
set NIEUW=
for /f %%v in ('node tools\versie.mjs %ADDON%\config.yaml') do set NIEUW=%%v
if "%NIEUW%"=="" ( echo FOUT bij het verhogen van de versie & pause & exit /b 1 )
echo Nieuwe versie: %NIEUW%

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
