@echo off
setlocal EnableDelayedExpansion

chcp 65001
cd /D "%~dp0"

if not "%~3"=="" (
  echo Too many inputs provided
  pause
  exit
)


if exist "%~f1" (
  if exist "%~f2" (
    if "%~x1"==".json" (
      set "markers_json=%~f1"
      set "input_video=%~f2"
    )
    if "%~x2"==".json" (
      set "markers_json=%~f2"
      set "input_video=%~f1"
    )
    
    if DEFINED markers_json (
      echo Using input video path "!input_video!"
      echo Using markers json path "!markers_json!"
      echo --------------------------------------------------------------
    
      .\yt_clipper.exe -i "!input_video!"  --markers-json "!markers_json!"
    ) else (
      echo Markers json data not provided
    )
  ) else (
      echo Missing second file input 
  )
) else (
    echo Missing file inputs
)

pause