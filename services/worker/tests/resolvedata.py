"""Testdaten für `concepts.resolve` und `summary.write` (T2-21b). Alles erfunden."""

from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass, field
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from conceptdata import add_job, deck, ins, module, session
from conftest import USER_ID
from sg_worker.ai.embedder import DIM
from sg_worker.handlers import concepts_resolve as cr
from sg_worker.handlers.search_index import vector_literal

Conn = psycopg.Connection[Any]

EMBED_MODEL = "winkel-embed-1"


def angle(similarity: float) -> float:
    """Winkel, bei dem zwei Vektoren die Ähnlichkeit `similarity` haben."""
    return math.acos(similarity)


@dataclass
class AngleEmbedder:
    """Embedder mit steuerbarer Ähnlichkeit: Namen mit Winkel liegen in einer Ebene
    (Ähnlichkeit = Kosinus der Winkeldifferenz), alle anderen stehen senkrecht zu allem."""

    angles: dict[str, float] = field(default_factory=dict)
    provider: str = "fake"
    model: str = EMBED_MODEL
    dim: int = DIM
    texts: list[str] = field(default_factory=list)
    _slots: dict[str, int] = field(default_factory=dict)

    def ready(self) -> bool:
        return True

    def error(self) -> str | None:
        return None

    def wait_ready(self, timeout_s: float) -> bool:
        return True

    def vector(self, name: str) -> list[float]:
        key = name.lower()
        vec = [0.0] * self.dim
        if key in self.angles:
            vec[0], vec[1] = math.cos(self.angles[key]), math.sin(self.angles[key])
        else:
            vec[self._slots.setdefault(key, 2 + len(self._slots))] = 1.0
        return vec

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.texts += texts
        return [self.vector(t.split("\n")[0]) for t in texts]


@dataclass
class Lecture:
    mod: uuid.UUID
    sid: uuid.UUID
    deck: uuid.UUID
    slides: list[uuid.UUID]


def lecture(conn: Conn, *, slides: int = 6) -> Lecture:
    mod = module(conn)
    did, ids = deck(conn, mod, [{"title": f"Folie {i}", "text": "Text."} for i in range(slides)])
    return Lecture(mod, session(conn, mod, deck=did), did, ids)


def second_session(conn: Conn, lec: Lecture) -> Lecture:
    return Lecture(lec.mod, session(conn, lec.mod, deck=lec.deck), lec.deck, lec.slides)


def proposal(name: str, **values: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "name": name,
        "aliases": [],
        "one_liner": f"Erfundene Erklärung zu {name}.",
        "kind": "definition",
        "importance": 2,
        "exam_hint": False,
        "prof_explanation": None,
        "confidence": 0.8,
    }
    base.update(values)
    return base


def relation(a: str, b: str, kind: str = "baut_auf", confidence: float = 0.9) -> dict[str, Any]:
    return {
        "from": a,
        "to": b,
        "kind": kind,
        "why": "Erfundene Begründung.",
        "confidence": confidence,
    }


def extract_job(
    conn: Conn,
    lec: Lecture,
    proposals: list[dict[str, Any]],
    relations: list[dict[str, Any]] | None = None,
    *,
    input_hash: str | None = "a" * 64,
    state: str = "fertig",
) -> uuid.UUID:
    """Ein fertiger `concepts.extract` mit vorgegebenem Ergebnis. Konzept `c<n>` hat die Folie
    `n` und einen Zeitraum als Belege."""
    concepts = [
        {
            "key": f"c{n}",
            "proposal": p,
            "evidence": [
                {
                    "kind": "slide",
                    "slide_id": str(lec.slides[n - 1]),
                    "deck_id": str(lec.deck),
                    "slide_index": n,
                },
                {
                    "kind": "transcript",
                    "session_id": str(lec.sid),
                    "t_start_ms": n * 60_000,
                    "t_end_ms": n * 60_000 + 30_000,
                },
            ],
        }
        for n, p in enumerate(proposals, start=1)
    ]
    result = {
        "session_id": str(lec.sid),
        "session_deleted": False,
        "empty": not concepts and input_hash is None,
        "unchanged": False,
        "input_hash": input_hash,
        "prompt_version": "concepts.extract/v1" if input_hash else None,
        "model": "fake-llm-1" if input_hash else None,
        "chapters": 1 if input_hash else 0,
        "concepts": concepts,
        "relations": relations or [],
        "dropped_concepts": 0,
        "dropped_evidence": 0,
        "dropped_relations": 0,
        "cost_eur": 0.0,
    }
    job_id = uuid.uuid4()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload, session_id, state, result, created_at) "
        "VALUES (%s, %s, 'concepts.extract', %s, %s, %s, %s, clock_timestamp())",
        (job_id, USER_ID, json.dumps({"session_id": str(lec.sid)}), lec.sid, state, Jsonb(result)),
    )
    return job_id


def resolve_job(
    conn: Conn, lec: Lecture, extract_id: uuid.UUID, *, force: bool = False
) -> uuid.UUID:
    payload: dict[str, Any] = {"session_id": str(lec.sid), "extract_job_id": str(extract_id)}
    if force:
        payload["force"] = True
    return add_job(conn, lec.sid, job_type="concepts.resolve", payload=payload)


def active(
    conn: Conn,
    embedder: AngleEmbedder | None,
    name: str,
    *,
    aliases: list[str] | None = None,
    mod: uuid.UUID | None = None,
    one_liner: str | None = None,
) -> uuid.UUID:
    """Ein aktives Konzept. Mit `embedder` bekommt es dessen Vektor."""
    cid = ins(
        conn, "concept", name=name, aliases=aliases or [], status="aktiv", one_liner=one_liner
    )
    if embedder is not None:
        text = cr.embed_text(name, aliases or [], one_liner)
        conn.execute(
            "UPDATE concept SET embedding = %s::vector, embedding_model = %s WHERE id = %s",
            (vector_literal(embedder.vector(text.split("\n")[0])), embedder.model, cid),
        )
    if mod is not None:
        ins(conn, "concept_module", concept_id=cid, module_id=mod)
    return cid


def rows(conn: Conn, sql: str, *params: Any) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)  # type: ignore[arg-type]
        return cur.fetchall()


def items(conn: Conn, sid: uuid.UUID | None = None) -> list[dict[str, Any]]:
    found = rows(conn, "SELECT * FROM inbox_item ORDER BY priority, id")
    return [i for i in found if sid is None or i["session_id"] == sid]


def concept_named(conn: Conn, name: str, status: str | None = None) -> dict[str, Any]:
    found = [
        c
        for c in rows(conn, "SELECT * FROM concept WHERE name = %s ORDER BY id", name)
        if status is None or c["status"] == status
    ]
    assert len(found) == 1, (name, status, found)
    return found[0]


def set_auto_accept(conn: Conn, mode: str, budget: float = 10) -> None:
    conn.execute(
        "INSERT INTO setting (key, value, user_id) VALUES ('ai', %s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (Jsonb({"monthly_budget_eur": budget, "auto_accept": mode}), USER_ID),
    )
