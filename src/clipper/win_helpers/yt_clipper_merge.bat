@echo off
chcp 65001

SET "merge_text=%~dp1\merge.txt"

@echo "%merge_text%"

(FOR %%A IN (%*) DO @echo file '%%~A') > "%merge_text%"

sort "%merge_text%" /o "%merge_text%"

@echo.
@echo --- video files to be merged in the following order: ---
type "%merge_text%"
@echo ---------------------------------------------------------
@echo.

SET "merge_output_dir=%~dp1\%~n1-merged.webm"

"%~dp0\bin\ffmpeg" -hide_banner -f concat -safe 0 -i "%merge_text%" -c copy "%merge_output_dir%"

pause
