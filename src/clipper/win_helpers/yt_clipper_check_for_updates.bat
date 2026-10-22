@echo off
REM chcp reads nul, or it takes typed-ahead input meant for the prompts below.
chcp 65001 >nul <nul
cd /D "%~dp0"

.\yt_clipper.exe --check-for-updates

:prompt
echo.
echo [INFO] You are in the yt_clipper folder. Run .\yt_clipper.exe -h to list the options.
cd /D "%~dp0"
cmd /k
