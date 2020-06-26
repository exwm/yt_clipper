@echo off
chcp 65001
cd /D "%~dp0"

.\yt_clipper.exe -h
    
if exist "%~f1" (
    set /p opts="Enter any additional options: "
    .\yt_clipper.exe --markers-json "%~1" %opts%
) else (
    echo Missing markers json file
)


pause
