@echo off
setlocal EnableDelayedExpansion
chcp 65001


set argC=0
for %%x in (%*) do Set /A argC+=1

if not %argC% == 1 (
  echo Usage: yt_clipper_fast_trim.bat video_file
  pause
  exit
)

if exist "%~f1" (
  set "output_file=%~dp1\%~n1-trim%~x1"
  "%~dp0\bin\ffmpeg"  -ss "!start!" -to "!end!" -i "%~f1"  -c copy  "!output_file!"
)

pause
