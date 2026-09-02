@echo off
cd /d "%~dp0"
title Auto Clicker NF - Newshop
cls
echo ===================================================
echo   Iniciando Auto Clicker NF (Desktop)
echo ===================================================
python auto_clicker_nf.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Ocorreu um erro ao executar.
    pause
)
