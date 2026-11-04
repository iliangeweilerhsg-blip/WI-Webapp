"""Zuordnung der Modell-Stufen `fast/standard/deep` zu Modellnamen (02 §7).

Standard: Claude API. Änderbar per Umgebungsvariable (`SG_MODEL_FAST`, `SG_MODEL_STANDARD`,
`SG_MODEL_DEEP`); die Einstellungen der App schreiben später dorthin.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import get_args

from .interfaces import Tier

DEFAULT_TIER_MODELS: Mapping[Tier, str] = {
    "fast": "claude-haiku-5-5",
    "standard": "claude-sonnet-5-5",
    "deep": "claude-opus-5-5",
}


def tier_models(environ: Mapping[str, str] | None = None) -> dict[Tier, str]:
    """Liefert die Stufen-Zuordnung, Umgebungsvariablen überschreiben die Standardwerte."""
    env = os.environ if environ is None else environ
    return {
        tier: env.get(f"SG_MODEL_{tier.upper()}") or DEFAULT_TIER_MODELS[tier]
        for tier in get_args(Tier)
    }


def model_for(tier: Tier, environ: Mapping[str, str] | None = None) -> str:
    return tier_models(environ)[tier]
