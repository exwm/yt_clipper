@echo off
chcp 65001
cd /D "%~dp0"

.\yt_clipper.exe -h
set /p opts="Enter any additional options: "

.\yt_clipper.exe --markers-json "%~1" %opts%

pause