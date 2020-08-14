@echo off
chcp 65001

set argC=0
for %%x in (%*) do Set /A argC+=1

if not %argC% gtr 1 (
  echo "Provide at least 2 video files to be merged."
  pause
  exit
)

set "merge_text=%~dp1\temp_merge.txt"

echo "%merge_text%"
echo.

for %%A IN (%*) DO (
  if not "%%~xA" == "%~x1" (
    set "mixed_exts=t"
  )
)

if defined mixed_exts (
  set "merge_ext=.mkv"
  echo "Detected mixed file extensions. Defaulting to mkv container for output format."
) else (
  set "merge_ext=%~x1"
)

(FOR %%A IN (%*) DO @echo file '%%~A') > "%merge_text%"

sort "%merge_text%" /o "%merge_text%"

echo.
echo --- video files to be merged in the following order: ---
type "%merge_text%"
echo ---------------------------------------------------------
echo.

set "merge_out=%~dp1\%~n1-merged%merge_ext%"

echo generating "%merge_out%"...
echo.

"%~dp0\bin\ffmpeg" -f concat -safe 0 -i "%merge_text%" -c copy "%merge_out%"

pause
