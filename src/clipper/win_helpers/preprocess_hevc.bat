@echo off
REM chcp reads nul, or it takes typed-ahead input meant for the prompts below.
chcp 65001 >nul <nul

echo ----------------------------------------------------
echo This script converts the stream of an HEVC (H.265) video to a form ffmpeg can read.
echo The converted file name ends with -preproc.
echo ----------------------------------------------------

if "%~1"=="" goto single_file
if not "%~2"=="" goto single_file
if not exist "%~f1" (
  echo [ERROR] "%~f1" does not exist.
  goto prompt
)

"%~dp0bin\video-tools\ffmpeg" -i "%~f1" -c copy -bsf:v hevc_mp4toannexb "%~dp1%~n1-preproc%~x1"

echo ----------------------------------------------------
echo This script converts the stream of an HEVC (H.265) video to a form ffmpeg can read.
echo The converted file name ends with -preproc.
echo ----------------------------------------------------
goto prompt

:single_file
echo [ERROR] Drop one video file on this script.

:prompt
echo.
echo [INFO] You are in the yt_clipper folder.
cd /D "%~dp0"
cmd /k
