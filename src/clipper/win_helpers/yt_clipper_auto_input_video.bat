@echo off
REM chcp reads nul, or it takes typed-ahead input meant for the prompts below.
chcp 65001 >nul <nul
cd /D "%~dp0"
set "ytc_markers_json="
set "ytc_input_video="
set "ytc_options="

if not "%~3"=="" (
  echo [ERROR] Drop only a markers JSON file and a video file on this script.
  goto prompt
)
if not exist "%~f1" (
  echo [ERROR] Drop a markers JSON file and a video file on this script.
  goto prompt
)
if not exist "%~f2" (
  echo [ERROR] Drop a markers JSON file and a video file on this script.
  goto prompt
)
if /i "%~x1"==".json" (
  set "ytc_markers_json=%~f1"
  set "ytc_input_video=%~f2"
)
if /i "%~x2"==".json" (
  set "ytc_markers_json=%~f2"
  set "ytc_input_video=%~f1"
)
if not defined ytc_markers_json (
  echo [ERROR] One of the files must be a markers JSON file.
  goto prompt
)

echo [INFO] Using input video "%ytc_input_video%"
echo [INFO] Using markers JSON "%ytc_markers_json%"
echo --------------------------------------------------------------

:run
.\yt_clipper.exe -i "%ytc_input_video%" --markers-json "%ytc_markers_json%" %ytc_options%

echo.
set "ytc_options="
set /p "ytc_options=Enter all the options for another run (for example --overwrite --audio), or press Enter to finish: "
if defined ytc_options goto run

:prompt
echo.
echo [INFO] You are in the yt_clipper folder. Run .\yt_clipper.exe -h to list the options.
cd /D "%~dp0"
cmd /k
