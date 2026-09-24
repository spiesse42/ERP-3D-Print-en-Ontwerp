@echo off
echo === ERP 3D Print ^& Ontwerp - Tests backend ===
echo.
cd backend
call npm test
if %errorlevel% neq 0 (
    echo.
    echo *** TESTS MISLUKT - niet verder bouwen of deployen. ***
    pause
    exit /b 1
)
echo.
echo Alle tests geslaagd.
pause
