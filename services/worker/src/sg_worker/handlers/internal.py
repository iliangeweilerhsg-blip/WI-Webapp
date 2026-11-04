"""Interner Test-Handler (kein Fachjob). Nur für Selbsttests des Worker-Gerüsts."""

from __future__ import annotations

from typing import Any

from ..registry import JobContext, handler


@handler("internal.echo")
def echo(payload: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    """Gibt das Payload zurück. `{"fail": true}` löst einen Fehler aus."""
    ctx.logger.info("echo")
    if payload.get("fail"):
        raise RuntimeError("absichtlicher Fehler")
    return {"echo": payload}
