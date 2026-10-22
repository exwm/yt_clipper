@echo off
chcp 65001 >nul <nul
cd /D "%~dp0"

REM Each clip runs in its own window, which ends at a command prompt.
FOR %%A IN (%*) DO (
  start "" cmd /k .\yt_clipper.exe --markers-json %%A
)
