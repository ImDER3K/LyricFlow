"""
Multi-source lyrics fetcher.
Priority: Genius → lyrics.ovh → None
"""

import os
import re
import requests


def _clean_lyrics(text: str) -> str:
    """Normalize line endings and strip excessive blank lines."""
    text = re.sub(r"\r\n", "\n", text)
    text = re.sub(r"\r", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Remove Genius-specific annotation artifacts like [Verse 1] [Chorus] etc.
    text = re.sub(r"\[.*?\]", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Remove extra spaces at the beginning/end of lines
    text = re.sub(r"^\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+$", "", text, flags=re.MULTILINE)
    # Remove empty lines at the beginning/end
    text = text.strip()
    return text.strip()


def _fetch_genius(artist: str, title: str) -> str | None:
    """Fetch lyrics from Genius API (requires token)."""
    # Read token at call time so .env is always loaded first
    genius_token = os.getenv("GENIUS_API_TOKEN", "").strip()
    if not genius_token:
        return None
    try:
        headers = {"Authorization": f"Bearer {genius_token}"}
        search_url = "https://api.genius.com/search"
        resp = requests.get(
            search_url,
            params={"q": f"{title} {artist}"},
            headers=headers,
            timeout=8,
        )
        resp.raise_for_status()
        hits = resp.json().get("response", {}).get("hits", [])
        if not hits:
            return None

        # Use lyricsgenius for actual lyric text scraping
        try:
            import lyricsgenius  # type: ignore

            genius = lyricsgenius.Genius(genius_token, quiet=True, verbose=False)
            genius.skip_non_songs = True
            song = genius.search_song(title=title, artist=artist)
            if song and song.lyrics:
                # lyricsgenius prepends "Lyrics" to the text — strip it
                raw = re.sub(r"^.*?Lyrics\n", "", song.lyrics, flags=re.DOTALL)
                return _clean_lyrics(raw)
        except ImportError:
            pass

        return None
    except Exception as e:
        print(f"[lyrics] Genius error: {e}")
        return None


def _fetch_ovh(artist: str, title: str) -> str | None:
    """Fetch lyrics from lyrics.ovh (free, no key)."""
    try:
        url = f"https://api.lyrics.ovh/v1/{requests.utils.quote(artist)}/{requests.utils.quote(title)}"
        resp = requests.get(url, timeout=8)
        if resp.ok:
            data = resp.json()
            raw = data.get("lyrics", "")
            if raw and len(raw.strip()) > 30:
                return _clean_lyrics(raw)
    except Exception as e:
        print(f"[lyrics] OVH error: {e}")

    # Try swapped order as fallback
    try:
        url = f"https://api.lyrics.ovh/v1/{requests.utils.quote(title)}/{requests.utils.quote(artist)}"
        resp = requests.get(url, timeout=8)
        if resp.ok:
            data = resp.json()
            raw = data.get("lyrics", "")
            if raw and len(raw.strip()) > 30:
                return _clean_lyrics(raw)
    except Exception:
        pass

    return None


def fetch_lyrics(artist: str, title: str) -> dict:
    """
    Fetch lyrics from best available source.
    Returns: { "lyrics": str, "source": str } or { "lyrics": None, "source": "none" }
    """
    # 1. Try Genius first
    lyrics = _fetch_genius(artist, title)
    if lyrics:
        return {"lyrics": lyrics, "source": "genius"}

    # 2. Fallback to lyrics.ovh
    lyrics = _fetch_ovh(artist, title)
    if lyrics:
        return {"lyrics": lyrics, "source": "ovh"}

    return {"lyrics": None, "source": "none"}
