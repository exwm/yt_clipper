@echo off
setlocal EnableDelayedExpansion
chcp 65001

set argC=0
for %%x in (%*) do Set /A argC+=1

if not %argC% == 1 (
  echo Provide a single video file as input.
  pause
  exit
)

if exist "%~f1" (
  set "output_file=%~dp1\%~n1-trim%~x1"
  set /p start="Enter start time (s or HH:MM:SS.MS): "
  set /p end="Enter end time (s or HH:MM:SS.MS): "
  "%~dp0\bin\ffmpeg"  -ss "!start!" -to "!end!" -i "%~f1"  -c copy  "!output_file!"
) else (
  echo Path "%~f1" does not exist. 
)

pause
