"""Nachbearbeitung der Transcriber-Abschnitte (VERTRAEGE §18.2, 05 §P4), rein und ohne DB.

In dieser Reihenfolge:

1. Abschnitte mit `no_speech_prob > 0,6` verwerfen, ebenso Abschnitte mit leerem Text.
2. Wiederholung verwerfen: normierter Text gleich dem des zuletzt behaltenen Abschnitts und die
   Lücke dazu höchstens 2 s (Lead-Entscheidung im Review von #148: ein „Okay.“ nach 10 min bleibt).
3. Zusammenführen auf Satzgrenzen (5 bis 30 s), siehe `_joins`.
4. Je Gruppe Text, nach Dauer gewichtetes `avg_logprob`, maximales `no_speech_prob`, Sprache der
   Aufnahme und die Wörter (oder `None`, wenn der Transcriber keine liefert).
5. Wörter bereinigen: Text getrimmt, leere weg, `prob` auf 0..1, Zeiten in den Abschnitt geklemmt.

Zeiten: Sitzungszeit = `recording.started_ms + round(s · 1000)`.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .interfaces import Segment

NO_SPEECH_MAX = 0.6
MAX_GAP_MS = 2_000
MIN_GROUP_MS = 5_000
MAX_GROUP_MS = 30_000
SENTENCE_END = (".", "?", "!", "…")

_LANG_RE = re.compile(r"^[a-z]{2,3}$")


@dataclass(frozen=True)
class SegmentRow:
    """Eine Zeile für `transcript_segment` (ohne IDs)."""

    start_ms: int
    end_ms: int
    text: str
    lang: str | None
    avg_logprob: float | None
    no_speech_prob: float | None
    words: list[dict[str, Any]] | None

    @property
    def word_count(self) -> int:
        return len(self.words) if self.words is not None else len(self.text.split())


@dataclass
class _Part:
    """Ein Abschnitt in Sitzungszeit."""

    start_ms: int
    end_ms: int
    text: str
    seg: Segment


def to_session_ms(started_ms: int, seconds: float) -> int:
    if not math.isfinite(seconds):
        seconds = 0.0
    return started_ms + round(max(0.0, seconds) * 1000)


def normalize(text: str) -> str:
    """Klein, Satzzeichen entfernt, Leerraum zusammengefasst."""
    no_punct = "".join(ch for ch in text.lower() if not unicodedata.category(ch).startswith("P"))
    return " ".join(no_punct.split())


def valid_lang(lang: str | None) -> str | None:
    return lang if lang is not None and _LANG_RE.match(lang) else None


def recording_language(segments: Sequence[Segment], requested: str | None) -> str | None:
    """Erkannte Sprache der Aufnahme: die mit der größten Gesamtdauer (bei Gleichstand die zuerst
    erkannte). Ohne Erkennung die angeforderte Sprache."""
    totals: dict[str, float] = {}
    for seg in segments:
        lang = valid_lang(seg.language)
        if lang is not None:
            totals[lang] = totals.get(lang, 0.0) + max(0.0, seg.end - seg.start)
    if not totals:
        return valid_lang(requested)
    return max(totals, key=lambda k: totals[k])  # dict ist nach erstem Auftreten geordnet


def _keep(seg: Segment) -> bool:
    if seg.no_speech_prob is not None and seg.no_speech_prob > NO_SPEECH_MAX:
        return False
    return bool(seg.text.strip())


def _joins(group: list[_Part], nxt: _Part) -> bool:
    """Regel 3: (a) Lücke ≤ 2 s, (b) Gruppe < 5 s oder ohne Satzende, (c) danach ≤ 30 s."""
    start = group[0].start_ms
    end = max(p.end_ms for p in group)
    text = " ".join(p.text for p in group)
    gap_ok = nxt.start_ms - end <= MAX_GAP_MS
    open_ok = end - start < MIN_GROUP_MS or not text.endswith(SENTENCE_END)
    size_ok = max(end, nxt.end_ms) - start <= MAX_GROUP_MS
    return gap_ok and open_ok and size_ok


def _words(group: list[_Part], started_ms: int, lo: int, hi: int) -> list[dict[str, Any]] | None:
    if not any(p.seg.words for p in group):
        return None
    out: list[dict[str, Any]] = []
    for part in group:
        for w in part.seg.words:
            text = w.text.strip()
            if not text:
                continue
            start = min(max(to_session_ms(started_ms, w.start), lo), hi)
            end = min(max(to_session_ms(started_ms, w.end), start), hi)
            prob = w.prob if math.isfinite(w.prob) else 0.0
            out.append(
                {"text": text, "start_ms": start, "end_ms": end, "prob": min(max(prob, 0.0), 1.0)}
            )
    return out


def _weighted_logprob(group: list[_Part]) -> float | None:
    vals = [
        (p.seg.avg_logprob, p.end_ms - p.start_ms)
        for p in group
        if p.seg.avg_logprob is not None and math.isfinite(p.seg.avg_logprob)
    ]
    if not vals:
        return None
    total = sum(w for _, w in vals)
    if total <= 0:
        return sum(v for v, _ in vals) / len(vals)
    return sum(v * w for v, w in vals) / total


def postprocess(
    segments: Sequence[Segment], *, started_ms: int, language: str | None
) -> list[SegmentRow]:
    """Abschnitte des Transcribers → Zeilen für `transcript_segment` (Modul-Doku)."""
    parts: list[_Part] = []
    last_norm: str | None = None
    for seg in sorted(segments, key=lambda s: (s.start, s.end)):
        if not _keep(seg):  # Regel 1
            continue
        norm = normalize(seg.text)
        start = to_session_ms(started_ms, seg.start)
        end = max(to_session_ms(started_ms, seg.end), start)
        if parts and norm == last_norm and start - parts[-1].end_ms <= MAX_GAP_MS:  # Regel 2
            continue
        last_norm = norm
        parts.append(_Part(start, end, seg.text.strip(), seg))

    groups: list[list[_Part]] = []
    for part in parts:  # Regel 3
        if groups and _joins(groups[-1], part):
            groups[-1].append(part)
        else:
            groups.append([part])

    lang = valid_lang(language)
    rows: list[SegmentRow] = []
    for group in groups:  # Regeln 4 und 5
        lo = group[0].start_ms
        hi = max(p.end_ms for p in group)
        no_speech = [p.seg.no_speech_prob for p in group if p.seg.no_speech_prob is not None]
        rows.append(
            SegmentRow(
                start_ms=lo,
                end_ms=hi,
                text=" ".join(p.text for p in group),
                lang=lang,
                avg_logprob=_weighted_logprob(group),
                no_speech_prob=max(no_speech) if no_speech else None,
                words=_words(group, started_ms, lo, hi),
            )
        )
    return rows
