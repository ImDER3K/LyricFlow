"""
Whisper transcription service.
Model is loaded once at startup (singleton pattern).
"""

import os
from typing import Optional
from dataclasses import dataclass

_model = None
_loaded_model_name: Optional[str] = None


@dataclass
class Segment:
    start: float
    end: float
    text: str


def _load_model(model_name: str = "base"):
    """Load Whisper model (lazy singleton)."""
    global _model, _loaded_model_name
    if _model is None or _loaded_model_name != model_name:
        print(f"[whisper] Loading model '{model_name}'…")
        try:
            import whisper  # type: ignore
            _model = whisper.load_model(model_name)
            _loaded_model_name = model_name
            print(f"[whisper] Model '{model_name}' ready.")
        except ImportError:
            raise RuntimeError(
                "openai-whisper is not installed. Run: pip install openai-whisper"
            )
    return _model


def transcribe(wav_path: str, model_name: str | None = None) -> list[Segment]:
    """
    Transcribe a WAV file with Whisper.
    Returns a list of Segment objects with start/end timestamps and text.
    Uses word_timestamps=True for better sync accuracy.
    """
    if not os.path.exists(wav_path):
        raise FileNotFoundError(f"WAV file not found: {wav_path}")

    model_name = model_name or os.getenv("WHISPER_MODEL", "base")
    model = _load_model(model_name)

    print(f"[whisper] Transcribing {wav_path} …")
    # Use word_timestamps=True for better synchronization
    result = model.transcribe(wav_path, word_timestamps=True, verbose=False)

    segments = []
    for seg in result.get("segments", []):
        segments.append(
            Segment(
                start=round(seg["start"], 3),
                end=round(seg["end"], 3),
                text=seg["text"].strip(),
            )
        )

    print(f"[whisper] Got {len(segments)} segments.")
    return segments


def segments_to_dict(segments: list[Segment]) -> list[dict]:
    return [{"start": s.start, "end": s.end, "text": s.text} for s in segments]
