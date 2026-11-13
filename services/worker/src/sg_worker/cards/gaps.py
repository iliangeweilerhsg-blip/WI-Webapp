"""Lückenregel für KI-Karten (VERTRAEGE §21.6, 05 §P10 Regel 4): Lücken nur auf Fachbegriffe.

Eine Lücke ist zulässig, wenn ihr Text 1 bis 5 Wörter und höchstens 60 Zeichen hat und mindestens
ein Wort einen Buchstaben enthält und kein Füllwort ist. Vergleich: Wort in Kleinbuchstaben
(`str.lower()`), Zeichen am Rand entfernt, die weder Buchstabe noch Ziffer sind.
"""

from __future__ import annotations

from .stopwords import STOPWORDS

MAX_GAP_WORDS = 5
MAX_GAP_CHARS = 60


def _edge(word: str) -> str:
    start, end = 0, len(word)
    while start < end and not word[start].isalnum():
        start += 1
    while end > start and not word[end - 1].isalnum():
        end -= 1
    return word[start:end]


def is_content_word(word: str) -> bool:
    """Enthält einen Buchstaben und ist kein Füllwort."""
    return any(ch.isalpha() for ch in word) and _edge(word.lower()) not in STOPWORDS


def gap_ok(text: str) -> bool:
    text = text.strip()
    words = text.split()
    if not 1 <= len(words) <= MAX_GAP_WORDS or len(text) > MAX_GAP_CHARS:
        return False
    return any(is_content_word(w) for w in words)
