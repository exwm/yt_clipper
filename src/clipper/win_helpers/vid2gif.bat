@echo off
setlocal EnableDelayedExpansion
chcp 65001

set /p "fps=Enter target gif fps (DEFAULT 8): " || set "fps=8"
set /p "scale=Enter target gif scale. Specify target size of only larger dimension (maintaining aspect ratio) or both dimensions (ie WxH; eg 128x90) (DEFAULT 128): " || set "scale=128"

echo.
echo Using fps !fps! and scale !scale!.
echo.

for /F "tokens=1,2 delims=x" %%a in ("!scale!") do (
   if not "%%~b" == "" (
    set "scale_filter=!scale!"
  ) else (
    set "scale_filter='if(gte(iw,ih),!scale!,-1):if(gte(iw,ih),-1,!scale!)'"
  )
)

for %%A IN (%*) DO (
  if exist "%%A" (
    set "out=%%~dpA\%%~nA.gif"

    "%~dp0\bin\ffmpeg" -i "%%A" -vf "fps=!fps!,scale=!scale_filter!:flags=lanczos,hqdn3d,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse" "!out!"
  ) else (
    echo Path "%%A" does not exist. 
  )
)



pause


 
