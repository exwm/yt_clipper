@echo off
REM chcp reads nul, or it takes typed-ahead input meant for the prompts below.
chcp 65001 >nul <nul
if "%~1"=="" (
  echo [ERROR] Drop one or more video files on this script.
  goto prompt
)
set "ytc_ffmpeg=%~dp0bin\video-tools\ffmpeg"
set "ytc_fps=8"
set "ytc_scale=128"
set /p "ytc_fps=Enter the gif frame rate (default 8): "
set /p "ytc_scale=Enter the gif size: the longer side in pixels, or WxH (default 128): "

echo.
echo [INFO] Using frame rate %ytc_fps% and size %ytc_scale%.
echo.

set "ytc_scale_filter='if(gte(iw,ih),%ytc_scale%,-1):if(gte(iw,ih),-1,%ytc_scale%)'"
REM WxH with an x or an X; a size with one number (or a stray x) is the longer side.
for /F "tokens=1,2 delims=xX" %%a in ("%ytc_scale%") do (
  if "%%~b" == "" (
    set "ytc_scale_filter='if(gte(iw,ih),%%a,-1):if(gte(iw,ih),-1,%%a)'"
  ) else (
    set "ytc_scale_filter=%%ax%%b"
  )
)

REM A subroutine, so file names with ! keep it (delayed expansion would drop it). It takes the file
REM in variables: call would double a ^ and expand % in an argument.
for %%A IN (%*) DO (
  set "ytc_video=%%~fA"
  set "ytc_gif=%%~dpnA.gif"
  call :gif
)
goto prompt

:gif
if not exist "%ytc_video%" (
  echo [ERROR] "%ytc_video%" does not exist.
  exit /b
)
"%ytc_ffmpeg%" -i "%ytc_video%" -vf "fps=%ytc_fps%,scale=%ytc_scale_filter%:flags=lanczos,setdar=ratio=a,hqdn3d,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse" "%ytc_gif%"
exit /b

:prompt
echo.
echo [INFO] You are in the yt_clipper folder.
cd /D "%~dp0"
cmd /k
