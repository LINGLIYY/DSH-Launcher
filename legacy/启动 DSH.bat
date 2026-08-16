@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DSH Desktop
python -u launch.py %*
if errorlevel 1 pause
