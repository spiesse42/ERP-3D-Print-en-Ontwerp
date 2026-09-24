@echo off
echo === ERP 3D Print ^& Ontwerp - Dependencies installeren ===
echo.

echo [1/2] Backend dependencies installeren...
cd backend
call npm install
if %errorlevel% neq 0 (
    echo.
    echo FOUT bij npm install backend.
    echo Als dit faalt op better-sqlite3 ^(native module^): meestal ontbreken
    echo dan de Windows build-tools ^(python + Visual Studio Build Tools^).
    echo Zie: https://github.com/nodejs/node-gyp#on-windows
    pause
    exit /b 1
)

echo.
echo [2/2] Frontend dependencies installeren...
cd ..\frontend
call npm install
if %errorlevel% neq 0 ( echo FOUT bij npm install frontend & pause & exit /b 1 )

cd ..
echo.
echo =========================================
echo  Klaar! Dependencies geinstalleerd.
echo  Start de app lokaal met: dev.bat
echo =========================================
echo.
pause
