"""
LyricFlow Backend — FastAPI entrypoint
Run:  uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

import os
import pathlib
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Load .env using the directory of THIS file — works correctly in all uvicorn modes
_env_path = pathlib.Path(__file__).parent / ".env"
load_dotenv(dotenv_path=_env_path, override=True)

# Startup token diagnostic (masked for security)
_genius_tok = os.getenv("GENIUS_API_TOKEN", "").strip()
print(f"[config] GENIUS_API_TOKEN: {'OK (' + _genius_tok[:6] + '...)' if _genius_tok else 'NOT SET'}")
print(f"[config] WHISPER_MODEL:    {os.getenv('WHISPER_MODEL', 'base')}")
print(f"[config] .env path:        {_env_path}")

# Ensure tmp_audio directory exists
AUDIO_TMP_DIR = os.getenv("AUDIO_TMP_DIR", "tmp_audio")
os.makedirs(AUDIO_TMP_DIR, exist_ok=True)
print(f"[config] Audio directory: {AUDIO_TMP_DIR}")

from db.cache import init_db
from routers import search, lyrics, sync, process


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown events."""
    # Initialize SQLite cache table
    init_db()
    # Ensure tmp_audio directory exists
    os.makedirs(AUDIO_TMP_DIR, exist_ok=True)
    print("[startup] LyricFlow backend ready")
    yield
    print("[shutdown] LyricFlow backend stopping.")


app = FastAPI(
    title="LyricFlow API",
    description="AI-powered lyrics sync — yt-dlp · Whisper · rapidfuzz",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────
# Allow the frontend origin (file://, localhost:5500, etc.)
cors_origins_env = os.getenv("CORS_ORIGINS", "*")
cors_origins = [o.strip() for o in cors_origins_env.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if "*" not in cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────
app.include_router(search.router)
app.include_router(lyrics.router)
app.include_router(sync.router)
app.include_router(process.router)


# ── Health check ──────────────────────────────────────────────────────
@app.get("/", tags=["health"])
async def health():
    return {
        "status": "ok",
        "service": "LyricFlow API",
        "version": "1.0.0",
        "endpoints": ["/api/search", "/api/lyrics", "/api/sync", "/api/process"],
    }
