"""
POST /api/sync  — align Whisper segments to canonical lyric lines
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.sync_engine import align, timed_lines_to_dict

router = APIRouter(prefix="/api/sync", tags=["sync"])


class SyncRequest(BaseModel):
    whisper_segments: list[dict]   # [{"start": float, "end": float, "text": str}]
    lyrics_text: str
    duration: float = 0.0


@router.post("")
async def sync_lyrics(req: SyncRequest):
    """
    Align Whisper transcript segments to canonical lyric lines using rapidfuzz.
    Returns list of timed lyric lines: [{ time, text, confidence }]
    """
    if not req.lyrics_text.strip():
        raise HTTPException(status_code=400, detail="lyrics_text cannot be empty")

    timed = align(
        whisper_segments=req.whisper_segments,
        lyrics_text=req.lyrics_text,
        duration=req.duration,
    )

    return {
        "timed_lyrics": timed_lines_to_dict(timed),
        "total_lines": len(timed),
    }
