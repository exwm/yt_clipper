@echo off
REM chcp reads nul, or it takes typed-ahead input meant for the prompts below.
chcp 65001 >nul <nul

echo ----------------------------------------------------
echo This script quickly trims a video without re-encoding, so the cut points are approximate.
echo The trimmed file name ends with -trim.
echo ----------------------------------------------------

if "%~1"=="" goto single_file
if not "%~2"=="" goto single_file
if not exist "%~f1" (
  echo [ERROR] "%~f1" does not exist.
  goto prompt
)

set "ytc_output_file=%~dp1%~n1-trim%~x1"
REM Cleared, since the script ends at a prompt where it can run again.
set "ytc_start="
set "ytc_end="
set /p "ytc_start=Enter start time (s or HH:MM:SS.MS), or press Enter to start at the beginning: "
set /p "ytc_end=Enter end time (s or HH:MM:SS.MS), or press Enter to trim to the end: "
REM A pasted time can carry quotes or spaces, and an empty time is left out: ffmpeg rejects them.
if defined ytc_start set "ytc_start=%ytc_start:"=%"
if defined ytc_end set "ytc_end=%ytc_end:"=%"
set "ytc_trim="
for /f "tokens=1" %%t in ("%ytc_start% ") do set ytc_trim=-ss "%%t"
for /f "tokens=1" %%t in ("%ytc_end% ") do set ytc_trim=%ytc_trim% -to "%%t"
"%~dp0bin\video-tools\ffmpeg" %ytc_trim% -i "%~f1" -c copy "%ytc_output_file%"

echo ----------------------------------------------------
echo This script quickly trims a video without re-encoding, so the cut points are approximate.
echo The trimmed file name ends with -trim.
echo ----------------------------------------------------
goto prompt

:single_file
echo [ERROR] Drop one video file on this script.

:prompt
echo.
echo [INFO] You are in the yt_clipper folder.
cd /D "%~dp0"
cmd /k
