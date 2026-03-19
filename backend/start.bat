@echo off
REM LyricFlow Backend startup script for Windows
echo.
echo  ♪ LyricFlow Backend
echo  ─────────────────────────────────────────
echo.

REM Check if .env exists, if not copy from example
if not exist .env (
    echo  [setup] Creating .env from .env.example...
    copy /Y .env.example .env
    echo  [setup] Done! Edit .env to add your GENIUS_API_TOKEN if you have one.
    echo.
)

REM Create tmp_audio directory
if not exist tmp_audio mkdir tmp_audio

REM Install dependencies if needed
pip install -r requirements.txt --quiet

echo.
echo  Starting server at http://localhost:8000
echo  Swagger docs at http://localhost:8000/docs
echo  Press Ctrl+C to stop.
echo.

uvicorn main:app --reload --port 8000 --host 0.0.0.0
