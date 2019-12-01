@echo off
chcp 65001
cd /D "%~dp0"

FOR %%A IN (%*) DO (
  .\yt_clipper.exe --markers-json %%A -evf "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
)

pause