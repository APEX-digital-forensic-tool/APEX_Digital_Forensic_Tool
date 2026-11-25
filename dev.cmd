@echo off
setlocal
where uv >nul 2>nul
if errorlevel 1 (
  echo uv is required. Install it, then run this again: 1>&2
  echo   winget install --id=astral-sh.uv -e 1>&2
  exit /b 1
)
uv run --no-project --python 3.12 "%~dp0tools\dev.py" %*
exit /b %errorlevel%
