"""
GET /api/search?q=...   — iTunes Search API proxy
"""

import httpx
from fastapi import APIRouter, Query, HTTPException

router = APIRouter(prefix="/api/search", tags=["search"])

ITUNES_URL = "https://itunes.apple.com/search"


@router.get("")
async def search_songs(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(6, ge=1, le=20),
):
    """
    Search for songs using iTunes Search API.
    Returns metadata including album art thumbnail and 30s preview URL.
    """
    params = {
        "term": q,
        "entity": "song",
        "media": "music",
        "limit": limit,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(ITUNES_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"iTunes API error: {e}")

    results = []
    for r in data.get("results", []):
        artwork = (r.get("artworkUrl100") or "").replace("100x100", "600x600")
        results.append({
            "title": r.get("trackName", ""),
            "artist": r.get("artistName", ""),
            "album": r.get("collectionName", ""),
            "thumbnail": artwork,
            "thumbnailSm": r.get("artworkUrl100", ""),
            "previewUrl": r.get("previewUrl"),
            "duration": (r.get("trackTimeMillis") or 30000) / 1000,
            "trackId": r.get("trackId"),
        })

    return {"results": results, "total": len(results)}
