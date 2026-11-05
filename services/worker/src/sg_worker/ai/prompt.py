"""Vokabular-Hinweis `initial_prompt` für die Transkription (VERTRAEGE §18.6, 05 §P4).

Form (Deutsch und `mixed`): `Vorlesung <Modulname>. Begriffe: <Begriff>, …. Folien: <Titel>, ….`
Englisch: `Lecture <name>. Terms: …. Slides: ….` Leere Teile entfallen samt Überschrift.

Grenze: höchstens `MAX_PROMPT_TOKENS` Whisper-Tokens **und** `MAX_PROMPT_CHARS` Zeichen (Nachtrag
N1 aus dem Review von #142). Gekürzt wird zuerst bei den Begriffen (die seltensten zuerst), dann bei
den Titeln (vom Anfang), zuletzt fällt der Modulteil weg. Whisper behält von einem zu langen
Hinweis nur das Ende, darum steht das Wichtigste hinten.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from .transcriber import estimate_tokens

MAX_PROMPT_TOKENS = 200
MAX_PROMPT_CHARS = 2000
MAX_TERMS = 50
MIN_TERM_COUNT = 2

#: Mindestens 4 Zeichen, beginnt mit einem Buchstaben (Unicode)
TERM_RE = re.compile(r"[^\W\d_][\w-]{3,}")

#: Feste Stoppwortliste (Deutsch und Englisch), nur Wörter mit mindestens 4 Zeichen sind relevant
_STOPWORD_TEXT = """
    aber alle allem allen aller alles also andere anderen anderer anderes auch auf aus bei beim
    bereits besonders bevor bild bilder bis bitte da dabei dadurch dafür daher damit dann daran
    darauf darin darum darunter darüber dass dein deine deinen deiner dem den denen denn dennoch
    der deren des deshalb dessen die dies diese diesem diesen dieser dieses doch dort durch eben
    ebenfalls ein eine einem einen einer eines einige einigen einiger einmal einzelne entweder er
    erst erste ersten erster etwa etwas euch euer eure falls folgende folgenden ganz gegen genau
    gibt gilt habe haben hast hat hatte hatten hier hierbei hin hinter ich ihm ihn ihnen ihr ihre
    ihrem ihren ihrer immer indem infolge innerhalb ist jede jedem jeden jeder jedes jedoch jene
    jetzt kann kein keine keinem keinen keiner können könnte machen macht mehr mehrere mein meine
    mit muss müssen nach nachdem neben nicht nichts noch nun nur ob oder ohne seid sein seine
    seinem seinen seiner seit selbst sich sie sind so sodass solche solchen soll sollen sollte
    sondern sowie sowohl statt über um und uns unser unsere unter viel viele vielen vom von vor
    wann war waren warum was weil weiter weitere weiteren welche welchem welchen welcher welches
    wenn wer werden wie wieder will wir wird wo wobei wurde wurden während zum zur zwar zwischen
    abschnitt aufgabe aufgaben beispiel beispiele folie folien kapitel seite seiten teil übersicht
    vorlesung zusammenfassung
    about above after again against also although among another because been before being
    below between both cannot could does doing down during each either else even every example
    examples few first from further given have having here hers herself himself however into
    itself just last less like many more most much must neither next none only other others ought
    over same shall should since some such than that their theirs them themselves then there
    therefore these they this those though through thus together under until upon very well were
    what when where whether which while whom whose will with within without would your yours
    yourself chapter lecture overview page pages part section slide slides summary
"""
STOPWORDS = frozenset(_STOPWORD_TEXT.split())


@dataclass(frozen=True)
class PromptParts:
    module_name: str
    terms: list[str]  # aufsteigend nach Häufigkeit (der häufigste zuletzt)
    titles: list[str]  # in Folienreihenfolge
    english: bool


def prompt_language(module_lang: str | None) -> str | None:
    """`module.lang` → Sprache für den Transcriber: `de`, `en`, sonst automatisch (None)."""
    return module_lang if module_lang in ("de", "en") else None


def clean_titles(titles: Iterable[str | None]) -> list[str]:
    """Getrimmt, leere weg, Dubletten ohne Groß-/Kleinschreibung weg (der erste gewinnt)."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in titles:
        title = (raw or "").strip()
        key = title.lower()
        if title and key not in seen:
            seen.add(key)
            out.append(title)
    return out


def extract_terms(texts: Iterable[str | None], titles: Iterable[str]) -> list[str]:
    """Die bis zu 50 häufigsten Fachbegriffe, aufsteigend nach Häufigkeit (der häufigste zuletzt),
    bei Gleichstand alphabetisch absteigend. Gezählt ohne Groß-/Kleinschreibung, gezeigt in der
    häufigsten Schreibweise (bei Gleichstand die alphabetisch erste). Ohne Stoppwörter und ohne
    Wörter aus den Titeln des Prompts, nur Begriffe mit mindestens zwei Vorkommen."""
    in_titles = {w.lower() for t in titles for w in TERM_RE.findall(t)}
    counts: Counter[str] = Counter()
    spellings: dict[str, Counter[str]] = {}
    for text in texts:
        for word in TERM_RE.findall(text or ""):
            key = word.lower()
            if key in STOPWORDS or key in in_titles:
                continue
            counts[key] += 1
            spellings.setdefault(key, Counter())[word] += 1
    ranked = sorted(
        (k for k, n in counts.items() if n >= MIN_TERM_COUNT), key=lambda k: (-counts[k], k)
    )[:MAX_TERMS]
    shown = [min(spellings[k].items(), key=lambda kv: (-kv[1], kv[0]))[0] for k in ranked]
    return list(reversed(shown))


def render_prompt(parts: PromptParts) -> str:
    head, terms_h, slides_h = (
        ("Lecture", "Terms", "Slides") if parts.english else ("Vorlesung", "Begriffe", "Folien")
    )
    out: list[str] = []
    name = " ".join(parts.module_name.split())
    if name:
        out.append(f"{head} {name}.")
    if parts.terms:
        out.append(f"{terms_h}: {', '.join(parts.terms)}.")
    if parts.titles:
        out.append(f"{slides_h}: {', '.join(parts.titles)}.")
    return " ".join(out)


def fits(text: str, count_tokens: Callable[[str], int]) -> bool:
    return len(text) <= MAX_PROMPT_CHARS and count_tokens(text) <= MAX_PROMPT_TOKENS


def shorten(parts: PromptParts, count_tokens: Callable[[str], int]) -> str | None:
    """Kürzt, bis die Grenze eingehalten ist (Reihenfolge siehe Modul-Doku). Leer: None."""
    terms, titles, name = list(parts.terms), list(parts.titles), parts.module_name
    while True:
        text = render_prompt(PromptParts(name, terms, titles, parts.english))
        if not text:
            return None
        if fits(text, count_tokens):
            return text
        if terms:
            terms.pop(0)
        elif titles:
            titles.pop(0)
        else:
            name = ""


def build_initial_prompt(
    *,
    module_name: str | None,
    module_lang: str | None,
    deck_titles: Iterable[str | None],
    module_texts: Iterable[str | None],
    count_tokens: Callable[[str], int] = estimate_tokens,
) -> str | None:
    """`deck_titles`: Titel des Foliensatzes der Session in Folienreihenfolge. `module_texts`:
    Titel und Text aller Folien aller Foliensätze des Moduls."""
    titles = clean_titles(deck_titles)
    terms = extract_terms(module_texts, titles)
    parts = PromptParts(module_name or "", terms, titles, module_lang == "en")
    return shorten(parts, count_tokens)
