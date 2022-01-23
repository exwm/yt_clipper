@echo off
setlocal EnableDelayedExpansion
chcp 65001

set argC=0
for %%x in (%*) do Set /A argC+=1

echo "----------------------------------------------------"
echo "This script preprocesses hevc (h265) input video to ensure that it is compatible with ffmpeg."
echo "Currently, the steps performed are a 1) Convert HEVC/H.265 bitstream from length-prefixed mode to start-code-prefixed mode."
echo "The output file will be suffixed with '-preproc'."
echo "----------------------------------------------------"

if not %argC% == 1 (
  echo Provide a single video file as input.
  pause
  exit
)

if exist "%~f1" (
  set "output_file=%~dp1\%~n1-preproc%~x1"
  "%~dp0\bin\ffmpeg" -i "%~f1" -c copy -bsf:v hevc_mp4toannexb  "!output_file!"
) else (
  echo Path "%~f1" does not exist. 
)

echo "----------------------------------------------------"
echo "This script preprocesses hevc (h265) input video to ensure that it is compatible with ffmpeg."
echo "Currently, the steps performed are a 1) Convert HEVC/H.265 bitstream from length-prefixed mode to start-code-prefixed mode."
echo "The output file will be suffixed with '-preproc'."
echo "----------------------------------------------------"

pause
