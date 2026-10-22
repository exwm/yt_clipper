@echo off
REM chcp reads nul, or it takes typed-ahead input meant for the prompts below.
chcp 65001 >nul <nul
cd /D "%~dp0"
set "ytc_options="

if "%~1"=="" (
  echo [ERROR] Drop one or more markers JSON files on this script.
  goto prompt
)

:run
REM The clip runs in a subroutine: in the loop's block, a ) in the options would end the block.
FOR %%A IN (%*) DO (
  set "ytc_markers_json=%%~fA"
  call :clip
)

echo.
set "ytc_options="
set /p "ytc_options=Enter all the options for another run (for example --overwrite --audio), or press Enter to finish: "
if defined ytc_options goto run

:prompt
echo.
echo [INFO] You are in the yt_clipper folder. Run .\yt_clipper.exe -h to list the options.
cd /D "%~dp0"
cmd /k
exit /b

:clip
.\yt_clipper.exe --markers-json "%ytc_markers_json%" --download-video %ytc_options%
exit /b
