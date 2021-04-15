@echo off
chcp 65001
cd /D "%~dp0"

FOR %%A IN (%*) DO (
  REM you can add options after %%A of the next line as shown
  .\yt_clipper.exe --markers-json %%A
)

pause
