"""
Audio download (yt-dlp) and conversion (ffmpeg) service.
Uses static-ffmpeg to auto-download ffmpeg binaries if not on PATH.
"""

import os
import re
import subprocess
import uuid

import yt_dlp

AUDIO_TMP_DIR = os.getenv("AUDIO_TMP_DIR", "tmp_audio")

# Auto-configure ffmpeg binary path (static-ffmpeg handles download)
_FFMPEG_BIN = "ffmpeg"   # default: assume it's on PATH
try:
    import static_ffmpeg  # type: ignore
    static_ffmpeg.add_paths()  # adds static binaries to os.environ PATH
    print("[audio] static-ffmpeg configured.")
except ImportError:
    print("[audio] static-ffmpeg not installed, using system ffmpeg.")


def _ensure_tmp_dir() -> str:
    os.makedirs(AUDIO_TMP_DIR, exist_ok=True)
    return AUDIO_TMP_DIR


def extract_youtube_id(url: str) -> str | None:
    """Extract YouTube video ID from any YouTube URL format."""
    pattern = r"(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/))([A-Za-z0-9_-]{11})"
    m = re.search(pattern, url)
    return m.group(1) if m else None


def get_video_info(url: str) -> dict:
    """Fetch YouTube video metadata without downloading."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return {
        "title": info.get("title", ""),
        "artist": info.get("uploader", ""),
        "duration": info.get("duration", 0),
        "thumbnail": info.get("thumbnail", ""),
        "video_id": info.get("id", ""),
    }


def download_audio(url: str) -> str:
    """
    Download audio from a YouTube URL using yt-dlp.
    Returns the path to the downloaded audio file (webm/m4a/etc.).
    """
    tmp_dir = _ensure_tmp_dir()
    uid = str(uuid.uuid4())[:8]
    output_template = os.path.join(tmp_dir, f"audio_{uid}.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [],  # No ffmpeg post-processing yet — we do it manually
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        # yt-dlp fills the actual filename in the info dict
        downloaded = ydl.prepare_filename(info)

    # yt-dlp may change extension, so glob for the uid file
    if not os.path.exists(downloaded):
        matches = [
            os.path.join(tmp_dir, f)
            for f in os.listdir(tmp_dir)
            if f.startswith(f"audio_{uid}")
        ]
        if not matches:
            raise FileNotFoundError(f"Downloaded audio file not found for uid={uid}")
        downloaded = matches[0]

    return downloaded


def convert_to_wav(input_path: str) -> str:
    """
    Convert audio file to 16kHz mono WAV using ffmpeg.
    Required by Whisper for best accuracy.
    Returns path to WAV file.
    """
    base = os.path.splitext(input_path)[0]
    wav_path = base + "_16k.wav"

    cmd = [
        _FFMPEG_BIN,
        "-y",              # overwrite if exists
        "-i", input_path,
        "-ar", "16000",    # 16kHz sample rate
        "-ac", "1",        # mono
        "-vn",             # no video
        wav_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg error: {result.stderr}")

    return wav_path


def cleanup_files(*paths: str) -> None:
    """Delete temporary audio files."""
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except OSError:
            pass
