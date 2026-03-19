"""
Sync engine — aligns Whisper segments to canonical lyric lines using rapidfuzz.

How it works:
  1. Split canonical lyrics into individual non-empty lines.
  2. For each Whisper segment, fuzzy-match it against ALL lyric lines.
  3. Build a mapping: lyric line → best-matching Whisper segment timestamp.
  4. Fill gaps using interpolation so every lyric line gets a time.
"""

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class TimedLine:
    time: float       # seconds from start
    text: str
    confidence: float  # 0–100, how confident the match was


def _normalize(text: str) -> str:
    """Lowercase, remove punctuation, collapse whitespace."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def align(
    whisper_segments: list[dict],  # [{"start":float, "end":float, "text":str}]
    lyrics_text: str,
    duration: float = 0.0,
) -> list[TimedLine]:
    """
    Align Whisper segments to canonical lyric lines.
    Returns list of TimedLine sorted by time.
    """
    from rapidfuzz import fuzz, process  # type: ignore

    # --- Prepare lyric lines ---
    raw_lines = [l.strip() for l in lyrics_text.split("\n")]
    lyric_lines = [l for l in raw_lines if l]   # non-empty only
    if not lyric_lines:
        return []

    # --- Prepare Whisper segments ---
    if not whisper_segments:
        # No Whisper output — fall back to evenly-distributed timing
        return _evenly_distribute(lyric_lines, duration)

    # Normalize for matching
    norm_lyrics = [_normalize(l) for l in lyric_lines]
    norm_whisper = [_normalize(s["text"]) for s in whisper_segments]

    # --- Build lyric → best segment mapping ---
    # line_times[i] = (time, confidence) or None
    line_times: list[Optional[tuple[float, float]]] = [None] * len(lyric_lines)

    for seg_idx, seg in enumerate(whisper_segments):
        seg_text_norm = norm_whisper[seg_idx]
        if not seg_text_norm:
            continue

        # Find best matching lyric line
        match = process.extractOne(
            seg_text_norm,
            norm_lyrics,
            scorer=fuzz.partial_ratio,
            score_cutoff=30,
        )
        if match is None:
            continue

        _matched_text, score, lyric_idx = match

        # Only assign if not yet assigned OR if this match is better
        if line_times[lyric_idx] is None or score > line_times[lyric_idx][1]:
            line_times[lyric_idx] = (seg["start"], score)

    # --- Fill gaps by interpolation ---
    # First, collect known anchor points
    anchors: list[tuple[int, float]] = [
        (i, line_times[i][0]) for i in range(len(lyric_lines)) if line_times[i] is not None
    ]

    if not anchors:
        # No matches at all — fall back to evenly-distributed
        return _evenly_distribute(lyric_lines, duration)

    # Extrapolate before first anchor
    if anchors[0][0] > 0:
        first_time = anchors[0][1]
        first_idx = anchors[0][0]
        step = first_time / (first_idx + 1) if first_idx > 0 else 1.0
        for i in range(first_idx):
            line_times[i] = ((i + 1) * step, 0.0)

    # Interpolate between anchors
    for k in range(len(anchors) - 1):
        i_start, t_start = anchors[k]
        i_end, t_end = anchors[k + 1]
        gap_lines = i_end - i_start
        if gap_lines <= 1:
            continue
        step = (t_end - t_start) / gap_lines
        for j in range(1, gap_lines):
            idx = i_start + j
            if line_times[idx] is None:
                line_times[idx] = (t_start + j * step, 0.0)

    # Extrapolate after last anchor
    last_idx, last_time = anchors[-1]
    end_time = duration if duration > last_time else last_time + 30
    remaining = len(lyric_lines) - last_idx - 1
    if remaining > 0:
        step = (end_time - last_time) / (remaining + 1)
        for j in range(1, remaining + 1):
            idx = last_idx + j
            if line_times[idx] is None:
                line_times[idx] = (last_time + j * step, 0.0)

    # --- Build result ---
    result = []
    for i, line in enumerate(lyric_lines):
        t_conf = line_times[i]
        t = t_conf[0] if t_conf else 0.0
        conf = t_conf[1] if t_conf else 0.0
        result.append(TimedLine(time=round(t, 3), text=line, confidence=round(conf, 1)))

    result.sort(key=lambda x: x.time)
    return result


def _evenly_distribute(lines: list[str], duration: float) -> list[TimedLine]:
    """Fallback: evenly distribute lyric lines over the song duration."""
    d = max(duration, 30.0)
    intro = d * 0.07
    outro = d * 0.05
    span = d - intro - outro
    gap = span / max(len(lines), 1)
    return [
        TimedLine(
            time=round(intro + i * gap, 3),
            text=line,
            confidence=0.0,
        )
        for i, line in enumerate(lines)
    ]


def timed_lines_to_dict(lines: list[TimedLine]) -> list[dict]:
    return [{"time": l.time, "text": l.text, "confidence": l.confidence} for l in lines]
