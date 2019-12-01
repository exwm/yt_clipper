@echo off
chcp 65001
cd /D "%~dp0"

FOR %%A IN (%*) DO (
  start  .\yt_clipper.exe --markers-json %%A
)
