"""
POST /api/process  — full AI pipeline

Body (one of):
  { "youtube_url": "https://youtube.com/watch?v=..." }
  { "title": "Song Name", "artist": "Artist Name" }

Returns:
  {
    "song_info": { title, artist, duration, thumbnail, video_id },
    "timed_lyrics": [{ time, text, confidence }],
    "lyrics_source": "genius" | "ovh" | "none",
    "whisper_segments": [...],
    "from_cache": bool
  }

GET /api/download-audio?url=...  — download and stream audio from YouTube
"""

import asyncio
import re
import os
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel, model_validator
from typing import Optional

from services.audio import download_audio, convert_to_wav, cleanup_files, get_video_info, extract_youtube_id
from services.transcribe import transcribe, segments_to_dict
from services.lyrics_fetcher import fetch_lyrics
from services.sync_engine import align, timed_lines_to_dict, _evenly_distribute
from db.cache import get_cached, set_cached, init_db

router = APIRouter(prefix="/api/process", tags=["process"])


class ProcessRequest(BaseModel):
    youtube_url: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None

    @model_validator(mode="after")
    def check_input(self):
        if not self.youtube_url and not self.title:
            raise ValueError("Provide either 'youtube_url' or 'title'")
        return self


def _parse_title_artist_from_yt(yt_title: str) -> tuple[str, str]:
    """Try to extract song title + artist from a YouTube video title."""
    # Common patterns: "Artist - Title", "Title - Artist"
    for sep in [" – ", " - ", " — "]:
        parts = yt_title.split(sep, 1)
        if len(parts) == 2:
            return parts[1].strip(), parts[0].strip()  # title, artist
    # Strip noise like (Official Video), [4K], etc.
    cleaned = re.sub(r"\(.*?\)|\[.*?\]", "", yt_title).strip()
    return cleaned, ""


@router.post("")
async def process_song(req: ProcessRequest, background_tasks: BackgroundTasks):
    """
    Full AI pipeline: download → transcribe → fetch lyrics → sync.
    Results are cached in SQLite to avoid repeated processing.
    """
    youtube_id = None
    raw_path = None
    wav_path = None

    # ── 1. Check cache ────────────────────────────────────────────────
    if req.youtube_url:
        youtube_id = extract_youtube_id(req.youtube_url)

    cached = get_cached(
        youtube_id=youtube_id,
        title=req.title or "",
        artist=req.artist or "",
    )
    if cached:
        return {**cached, "from_cache": True}

    # ── 2. Resolve song info ───────────────────────────────────────────
    song_info = {}

    if req.youtube_url:
        try:
            info = get_video_info(req.youtube_url)
            song_info = info
            youtube_id = info.get("video_id") or youtube_id
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Cannot fetch YouTube info: {e}")

        yt_title = song_info.get("title", "")
        title, artist = _parse_title_artist_from_yt(yt_title)
        song_info["parsed_title"] = title
        song_info["parsed_artist"] = artist

    else:
        title = req.title or ""
        artist = req.artist or ""
        song_info = {"title": title, "artist": artist, "duration": 0, "thumbnail": ""}

    infer_title = song_info.get("parsed_title") or req.title or song_info.get("title", "")
    infer_artist = song_info.get("parsed_artist") or req.artist or song_info.get("artist", "")

    # ── 3. Fetch lyrics (parallel-safe via thread pool) ──────────────
    loop = asyncio.get_event_loop()

    lyrics_result = await loop.run_in_executor(
        None, fetch_lyrics, infer_artist, infer_title
    )
    lyrics_text = lyrics_result.get("lyrics") or ""
    lyrics_source = lyrics_result.get("source", "none")

    # ── 4. Transcribe (only if YouTube URL provided) ──────────────────
    whisper_segs = []

    if req.youtube_url:
        try:
            raw_path = await loop.run_in_executor(None, download_audio, req.youtube_url)
            wav_path = await loop.run_in_executor(None, convert_to_wav, raw_path)
            segments = await loop.run_in_executor(None, transcribe, wav_path)
            whisper_segs = segments_to_dict(segments)
            duration = song_info.get("duration") or (
                whisper_segs[-1]["end"] if whisper_segs else 180
            )
            song_info["duration"] = duration
        except Exception as e:
            print(f"[process] Transcription error: {e}")
            # Continue without Whisper — will fall back to even distribution
        finally:
            # Schedule cleanup in background so response is not delayed
            background_tasks.add_task(cleanup_files, raw_path, wav_path)

    # ── 5. Align lyrics ───────────────────────────────────────────────
    duration = song_info.get("duration") or 180

    if lyrics_text:
        timed = align(
            whisper_segments=whisper_segs,
            lyrics_text=lyrics_text,
            duration=duration,
        )
    else:
        timed = []

    # ── 6. Build result + cache ───────────────────────────────────────
    result = {
        "song_info": {
            "title": song_info.get("parsed_title") or song_info.get("title", ""),
            "artist": song_info.get("parsed_artist") or song_info.get("artist", ""),
            "duration": duration,
            "thumbnail": song_info.get("thumbnail", ""),
            "video_id": youtube_id or "",
        },
        "timed_lyrics": timed_lines_to_dict(timed),
        "lyrics_source": lyrics_source,
        "whisper_segments": whisper_segs,
        "from_cache": False,
    }

    # Only cache if we actually got lyrics — avoids storing empty bad results
    if timed:
        set_cached(
            result,
            youtube_id=youtube_id,
            title=req.title or "",
            artist=req.artist or "",
        )
    else:
        print(f"[process] Not caching — no lyrics found for '{infer_title}' by '{infer_artist}'")

    return result


# ─────────────────────────────────────────────
# Download audio endpoint
# ─────────────────────────────────────────────
_audio_cache = {}  # In-memory cache: url -> filepath


@router.get("/download-audio")
async def download_audio_endpoint(url: str):
    """
    Download audio from YouTube and return the file path.
    The frontend can then stream this file.
    """
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    # Check cache first
    if url in _audio_cache:
        cached_path = _audio_cache[url]
        if os.path.exists(cached_path):
            return {"audio_url": f"/api/process/audio-file/{os.path.basename(cached_path)}", "cached": True}
    
    # Download audio
    try:
        loop = asyncio.get_event_loop()
        audio_path = await loop.run_in_executor(None, download_audio, url)
        
        # Cache the path
        _audio_cache[url] = audio_path
        
        return {"audio_url": f"/api/process/audio-file/{os.path.basename(audio_path)}", "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download audio: {str(e)}")


@router.get("/audio-file/{filename}")
async def serve_audio_file(filename: str):
    """
    Serve the downloaded audio file.
    """
    tmp_dir = os.getenv("AUDIO_TMP_DIR", "tmp_audio")
    file_path = os.path.join(tmp_dir, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    
    # Determine content type based on extension
    ext = os.path.splitext(filename)[1].lower()
    media_type = "audio/mpeg" if ext == ".mp3" else "audio/webm"
    
    return FileResponse(file_path, media_type=media_type)
