@echo off
REM chcp reads nul, or it takes typed-ahead input meant for the prompts below.
chcp 65001 >nul <nul
cd /D "%~dp0"
set "ytc_options="

.\yt_clipper.exe -h

if not exist "%~f1" (
  echo [ERROR] Drop a markers JSON file on this script.
  goto prompt
)

set /p "ytc_options=Enter options (for example --overwrite), or press Enter for none: "

:run
.\yt_clipper.exe --markers-json "%~f1" %ytc_options%

echo.
set "ytc_options="
set /p "ytc_options=Enter all the options for another run (for example --overwrite --audio), or press Enter to finish: "
if defined ytc_options goto run

:prompt
echo.
echo [INFO] You are in the yt_clipper folder. Run .\yt_clipper.exe -h to list the options.
cd /D "%~dp0"
cmd /k
