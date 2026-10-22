@echo off
chcp 65001 >nul <nul
REM Cleared, since the script ends at a prompt where it can run again.
set "mixed_exts="

set argC=0
for %%x in (%*) do Set /A argC+=1

if not %argC% gtr 1 (
  echo [ERROR] Drop at least 2 video files on this script.
  goto prompt
)

set "merge_text=%~dp1temp_merge.txt"

echo "%merge_text%"
echo.

for %%A IN (%*) DO (
  if /i not "%%~xA" == "%~x1" (
    set "mixed_exts=t"
  )
)

if defined mixed_exts (
  set "merge_ext=.mkv"
  echo [WARNING] The files have different extensions, so the merged file is an mkv.
) else (
  set "merge_ext=%~x1"
)

(FOR %%A IN (%*) DO @echo %%~fA) > "%merge_text%"

REM Sort by name with numbers in order (clip-2 before clip-10), then write ffmpeg's concat list:
REM each path in quotes, with a ' written as '\''.
set "ytc_merge_text=%merge_text%"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$files = [IO.File]::ReadAllLines($env:ytc_merge_text) | Sort-Object { [regex]::Replace($_, '\d+', { $args[0].Value.PadLeft(20, '0') }) }; [IO.File]::WriteAllLines($env:ytc_merge_text, [string[]]($files | ForEach-Object { 'file ''{0}''' -f $_.Replace('''', '''\''''') }))"
if errorlevel 1 (
  echo [ERROR] Could not write the list of files to merge.
  goto prompt
)

echo.
echo --- Merging these files in this order: ---
type "%merge_text%"
echo ---------------------------------------------------------
echo.

set "merge_out=%~dp1%~n1-merged%merge_ext%"

echo [INFO] Generating "%merge_out%"...
echo.

"%~dp0bin\video-tools\ffmpeg" -f concat -safe 0 -i "%merge_text%" -c copy "%merge_out%"

:prompt
echo.
echo [INFO] You are in the yt_clipper folder.
cd /D "%~dp0"
cmd /k
