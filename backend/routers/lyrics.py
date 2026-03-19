"""
GET /api/lyrics?artist=...&title=...  — fetch canonical lyrics
"""

from fastapi import APIRouter, Query, HTTPException
from services.lyrics_fetcher import fetch_lyrics

router = APIRouter(prefix="/api/lyrics", tags=["lyrics"])


@router.get("")
async def get_lyrics(
    artist: str = Query(..., min_length=1, description="Artist name"),
    title: str = Query(..., min_length=1, description="Song title"),
):
    """
    Fetch lyrics from Genius (if token configured) or lyrics.ovh.
    Returns: { lyrics: str|null, source: "genius"|"ovh"|"none" }
    """
    result = fetch_lyrics(artist=artist, title=title)

    if not result["lyrics"]:
        raise HTTPException(
            status_code=404,
            detail=f"Lyrics not found for '{title}' by '{artist}'"
        )

    return result
