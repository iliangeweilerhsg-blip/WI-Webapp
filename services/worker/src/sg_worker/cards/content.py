"""Karteninhalt säubern und prüfen (VERTRAEGE §21.2), Format nach 08 §6, nur `basic` und `cloze`.

- **Säubern:** NFC, Zeilenenden zu `\\n`, Tab zu Leerzeichen, Steuerzeichen (`Cc` außer `\\n`) und
  Formatzeichen (`Cf`) entfernen, trimmen. Gespeichert wird die gesäuberte Fassung.
- **Lücken:** `{{cN::Text}}` mit `N` = 1 bis 3, lückenlos ab 1, jede Nummer einmal. Der Text einer
  Lücke enthält weder `{` noch `}` noch `::` und wird am Rand getrimmt. Außerhalb gültiger Lücken
  darf der Text weder `{{` noch `}}` enthalten. `back.answers` hat genau die Schlüssel der Lücken,
  die **erste** Lösung ist der Text der Lücke.
- **Prüfung** mit dem ersten Verstoß als `reason`: `empty`, `cloze_syntax`, `cloze_none`,
  `cloze_numbers`, `cloze_answers`. Dazu hier `too_long` für die Zeichengrenzen des Schemas
  (Vorderseite 500, Antwort und Erklärung 1 000, Lösung 200 Zeichen, 1 bis 5 Lösungen je Lücke).
- **Wörter zählen:** Folgen von Zeichen ohne Leerraum. Bei `cloze` zählt die Vorderseite mit
  eingesetzten Lücken, die Antwort ist die längste Lücke.

Dieselben Regeln rechnet der Core. Beide prüfen gegen
`packages/schemas/fixtures/cards/content.json`.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

MAX_FRONT = 500
MAX_BACK = 1000
MAX_EXPLANATION = 1000
MAX_SOLUTION = 200
MAX_SOLUTIONS = 5
MAX_GAPS = 3
GAP_MASK = "[…]"

_GAP = re.compile(r"\{\{c(\d+)::(.*?)\}\}", re.DOTALL)


class CardInvalid(Exception):
    """Der Inhalt verletzt §21.2. `reason` ist der erste Verstoß."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def sanitize(text: str) -> str:
    """Säubern nach §21.2 (siehe Modul-Doku)."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    text = "".join(ch for ch in text if ch == "\n" or unicodedata.category(ch) not in ("Cc", "Cf"))
    return unicodedata.normalize("NFC", text).strip()


def count_words(text: str) -> int:
    return len(text.split())


def mask_gaps(front: str) -> str:
    """Anzeige der Vorderseite: jede Lücke als `[…]`."""
    return _GAP.sub(GAP_MASK, front)


def fill_gaps(front: str) -> str:
    """Vorderseite mit eingesetzten Lücken (für das Zählen der Wörter)."""
    return _GAP.sub(lambda m: m.group(2).strip(), front)


@dataclass(frozen=True)
class Checked:
    """Gesäuberter, geprüfter Inhalt. `content` ist die gespeicherte Fassung (`CardContent`)."""

    content: dict[str, Any]
    front_words: int
    answer_words: int
    explanation_words: int
    plain: str
    gaps: list[str] = field(default_factory=list)  # Text je Lücke, in der Reihenfolge im Text


def _clean_list(values: Any) -> list[str]:
    if not isinstance(values, list) or not values:
        raise CardInvalid("cloze_answers")
    out: list[str] = []
    for value in values:
        if not isinstance(value, str):
            raise CardInvalid("cloze_answers")
        cleaned = sanitize(value)
        if not cleaned:
            raise CardInvalid("empty")
        out.append(cleaned)
    return out


def _required(value: Any) -> str:
    cleaned = sanitize(value) if isinstance(value, str) else ""
    if not cleaned:
        raise CardInvalid("empty")
    return cleaned


def _basic(raw: dict[str, Any]) -> Checked:
    front = _required((raw.get("front") or {}).get("text_md"))
    back = raw.get("back") or {}
    answer = _required(back.get("text_md"))
    explanation_raw = back.get("explanation_md")
    explanation = None if explanation_raw is None else _required(explanation_raw)
    if len(front) > MAX_FRONT or len(answer) > MAX_BACK:
        raise CardInvalid("too_long")
    if explanation is not None and len(explanation) > MAX_EXPLANATION:
        raise CardInvalid("too_long")
    return Checked(
        content={
            "kind": "basic",
            "front": {"text_md": front},
            "back": {"text_md": answer, "explanation_md": explanation},
        },
        front_words=count_words(front),
        answer_words=count_words(answer),
        explanation_words=0 if explanation is None else count_words(explanation),
        plain=front,
    )


def _cloze(raw: dict[str, Any]) -> Checked:
    front = _required((raw.get("front") or {}).get("text_md"))
    matches = list(_GAP.finditer(front))
    for m in matches:  # 1. Syntax der Lücken
        text = m.group(2).strip()
        if not text or any(bad in text for bad in ("{", "}", "::")):
            raise CardInvalid("cloze_syntax")
    if not matches:  # 2. keine Lücke
        raise CardInvalid("cloze_none")
    rest = _GAP.sub("", front)
    if "{{" in rest or "}}" in rest:  # 3. Lückentext
        raise CardInvalid("cloze_syntax")
    numbers = [int(m.group(1)) for m in matches]
    if sorted(numbers) != list(range(1, len(numbers) + 1)) or len(numbers) > MAX_GAPS:
        raise CardInvalid("cloze_numbers")
    texts = {int(m.group(1)): m.group(2).strip() for m in matches}
    answers_raw = (raw.get("back") or {}).get("answers")
    if not isinstance(answers_raw, dict) or set(answers_raw) != {f"c{n}" for n in texts}:
        raise CardInvalid("cloze_answers")
    answers = {str(k): _clean_list(v) for k, v in answers_raw.items()}
    for n, text in texts.items():
        if answers[f"c{n}"][0] != text:
            raise CardInvalid("cloze_answers")
    normalized = _GAP.sub(lambda m: "{{c" + m.group(1) + "::" + m.group(2).strip() + "}}", front)
    if len(normalized) > MAX_FRONT or any(
        len(values) > MAX_SOLUTIONS or any(len(a) > MAX_SOLUTION for a in values)
        for values in answers.values()
    ):
        raise CardInvalid("too_long")
    return Checked(
        content={
            "kind": "cloze",
            "front": {"text_md": normalized},
            "back": {"answers": {f"c{n}": answers[f"c{n}"] for n in sorted(texts)}},
        },
        front_words=count_words(fill_gaps(normalized)),
        answer_words=max(count_words(t) for t in texts.values()),
        explanation_words=0,
        plain=mask_gaps(normalized),
        gaps=[texts[n] for n in numbers],
    )


def check_content(raw: dict[str, Any]) -> Checked:
    """Säubert und prüft einen Inhalt (`CardContent` als dict). `CardInvalid` bei einem Verstoß."""
    kind = raw.get("kind")
    if kind == "basic":
        return _basic(raw)
    if kind == "cloze":
        return _cloze(raw)
    raise CardInvalid("empty")
