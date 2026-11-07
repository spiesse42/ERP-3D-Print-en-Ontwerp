@echo off
setlocal EnableDelayedExpansion
rem ===================================================================
rem  Patreon-downloads van een ontwerper (bv. SabreDesign, Layer ^& Leaf)
rem  met patreon-dl, daarna ZIP-bestanden uitpakken. Daarna in het ERP:
rem  Voorraad - Artikelen - "Importeren uit map..." en kies de map.
rem  Je cookie staat ENKEL op deze pc (%USERPROFILE%\patreon-dl), nooit
rem  in GitHub of in het ERP. Opnieuw starten haalt enkel nieuwe posts.
rem ===================================================================
echo === Patreon-downloads (patreon-dl) ===
echo.

set "CONFMAP=%USERPROFILE%\patreon-dl"
set "CONF=%CONFMAP%\patreon-dl.conf"
set "STANDAARD=C:\Projects\Webshop-3D-Plezier\Catalogus\Patreon"
set "STANDAARD_URL=https://www.patreon.com/cw/SabreDesign/posts"

where node >nul 2>nul
if %errorlevel% neq 0 ( echo *** Node.js is niet gevonden. Installeer het eerst: https://nodejs.org *** & pause & exit /b 1 )

rem Eerste keer: instellingenbestand met de cookie aanmaken en openen
if not exist "%CONF%" (
  if not exist "%CONFMAP%" mkdir "%CONFMAP%"
  > "%CONF%" echo [downloader]
  >> "%CONF%" echo cookie = PLAK_HIER_JE_COOKIE
  echo Eerste keer: in Kladblok opent nu %CONF%
  echo Vervang PLAK_HIER_JE_COOKIE door je Patreon-cookie, bewaar en sluit Kladblok.
  echo Hoe je de cookie vindt: https://github.com/patrickkfkan/patreon-dl/wiki/How-to-obtain-Cookie
  echo Deel de cookie met niemand ^(ook niet met Claude^).
  echo.
  notepad "%CONF%"
)
findstr /c:"PLAK_HIER_JE_COOKIE" "%CONF%" >nul
if %errorlevel% equ 0 ( echo *** Er staat nog geen cookie in %CONF% - vul ze in en start opnieuw. *** & pause & exit /b 1 )

echo Patreon-pagina van de ontwerper (Enter = SabreDesign: %STANDAARD_URL%)
echo of plak de pagina van een andere ontwerper.
set "URL="
set /p URL=Pagina:
if "%URL%"=="" set "URL=%STANDAARD_URL%"
echo Pagina: %URL%

echo.
echo Map voor de downloads (Enter = %STANDAARD%)
set "DOEL="
set /p DOEL=Map:
if "%DOEL%"=="" set "DOEL=%STANDAARD%"
if not exist "%DOEL%" mkdir "%DOEL%"

echo.
echo [1/2] Downloaden... (dit kan lang duren; opnieuw starten gaat verder waar het stopte)
call npx --yes patreon-dl@3 -y -C "%CONF%" -o "%DOEL%" "%URL%"
if %errorlevel% neq 0 ( echo. & echo *** patreon-dl gaf een fout. Is de cookie nog geldig? Zie de meldingen hierboven. *** & pause & exit /b 1 )

echo.
echo [2/2] ZIP-bestanden uitpakken (elk in een eigen map ernaast)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath $env:DOEL -Recurse -Filter *.zip | ForEach-Object { $d = Join-Path $_.DirectoryName $_.BaseName; if (-not (Test-Path -LiteralPath $d)) { try { Expand-Archive -LiteralPath $_.FullName -DestinationPath $d -Force; Write-Host ('  uitgepakt: ' + $_.Name) } catch { Write-Host ('  NIET gelukt: ' + $_.Name) } } }"

echo.
echo ================================================
echo  Klaar. Downloads staan in: %DOEL%
echo  ERP: Voorraad - Artikelen - "Importeren uit map..."
echo  en kies de map van de ontwerper daarin.
echo ================================================
pause
