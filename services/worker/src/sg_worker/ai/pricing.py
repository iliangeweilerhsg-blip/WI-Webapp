"""Preise der Claude API und Umrechnung in Euro (VERTRAEGE §20.5, F-DAT-05).

USD je Million Tokens. Ein unbekanntes Modell (etwa über `SG_MODEL_*`) wird mit dem Preis von
`claude-opus-5-5` gerechnet, dazu eine Warnung im Log: lieber zu hoch, das Budget greift früher.
Bei `claude-haiku-5-5` gilt ab einem Prompt über 100 000 Tokens (Eingabe einschließlich Cache) der
höhere Preis für den ganzen Aufruf; mit `usage.iterations` je Eintrag.
"""

from __future__ import annotations

import logging
import math
import os
from collections.abc import Mapping
from dataclasses import dataclass

log = logging.getLogger(__name__)

DEFAULT_USD_EUR = 0.92
#: Ab dieser Prompt-Länge (Tokens) gilt bei Haiku der Langpreis für den ganzen Aufruf
HAIKU_LONG_PROMPT = 100_000
FALLBACK_MODEL = "claude-opus-5-5"


@dataclass(frozen=True)
class Price:
    """USD je Million Tokens."""

    input: float
    output: float
    cache_write: float  # 5 min
    cache_read: float


PRICES: Mapping[str, Price] = {
    "claude-haiku-5-5": Price(0.10, 0.50, 0.125, 0.01),
    "claude-sonnet-5-5": Price(2.0, 10.0, 2.50, 0.20),
    "claude-opus-5-5": Price(4.0, 20.0, 5.0, 0.20),
}
HAIKU_LONG = Price(0.50, 2.50, 0.625, 0.05)


@dataclass(frozen=True)
class Tokens:
    """Token-Zahlen eines Aufrufs (bzw. eines Eintrags aus `usage.iterations`)."""

    input: int = 0
    output: int = 0
    cache_write: int = 0
    cache_read: int = 0

    def __add__(self, other: Tokens) -> Tokens:
        return Tokens(
            self.input + other.input,
            self.output + other.output,
            self.cache_write + other.cache_write,
            self.cache_read + other.cache_read,
        )

    @property
    def prompt(self) -> int:
        return self.input + self.cache_write + self.cache_read


_warned: set[str] = set()


def price_for(model: str, prompt_tokens: int = 0) -> Price:
    """Preis eines Modells. Unbekannt: Opus-Preis und (einmal je Modell) eine Warnung."""
    if model == "claude-haiku-5-5" and prompt_tokens > HAIKU_LONG_PROMPT:
        return HAIKU_LONG
    price = PRICES.get(model)
    if price is None:
        if model not in _warned:
            _warned.add(model)
            log.warning(
                "Unbekanntes Modell, Kosten mit dem Preis von %s geschätzt",
                FALLBACK_MODEL,
                extra={"model": model[:100]},
            )
        return PRICES[FALLBACK_MODEL]
    return price


def cost_usd(model: str, tokens: Tokens) -> float:
    """Kosten eines Aufrufs bzw. Eintrags in USD (ungerundet)."""
    p = price_for(model, tokens.prompt)
    total = (
        tokens.input * p.input
        + tokens.output * p.output
        + tokens.cache_write * p.cache_write
        + tokens.cache_read * p.cache_read
    )
    return total / 1_000_000


def usd_eur(environ: Mapping[str, str] | None = None) -> float:
    """`SG_USD_EUR` (Standard 0,92). Ungültig, negativ oder nicht endlich: Standard."""
    env = os.environ if environ is None else environ
    raw = (env.get("SG_USD_EUR") or "").strip()
    if not raw:
        return DEFAULT_USD_EUR
    try:
        value = float(raw)
    except ValueError:
        value = math.nan
    if not math.isfinite(value) or value < 0:
        log.warning("SG_USD_EUR ungültig, verwende %s", DEFAULT_USD_EUR)
        return DEFAULT_USD_EUR
    return value


def to_eur(usd: float, environ: Mapping[str, str] | None = None) -> float:
    """`round(usd · SG_USD_EUR, 6)`."""
    return round(usd * usd_eur(environ), 6)
