"""`concepts.resolve`: Konzepte einer Vorlesung mit dem Wissensnetz abgleichen (VERTRAEGE §20.3,
05 §P8, Stufe `standard`).

Ablauf:

1. Payload prüfen, KI eingerichtet? Session lesen (fehlt → `fehler`, weich gelöscht → `fertig` mit
   `session_deleted`). `extract_job_id` muss ein `fertig`er `concepts.extract` derselben Session
   sein, sonst `fehler` (`Konzepte fehlen`).
2. Gleicher `extract_input_hash` und gleiche `RESOLVE_VERSION` wie beim neuesten fertigen Lauf und
   kein `force`: `unchanged`, nichts schreiben (die Inbox bleibt stabil). Ausnahme: Der letzte
   echte Abgleich lief ohne Embedder (`embedding_model = null`) und der Embedder ist jetzt bereit.
   Dann wird neu abgeglichen.
3. Vektoren: aktive Konzepte ohne Vektor des aktuellen Modells (≤ 500) und die extrahierten
   Konzepte einbetten. Ohne Embedder degradiert: nur Namensgleichheit.
4. Zuordnen (`plan`): schon entschieden in dieser Session → Kandidaten (exakte Suche, die 5
   ähnlichsten ab 0,75) → automatisch (≥ 0,88 und namensähnlich) → KI-Entscheidung im Band.
5. **Ein** KI-Aufruf (Entscheidungen und Beziehungen zu Nachbarn), nur wenn es Band-Kandidaten oder
   Nachbarn gibt. Außerhalb einer Transaktion, der Heartbeat läuft weiter.
6. Schreiben in einer Transaktion. Sperrreihenfolge: Session → Advisory-Lock des Wissensnetzes →
   Konzepte nach ID `FOR NO KEY UPDATE`. Unter den Sperren wird die Zuordnung mit dem jetzigen
   Stand der Inbox wiederholt, eigene gänzlich offene Ergebnisse werden ersetzt, Entschiedenes
   bleibt. Danach die Automatik (`ai.auto_accept`) mit den Regeln aus `concepts/accept.py`.

**Auslegungen** (im PR unter „Offene Punkte“ genannt):

- Nachbarn (Schritt 6 des Vertrags) bekommt jedes extrahierte Konzept, das zu einem Vorschlag wird
  (`concept_new` oder `concept_merge`). Die Beziehungen hängen am Vorschlag und wandern beim
  Annehmen mit (A2).
- `alles_ab_0_9` bestätigt Beziehungen nur mit `confidence ≥ 0,9` (wie A1 in §20.6).
- `auto_merged` zählt jedes Konzept, dessen Belege ohne Vorschlag an ein vorhandenes Konzept
  gingen (automatische Regel, schon angenommen in dieser Session, erhaltener Vorschlag).
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from functools import cache, partial
from operator import mul
from pathlib import Path
from typing import Any, Literal

import psycopg
from psycopg.types.json import Jsonb
from pydantic import ValidationError
from sg_schemas.models import ConceptsExtractResult, ConceptsResolvePayload, ConceptsResolveResult

from .. import progress
from ..ai import embedder as embedders
from ..ai import llm as llm_mod
from ..ai import llm_fake
from ..ai.budget import CostMeter
from ..ai.embedder import EmbedderNotReady, EmbedderUnavailable, safe_error
from ..ai.interfaces import Effort, StructuredRequest, Tier
from ..ai.outputs import CONCEPTS_RESOLVE_PROMPT, ConceptsResolveOutput
from ..concepts import accept
from ..concepts.cycle import confirmed_edges, find_cycle
from ..concepts.material import LANG_NAMES, esc, shorten, unit
from ..concepts.names import Labels, labels, name_base, normalize_name, same_name, similar_name
from ..registry import JobContext, LockLostError, NonRetryableError, handler
from ..uuid7 import uuid7
from . import search_index

TASK = "concepts.resolve"
EXTRACT_TASK = "concepts.extract"
TIER: Tier = "standard"
#: Steigt mit Änderungen an den Regeln des Abgleichs (§20.3 Schritt 2)
RESOLVE_VERSION = 1
PROMPT_FILE = Path(__file__).resolve().parents[3] / "prompts" / "concepts.resolve" / "v1.md"
EFFORT: Effort = "low"
MAX_TOKENS = 16_000

SIM_MIN = 0.75
SIM_AUTO = 0.88
TOP_K = 5
NEIGHBORS = 20
MAX_NEIGHBOR_PAIRS = 200
MAX_CATCH_UP = 500
MAX_EMBED_TEXT = 2000
MAX_SIMILAR = 3
MAX_KI_RELATIONS = 60
MAX_WHY = 500
MAX_REASON = 500
NO_EXTRACT = "Konzepte fehlen"

Conn = psycopg.Connection[Any]
Mode = Literal["rejected", "attach", "new", "merge"]

#: Exakte Suche (§20.3 Schritt 5): Die CTE rechnet die Ähnlichkeit für alle aktiven Konzepte.
#: Ohne `ORDER BY embedding <=> …` nutzt der Planer den HNSW-Index nicht, der erst nach der Suche
#: filtert und mit `status = 'aktiv'` zu wenige Treffer liefert (§19.6).
NEAREST_SQL = """
WITH scored AS MATERIALIZED (
  SELECT id, (1 - (embedding <=> %s::vector))::float8 AS sim FROM concept
  WHERE status = 'aktiv' AND deleted_at IS NULL AND embedding_model = %s
)
SELECT id, sim FROM scored ORDER BY sim DESC, id LIMIT %s
"""


# ---------- Typen ----------


@dataclass(frozen=True)
class Extracted:
    """Ein Konzept aus dem Extrakt (`c1`, `c2`, …) mit seiner Position (ab 0)."""

    key: str
    pos: int
    proposal: dict[str, Any]
    evidence: list[dict[str, Any]]
    labels: Labels

    @property
    def name(self) -> str:
        return str(self.proposal["name"])


@dataclass(frozen=True)
class Known:
    """Ein vorhandenes Konzept, wie es der Abgleich und der Prompt brauchen."""

    id: uuid.UUID
    name: str
    aliases: tuple[str, ...]
    one_liner: str | None
    modules: tuple[str, ...] = ()

    @property
    def labels(self) -> Labels:
        return labels(self.name, self.aliases)


@dataclass(frozen=True)
class Verdict:
    verdict: str
    reason: str | None
    confidence: float


@dataclass
class State:
    """Was in dieser Session schon entschieden ist bzw. erhalten bleibt (§20.3 Schritt 5/7)."""

    rejected: list[Labels] = field(default_factory=list)
    accepted: list[tuple[uuid.UUID, Labels]] = field(default_factory=list)
    preserved: list[tuple[uuid.UUID, Labels]] = field(default_factory=list)
    deletable: list[uuid.UUID] = field(default_factory=list)


@dataclass
class Assignment:
    x: Extracted
    mode: Mode
    #: `attach`: Konzept, das die Belege bekommt. `merge`: Ziel. `new`: None
    target: uuid.UUID | None = None
    #: ID des neuen Vorschlags (`new`, `merge`)
    concept_id: uuid.UUID | None = None
    basis: str | None = None
    similarity: float | None = None
    reason: str | None = None
    confidence: float = 0.0
    similar: list[dict[str, Any]] = field(default_factory=list)
    related: list[tuple[uuid.UUID, str, float]] = field(default_factory=list)
    asked: list[uuid.UUID] = field(default_factory=list)

    @property
    def lands_on(self) -> uuid.UUID | None:
        """Das Konzept, auf das Beziehungen aus dem Extrakt zeigen."""
        return self.target if self.mode == "attach" else self.concept_id


@dataclass
class Vectors:
    """`model = None`: degraded (ohne Embedder). `catch_up`: nachgeholte Vektoren aktiver
    Konzepte mit `updated_at` beim Lesen."""

    model: str | None
    current: str
    error: str | None = None
    by_key: dict[str, list[float]] = field(default_factory=dict)
    catch_up: dict[uuid.UUID, tuple[list[float], Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class RelationSpec:
    from_id: uuid.UUID
    to_id: uuid.UUID
    kind: str
    why: str
    confidence: float
    prompt_version: str
    model: str


@dataclass
class Counts:
    auto_merged: int = 0
    proposed_new: int = 0
    proposed_merge: int = 0
    proposed_relations: int = 0
    auto_accepted: int = 0
    skipped_rejected: int = 0
    dropped_cycles: int = 0
    embedded_concepts: int = 0


# ---------- Lesen ----------


def _extract(conn: Conn, payload: ConceptsResolvePayload, sid: uuid.UUID) -> ConceptsExtractResult:
    row = conn.execute(
        "SELECT type, state, session_id, result FROM job WHERE id = %s AND deleted_at IS NULL",
        (uuid.UUID(payload.extract_job_id),),
    ).fetchone()
    if row is None or row[0] != EXTRACT_TASK or row[1] != "fertig" or row[2] != sid:
        raise NonRetryableError(NO_EXTRACT)
    try:
        return ConceptsExtractResult.model_validate(row[3])
    except ValidationError:
        raise NonRetryableError(NO_EXTRACT) from None


def _extracted(extract: ConceptsExtractResult) -> tuple[list[Extracted], list[dict[str, Any]]]:
    data = extract.model_dump(mode="json", by_alias=True)
    xs = [
        Extracted(
            key=c["key"],
            pos=pos,
            proposal=c["proposal"],
            evidence=c["evidence"],
            labels=labels(c["proposal"]["name"], c["proposal"]["aliases"]),
        )
        for pos, c in enumerate(data["concepts"])
    ]
    return xs, data["relations"]


def _previous(conn: Conn, sid: uuid.UUID, job_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT result FROM job WHERE type = %s AND session_id = %s AND state = 'fertig' "
        "AND deleted_at IS NULL AND id <> %s ORDER BY created_at DESC, id DESC LIMIT 1",
        (TASK, sid, uuid.UUID(job_id)),
    ).fetchone()
    return row[0] if row and isinstance(row[0], dict) else None


def load_state(conn: Conn, sid: uuid.UUID) -> State:
    """Vorschläge dieser Session nach dem Stand ihrer Einträge (§20.3 Schritt 5 und 7)."""
    state = State()
    rows = conn.execute(
        """
        SELECT c.id, c.name, c.aliases, i.status,
          EXISTS (SELECT 1 FROM concept_relation r JOIN inbox_item ri ON ri.relation_id = r.id
                  WHERE (r.from_id = c.id OR r.to_id = c.id) AND ri.status <> 'offen') AS pinned
        FROM concept c LEFT JOIN inbox_item i ON i.concept_id = c.id
        WHERE c.status = 'vorschlag' AND c.proposal_session_id = %s AND c.deleted_at IS NULL
        ORDER BY c.id
        """,
        (sid,),
    ).fetchall()
    for cid, name, aliases, status, pinned in rows:
        own = labels(name, aliases or [])
        if status == "abgelehnt":
            state.rejected.append(own)
        elif status == "offen" and pinned:
            state.preserved.append((cid, own))
        elif status in (None, "offen") and not pinned:
            state.deletable.append(cid)
    rows = conn.execute(
        """
        SELECT DISTINCT c.id, c.name, c.aliases FROM inbox_item i
        JOIN concept p ON p.id = i.concept_id
        JOIN concept c ON c.id = CASE WHEN p.status = 'zusammengefuehrt' THEN p.merged_into
                                      ELSE p.id END
        WHERE i.session_id = %s AND i.status IN ('angenommen', 'automatisch')
          AND i.kind IN ('concept_new', 'concept_merge') AND i.deleted_at IS NULL
          AND c.status = 'aktiv' AND c.deleted_at IS NULL
        ORDER BY c.id
        """,
        (sid,),
    ).fetchall()
    state.accepted = [(cid, labels(name, aliases or [])) for cid, name, aliases in rows]
    return state


def load_actives(conn: Conn) -> list[tuple[uuid.UUID, Labels]]:
    """Alle aktiven Konzepte mit ihren Vergleichsformen (nur degradiert gebraucht)."""
    rows = conn.execute(
        "SELECT id, name, aliases FROM concept WHERE status = 'aktiv' AND deleted_at IS NULL "
        "ORDER BY id"
    ).fetchall()
    return [(cid, labels(name, aliases or [])) for cid, name, aliases in rows]


def load_known(conn: Conn, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Known]:
    if not ids:
        return {}
    modules: dict[uuid.UUID, list[str]] = {}
    for cid, name in conn.execute(
        "SELECT cm.concept_id, m.name FROM concept_module cm JOIN module m ON m.id = cm.module_id "
        "WHERE cm.concept_id = ANY(%s) AND cm.deleted_at IS NULL AND m.deleted_at IS NULL "
        "ORDER BY m.name, m.id",
        (list(ids),),
    ).fetchall():
        modules.setdefault(cid, []).append(str(name))
    rows = conn.execute(
        "SELECT id, name, aliases, one_liner FROM concept WHERE id = ANY(%s)", (list(ids),)
    ).fetchall()
    return {
        r[0]: Known(r[0], r[1], tuple(r[2] or ()), r[3], tuple(modules.get(r[0], ()))) for r in rows
    }


# ---------- Vektoren (§20.3 Schritt 3 und 4) ----------


def _degraded_before(conn: Conn, sid: uuid.UUID, digest: str, job_id: str) -> bool:
    """§20.3 Schritt 2: Lief der letzte echte Abgleich dieses Extrakts ohne Embedder?

    Ein `unchanged`-Lauf trägt selbst kein `embedding_model`. Darum zählt der neueste Lauf mit
    demselben `extract_input_hash` und derselben `resolve_version`, der wirklich abgeglichen hat."""
    row = conn.execute(
        "SELECT result->>'embedding_model' FROM job WHERE type = %s AND session_id = %s "
        "AND state = 'fertig' AND deleted_at IS NULL AND id <> %s "
        "AND result->>'extract_input_hash' = %s AND result->>'resolve_version' = %s "
        "AND COALESCE(result->>'unchanged', 'false') <> 'true' "
        "AND COALESCE(result->>'session_deleted', 'false') <> 'true' "
        "ORDER BY created_at DESC, id DESC LIMIT 1",
        (TASK, sid, uuid.UUID(job_id), digest, str(RESOLVE_VERSION)),
    ).fetchone()
    return row is not None and row[0] is None


def _embedder_ready() -> bool:
    """Wartet wie Schritt 3 (`wait_ready`, §19.3). Ohne Embedder kommt sofort False."""
    return search_index.get_embedder().wait_ready(search_index.WAIT_READY_S)


def embed_text(name: str, aliases: Sequence[str], one_liner: str | None) -> str:
    """Name, Aliase (mit `, `) und One-Liner, je eine Zeile, gesäubert wie §19.3, ≤ 2 000."""
    lines = [
        search_index.clean_text(name),
        ", ".join(a for a in (search_index.clean_text(x) for x in aliases) if a),
        search_index.clean_text(one_liner or ""),
    ]
    return "\n".join(line for line in lines if line)[:MAX_EMBED_TEXT]


def embed_all(conn: Conn, xs: Sequence[Extracted]) -> Vectors:
    embedder = search_index.get_embedder()
    out = Vectors(model=embedder.model, current=embedder.model)
    stale = conn.execute(
        "SELECT id, name, aliases, one_liner, updated_at FROM concept WHERE status = 'aktiv' "
        "AND deleted_at IS NULL AND embedding_model IS DISTINCT FROM %s ORDER BY id LIMIT %s",
        (embedder.model, MAX_CATCH_UP),
    ).fetchall()
    texts = [embed_text(r[1], r[2] or [], r[3]) for r in stale]
    texts += [embed_text(x.name, x.proposal["aliases"], x.proposal["one_liner"]) for x in xs]
    if not texts:
        return out
    vectors: list[list[float] | None] = []
    try:
        if not embedder.wait_ready(search_index.WAIT_READY_S):
            raise EmbedderUnavailable(
                embedder.error()
                or ("Worker wird beendet" if embedders.SHUTDOWN.is_set() else None)
                or f"Embedder nach {int(search_index.WAIT_READY_S)} s nicht bereit"
            )
        for i in range(0, len(texts), search_index.EMBED_BATCH):
            batch = texts[i : i + search_index.EMBED_BATCH]
            embedders.ENDPOINT_PRIORITY.wait_idle()  # Suchanfragen gehen vor (§19.2)
            if embedders.SHUTDOWN.is_set():
                raise EmbedderUnavailable("Worker wird beendet")
            got = embedder.embed(batch)
            if len(got) != len(batch):
                raise RuntimeError("Embedder lieferte eine falsche Anzahl Vektoren")
            vectors += [search_index._valid_vector(v, embedder.dim) for v in got]
    except (EmbedderNotReady, EmbedderUnavailable) as exc:
        reason = str(exc) or embedder.error() or "Embedder nicht verfügbar"
        return Vectors(model=None, current=embedder.model, error=safe_error(reason)[:500])
    for row, vec in zip(stale, vectors[: len(stale)], strict=True):
        if vec is not None:
            out.catch_up[row[0]] = (vec, row[4])
    for x, vec in zip(xs, vectors[len(stale) :], strict=True):
        if vec is not None:
            out.by_key[x.key] = vec
    return out


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    norm = math.sqrt(sum(map(mul, a, a)) * sum(map(mul, b, b)))
    return sum(map(mul, a, b)) / norm if norm > 0 else 0.0


def nearest(conn: Conn, vectors: Vectors, vector: Sequence[float]) -> list[tuple[uuid.UUID, float]]:
    """Die ähnlichsten aktiven Konzepte (höchstens 20), exakt gerechnet. Nachgeholte Vektoren
    stehen noch nicht in der Datenbank (§20.3 Schritt 7) und werden hier dazugerechnet."""
    found = {
        r[0]: float(r[1])
        for r in conn.execute(
            NEAREST_SQL, (search_index.vector_literal(vector), vectors.current, NEIGHBORS)
        ).fetchall()
    }
    for cid, (vec, _) in vectors.catch_up.items():
        found[cid] = cosine(vector, vec)
    ranked = sorted(
        ((cid, sim) for cid, sim in found.items() if math.isfinite(sim)),
        key=lambda pair: (-pair[1], pair[0]),
    )
    return ranked[:NEIGHBORS]


# ---------- Zuordnen (§20.3 Schritt 5) ----------


def _similarity(value: float) -> float:
    return round(min(max(value, 0.0), 1.0), 6)


def plan(
    xs: Sequence[Extracted],
    state: State,
    near: Mapping[str, Sequence[tuple[uuid.UUID, float]]],
    known: Mapping[uuid.UUID, Known],
    verdicts: Mapping[tuple[str, uuid.UUID], Verdict],
    *,
    degraded: bool,
    actives: Sequence[tuple[uuid.UUID, Labels]] = (),
    gone: frozenset[uuid.UUID] = frozenset(),
) -> list[Assignment]:
    """Ordnet jedes extrahierte Konzept zu. Reine Funktion: läuft einmal vor dem KI-Aufruf (ohne
    Entscheidungen, um die Paare zu finden) und noch einmal unter den Sperren."""
    result: list[Assignment] = []
    for x in xs:
        if any(same_name(x.labels, own) for own in state.rejected):
            result.append(Assignment(x, "rejected"))
            continue
        earlier = next(
            (cid for cid, own in (*state.accepted, *state.preserved) if same_name(x.labels, own)),
            None,
        )
        if earlier is not None:
            result.append(Assignment(x, "attach", target=earlier))
            continue
        if degraded:
            # Nie automatisch: Homonyme in verschiedenen Fächern. Namensgleiche zuerst.
            hits = sorted(
                (not same_name(x.labels, own), cid)
                for cid, own in actives
                if cid not in gone and similar_name(x.labels, own)
            )
            if hits:
                result.append(Assignment(x, "merge", target=hits[0][1], basis="name"))
            else:
                result.append(Assignment(x, "new"))
            continue
        candidates = [
            (cid, sim)
            for cid, sim in list(near.get(x.key, ()))[:TOP_K]
            if sim >= SIM_MIN and cid in known and cid not in gone
        ]
        automatic = next(
            (
                (cid, sim)
                for cid, sim in candidates
                if sim >= SIM_AUTO and similar_name(x.labels, known[cid].labels)
            ),
            None,
        )
        if automatic is not None:
            result.append(
                Assignment(x, "attach", target=automatic[0], similarity=_similarity(automatic[1]))
            )
            continue
        entry = Assignment(x, "new", asked=[cid for cid, _ in candidates])
        same: list[tuple[uuid.UUID, float, Verdict]] = []
        for cid, sim in candidates:
            verdict = verdicts.get((x.key, cid))
            if len(entry.similar) < MAX_SIMILAR:
                entry.similar.append(
                    {
                        "concept_id": str(cid),
                        "name": known[cid].name,
                        "similarity": _similarity(sim),
                        "verdict": None if verdict is None else verdict.verdict,
                    }
                )
            if verdict is None:
                continue
            if verdict.verdict == "gleich":
                same.append((cid, sim, verdict))
            elif verdict.verdict in ("teil_von", "verwandt") and verdict.reason:
                entry.related.append((cid, verdict.reason, verdict.confidence))
        if same:  # der ähnlichste Kandidat mit `gleich`
            cid, sim, verdict = same[0]
            entry.mode = "merge"
            entry.target = cid
            entry.basis = "ki"
            entry.similarity = _similarity(sim)
            entry.reason = verdict.reason
            entry.confidence = verdict.confidence
        result.append(entry)
    for entry in result:
        if entry.mode in ("new", "merge"):
            entry.concept_id = uuid7()
    return result


# ---------- KI-Aufruf (§20.3 Schritt 6) ----------


@cache
def system_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


@dataclass
class Question:
    """Was die KI entscheiden soll: Paare im Band und Nachbarn für Beziehungen."""

    pairs: list[tuple[Extracted, uuid.UUID]] = field(default_factory=list)
    neighbors: list[tuple[Extracted, list[uuid.UUID]]] = field(default_factory=list)
    refs: dict[uuid.UUID, str] = field(default_factory=dict)

    @property
    def empty(self) -> bool:
        return not self.pairs and not self.neighbors

    def ref(self, cid: uuid.UUID) -> str:
        return self.refs.setdefault(cid, f"k{len(self.refs) + 1}")


def build_question(
    assignments: Sequence[Assignment],
    near: Mapping[str, Sequence[tuple[uuid.UUID, float]]],
    known: Mapping[uuid.UUID, Known],
) -> Question:
    question = Question()
    for entry in assignments:
        if entry.mode in ("new", "merge"):
            for cid in entry.asked:
                question.ref(cid)
                question.pairs.append((entry.x, cid))
    budget = MAX_NEIGHBOR_PAIRS
    for entry in assignments:
        if entry.mode not in ("new", "merge") or budget <= 0:
            continue
        ids = [cid for cid, _ in list(near.get(entry.x.key, ()))[:NEIGHBORS] if cid in known]
        ids = ids[:budget]
        if ids:
            budget -= len(ids)
            for cid in ids:
                question.ref(cid)
            question.neighbors.append((entry.x, ids))
    return question


def _block(
    tag: str, ref: str, name: str, aliases: Sequence[str], one_liner: str | None
) -> list[str]:
    lines = [f'<{tag} ref="{ref}">', f"Name: {esc(normalize_name(name))}"]
    shown = [a for a in (normalize_name(x) for x in aliases) if a]
    if shown:
        lines.append("Aliase: " + esc(", ".join(shown)))
    if one_liner and normalize_name(one_liner):
        lines.append(f"Erklärung: {esc(normalize_name(one_liner))}")
    return lines


def build_material(
    question: Question, known: Mapping[uuid.UUID, Known], module: str | None, lang: str | None
) -> str:
    """Eingabe des Aufrufs (deterministisch). Alles Material in Tags, spitze Klammern maskiert."""
    lines = ["<kopf>", f"Fach der Vorlesung: {esc(normalize_name(module or '')) or 'unbekannt'}"]
    lines.append("</kopf>")
    seen: set[str] = set()
    for x in [x for x, _ in question.pairs] + [x for x, _ in question.neighbors]:
        if x.key in seen:
            continue
        seen.add(x.key)
        lines += _block("neu", x.key, x.name, x.proposal["aliases"], x.proposal["one_liner"])
        lines.append("</neu>")
    for cid, ref in question.refs.items():
        concept = known[cid]
        lines += _block("vorhanden", ref, concept.name, concept.aliases, concept.one_liner)
        if concept.modules:
            lines.append("Fach: " + esc(", ".join(normalize_name(m) for m in concept.modules)))
        lines.append("</vorhanden>")
    if question.pairs:
        lines.append("Entscheide diese Paare:")
        lines += [
            f'<paar neu="{x.key}" vorhanden="{question.refs[cid]}"/>' for x, cid in question.pairs
        ]
    if question.neighbors:
        lines.append("Prüfe Beziehungen zu diesen Nachbarn:")
        lines += [
            f'<nachbarn neu="{x.key}" vorhanden="{" ".join(question.refs[c] for c in ids)}"/>'
            for x, ids in question.neighbors
        ]
    lines.append(f"Ausgabesprache: {LANG_NAMES.get(lang or '', 'die Sprache der Konzepte')}")
    return "\n".join(lines)


NO_DECISION = (
    "Zu keinem der verlangten Paare gab es eine Entscheidung. Gib für jedes <paar> genau eine "
    "Entscheidung mit den refs aus dem Material ab (concept = c…, candidate = k…)."
)


def read_output(
    output: ConceptsResolveOutput, question: Question
) -> tuple[
    dict[tuple[str, uuid.UUID], Verdict], list[tuple[str, uuid.UUID, bool, str, str, float]]
]:
    """Geprüfte Entscheidungen je Paar und Beziehungen `(Schlüssel, Nachbar, vom Schlüssel aus?,
    Art, Begründung, Konfidenz)`. Unbekannte refs und nicht verlangte Paare fallen weg, ebenso
    Beziehungen zu einem Kandidaten, den die KI als `verschieden` (§20.3 Schritt 5: keine
    Beziehung) oder `gleich` (Ziel der Zusammenführung bzw. weiteres `gleich`) entschieden hat."""
    by_ref = {ref: cid for cid, ref in question.refs.items()}
    asked = {(x.key, cid) for x, cid in question.pairs}
    verdicts: dict[tuple[str, uuid.UUID], Verdict] = {}
    for d in output.decisions:
        cid = by_ref.get(d.candidate.strip())
        pair = (d.concept.strip(), cid)
        if cid is None or pair not in asked or pair in verdicts:
            continue
        verdicts[(pair[0], cid)] = Verdict(
            d.verdict, shorten(d.reason, MAX_REASON), unit(d.confidence)
        )
    allowed = {(x.key, cid) for x, ids in question.neighbors for cid in ids}
    relations: list[tuple[str, uuid.UUID, bool, str, str, float]] = []
    for r in output.relations:
        a, b = r.from_ref.strip(), r.to_ref.strip()
        forward = b in by_ref
        key, cid = (a, by_ref.get(b)) if forward else (b, by_ref.get(a))
        why = shorten(r.why, MAX_WHY)
        if cid is None or (key, cid) not in allowed or why is None:
            continue
        verdict = verdicts.get((key, cid))
        if verdict is not None and verdict.verdict in ("gleich", "verschieden"):
            continue
        if len(relations) >= MAX_KI_RELATIONS:
            break
        relations.append((key, cid, forward, r.kind, why, unit(r.confidence)))
    return verdicts, relations


def _fake(question: Question, known: Mapping[uuid.UUID, Known]) -> ConceptsResolveOutput:
    return llm_fake.concepts_resolve(
        [
            llm_fake.FakePair(
                x.key, question.refs[cid], name_base(x.name), name_base(known[cid].name)
            )
            for x, cid in question.pairs
        ]
    )


# ---------- Ergebnis ----------


def _result(sid: uuid.UUID, payload: ConceptsResolvePayload, **values: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "session_id": str(sid),
        "extract_job_id": payload.extract_job_id,
        "extract_input_hash": None,
        "resolve_version": RESOLVE_VERSION,
        "session_deleted": False,
        "unchanged": False,
        "auto_merged": 0,
        "proposed_new": 0,
        "proposed_merge": 0,
        "proposed_relations": 0,
        "auto_accepted": 0,
        "skipped_rejected": 0,
        "dropped_cycles": 0,
        "embedded_concepts": 0,
        "embedding_model": None,
        "embedding_error": None,
        "prompt_version": None,
        "model": None,
        "cost_eur": 0.0,
    }
    base.update(values)
    return ConceptsResolveResult.model_validate(base).model_dump(mode="json", by_alias=True)


def _finish(ctx: JobContext, result: dict[str, Any]) -> dict[str, Any]:
    ctx.finish(result)
    if not ctx.lock_ok:
        raise LockLostError(ctx.job_id)
    return result


# ---------- Schreiben (§20.3 Schritt 7) ----------


def _insert_evidence(
    conn: Conn,
    user_id: Any,
    concept_id: uuid.UUID,
    sid: uuid.UUID,
    job_id: uuid.UUID,
    refs: Sequence[Mapping[str, Any]],
    *,
    auto: bool,
) -> None:
    for ref in refs:
        slide = ref["kind"] == "slide"
        conn.execute(
            "INSERT INTO evidence (id, user_id, concept_id, session_id, kind, ref_id, t_start_ms, "
            "t_end_ms, auto, job_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT DO NOTHING",
            (
                uuid7(),
                user_id,
                concept_id,
                sid,
                ref["kind"],
                uuid.UUID(ref["slide_id"]) if slide else sid,
                None if slide else ref["t_start_ms"],
                None if slide else ref["t_end_ms"],
                auto,
                job_id,
            ),
        )


def _insert_module(conn: Conn, user_id: Any, concept_id: uuid.UUID, module_id: Any) -> None:
    if module_id is None:
        return
    conn.execute(
        "INSERT INTO concept_module (id, user_id, concept_id, module_id) VALUES (%s, %s, %s, %s) "
        "ON CONFLICT DO NOTHING",
        (uuid7(), user_id, concept_id, module_id),
    )


def _insert_item(
    conn: Conn,
    user_id: Any,
    sid: uuid.UUID,
    job_id: uuid.UUID,
    payload: dict[str, Any],
    priority: int,
    *,
    concept_id: uuid.UUID | None = None,
    target: uuid.UUID | None = None,
    relation_id: uuid.UUID | None = None,
) -> uuid.UUID:
    item_id = uuid7()
    conn.execute(
        "INSERT INTO inbox_item (id, user_id, kind, session_id, job_id, payload, priority, "
        "concept_id, target_concept_id, relation_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            item_id,
            user_id,
            payload["kind"],
            sid,
            job_id,
            Jsonb(payload),
            priority,
            concept_id,
            target,
            relation_id,
        ),
    )
    return item_id


def _priority(x: Extracted) -> int:
    """`100 * (3 - importance) + Position im Extrakt` (kleiner = früher)."""
    return 100 * (3 - int(x.proposal["importance"])) + x.pos


def relation_specs(
    assignments: Sequence[Assignment],
    extract_relations: Sequence[Mapping[str, Any]],
    ki_relations: Sequence[tuple[str, uuid.UUID, bool, str, str, float]],
    extract_meta: tuple[str, str],
    resolve_meta: tuple[str, str] | None,
    gone: frozenset[uuid.UUID],
) -> list[RelationSpec]:
    """Beziehungen in der Reihenfolge der Inbox: aus dem Extrakt (Schlüssel auf die Konzepte
    nach der Zuordnung abgebildet), aus den Entscheidungen (`teil_von`/`verwandt`), von der KI zu
    Nachbarn."""
    by_key = {entry.x.key: entry for entry in assignments}
    specs: list[RelationSpec] = []
    for rel in extract_relations:
        a, b = by_key.get(rel["from"]), by_key.get(rel["to"])
        if a is None or b is None or a.lands_on is None or b.lands_on is None:
            continue
        specs.append(
            RelationSpec(
                a.lands_on, b.lands_on, rel["kind"], rel["why"], rel["confidence"], *extract_meta
            )
        )
    if resolve_meta is None:
        return specs
    for entry in assignments:
        if entry.concept_id is None:
            continue
        for cid, why, confidence in entry.related:
            if cid != entry.target:
                specs.append(
                    RelationSpec(entry.concept_id, cid, "verwandt", why, confidence, *resolve_meta)
                )
    for key, cid, forward, kind, why, confidence in ki_relations:
        owner = by_key.get(key)
        if owner is None or owner.concept_id is None or cid in gone or cid == owner.target:
            continue
        ends = (owner.concept_id, cid) if forward else (cid, owner.concept_id)
        specs.append(RelationSpec(*ends, kind, why, confidence, *resolve_meta))
    return specs


@dataclass
class Written:
    """Einträge dieses Laufs für die Automatik, in der Reihenfolge der Inbox."""

    concepts: list[tuple[uuid.UUID, Assignment]] = field(default_factory=list)
    relations: list[tuple[uuid.UUID, RelationSpec]] = field(default_factory=list)


def _automatic(conn: Conn, written: Written) -> None:
    """Automatisch annehmen nach `ai.auto_accept` (§20.7) mit den Regeln aus §20.6. Scheitert
    eine Annahme (Namenskonflikt, Kreis, Endpunkt offen), bleibt der Eintrag `offen`."""
    mode = accept.auto_accept_mode(conn)
    if mode == "aus":
        return
    if mode == "alles_ab_0_9":
        for item_id, entry in written.concepts:
            try:
                if entry.mode == "new" and accept.confident(entry.x.proposal["confidence"]):
                    try:
                        accept.accept_item(conn, item_id, auto_accept=mode)
                    except accept.AcceptError as exc:
                        if exc.code != "concept_exists":
                            raise
                        # §20.6 A1: Die Automatik nimmt A2 mit dem namensgleichen Konzept
                        target = uuid.UUID(exc.details["concept_id"])
                        accept.accept_item(conn, item_id, auto_accept=mode, merge_into=target)
                elif (
                    entry.mode == "merge"
                    and entry.basis == "ki"
                    and accept.confident(entry.confidence)
                ):
                    accept.accept_item(conn, item_id, auto_accept=mode)
            except accept.AcceptError:
                continue
    for item_id, spec in written.relations:
        if mode == "alles_ab_0_9" and not accept.confident(spec.confidence):
            continue
        try:
            accept.accept_item(conn, item_id, auto_accept=mode)
        except accept.AcceptError:
            continue


def _write(
    ctx: JobContext,
    sid: uuid.UUID,
    xs: Sequence[Extracted],
    vectors: Vectors,
    near: Mapping[str, Sequence[tuple[uuid.UUID, float]]],
    known: Mapping[uuid.UUID, Known],
    verdicts: Mapping[tuple[str, uuid.UUID], Verdict],
    extract_relations: Sequence[Mapping[str, Any]],
    ki_relations: Sequence[tuple[str, uuid.UUID, bool, str, str, float]],
    extract_meta: tuple[str, str],
    resolve_meta: tuple[str, str] | None,
) -> Counts:
    """Alles unter den Sperren (die Session ist schon gesperrt)."""
    conn = ctx.conn
    job_id = uuid.UUID(ctx.job_id)
    degraded = vectors.model is None
    accept.lock_graph(conn)
    row = conn.execute("SELECT user_id, module_id FROM session WHERE id = %s", (sid,)).fetchone()
    assert row is not None
    user_id, module_id = row
    state = load_state(conn, sid)  # erneut prüfen: Die Inbox kann sich geändert haben
    actives = load_actives(conn) if degraded else []
    gone: frozenset[uuid.UUID] = frozenset()
    for _ in range(5):
        assignments = plan(
            xs, state, near, known, verdicts, degraded=degraded, actives=actives, gone=gone
        )
        specs = relation_specs(
            assignments, extract_relations, ki_relations, extract_meta, resolve_meta, gone
        )
        own = {e.concept_id for e in assignments if e.concept_id is not None}
        trusted = {cid for cid, _ in state.preserved}
        existing = {e.target for e in assignments if e.target is not None}
        existing |= {cid for s in specs for cid in (s.from_id, s.to_id)} - own
        lock_ids = existing | trusted | set(state.deletable) | set(vectors.catch_up)
        rows = conn.execute(
            "SELECT id, status, deleted_at IS NULL FROM concept WHERE id = ANY(%s) ORDER BY id "
            "FOR NO KEY UPDATE",
            (sorted(lock_ids),),
        ).fetchall()
        active = {r[0] for r in rows if r[1] == "aktiv" and r[2]}
        stale = frozenset(existing - trusted - active)
        if not stale:
            break
        # Inzwischen nicht mehr aktiv: wie „kein Kandidat“
        gone |= stale
    else:
        raise RuntimeError("Wissensnetz änderte sich während des Abgleichs")

    counts = Counts()
    for cid, (vec, updated_at) in vectors.catch_up.items():
        done = conn.execute(
            "UPDATE concept SET embedding = %s::vector, embedding_model = %s WHERE id = %s "
            "AND updated_at = %s AND status = 'aktiv' AND deleted_at IS NULL",
            (search_index.vector_literal(vec), vectors.current, cid, updated_at),
        )
        counts.embedded_concepts += done.rowcount

    # Eigene frühere Ergebnisse dieser Session entfernen (hart), nur gänzlich offene
    if state.deletable:
        conn.execute("DELETE FROM concept WHERE id = ANY(%s)", (state.deletable,))
    conn.execute(
        "DELETE FROM concept_relation r WHERE r.proposal_session_id = %s AND NOT r.confirmed "
        "AND NOT EXISTS (SELECT 1 FROM inbox_item i WHERE i.relation_id = r.id "
        "AND i.status <> 'offen')",
        (sid,),
    )
    conn.execute("DELETE FROM evidence WHERE auto AND session_id = %s", (sid,))

    written = Written()
    for entry in assignments:
        x = entry.x
        if entry.mode == "rejected":
            counts.skipped_rejected += 1
            continue
        if entry.mode == "attach":
            assert entry.target is not None
            counts.auto_merged += 1
            _insert_evidence(conn, user_id, entry.target, sid, job_id, x.evidence, auto=True)
            _insert_module(conn, user_id, entry.target, module_id)
            continue
        assert entry.concept_id is not None
        vector = vectors.by_key.get(x.key)
        conn.execute(
            "INSERT INTO concept (id, user_id, name, aliases, kind, one_liner, status, "
            "proposal_session_id, embedding, embedding_model) "
            "VALUES (%s, %s, %s, %s, %s, %s, 'vorschlag', %s, %s::vector, %s)",
            (
                entry.concept_id,
                user_id,
                x.name,
                x.proposal["aliases"],
                x.proposal["kind"],
                x.proposal["one_liner"],
                sid,
                None if vector is None else search_index.vector_literal(vector),
                None if vector is None else vectors.current,
            ),
        )
        _insert_module(conn, user_id, entry.concept_id, module_id)
        _insert_evidence(conn, user_id, entry.concept_id, sid, job_id, x.evidence, auto=False)
        payload: dict[str, Any] = {"proposal": x.proposal, "evidence": x.evidence}
        if entry.mode == "merge":
            assert entry.target is not None
            counts.proposed_merge += 1
            found = conn.execute(
                "SELECT name FROM concept WHERE id = %s", (entry.target,)
            ).fetchone()
            assert found is not None
            by_ki = entry.basis == "ki" and resolve_meta is not None
            payload |= {
                "kind": "concept_merge",
                "target": {"concept_id": str(entry.target), "name": found[0]},
                "basis": entry.basis,
                "similarity": entry.similarity,
                "reason": entry.reason,
                "prompt_version": resolve_meta[0] if by_ki and resolve_meta else None,
                "model": resolve_meta[1] if by_ki and resolve_meta else None,
            }
        else:
            counts.proposed_new += 1
            payload |= {
                "kind": "concept_new",
                "similar": entry.similar,
                "prompt_version": extract_meta[0],
                "model": extract_meta[1],
            }
        item_id = _insert_item(
            conn,
            user_id,
            sid,
            job_id,
            payload,
            _priority(x),
            concept_id=entry.concept_id,
            target=entry.target if entry.mode == "merge" else None,
        )
        written.concepts.append((item_id, entry))
    written.concepts.sort(key=lambda pair: _priority(pair[1].x))

    edges = confirmed_edges(conn)
    seen: set[tuple[uuid.UUID, uuid.UUID, str]] = set()
    for spec in specs:
        from_id, to_id = accept.sort_symmetric(spec.kind, spec.from_id, spec.to_id)
        ident = (from_id, to_id, spec.kind)
        if from_id == to_id or ident in seen:
            continue
        seen.add(ident)
        # Auch gegen vorhandene Beziehungen: bestätigte, abgelehnte (bleiben unbestätigt liegen)
        # und Vorschläge anderer Sessions
        if conn.execute(
            "SELECT 1 FROM concept_relation WHERE from_id = %s AND to_id = %s AND kind = %s "
            "AND deleted_at IS NULL",
            ident,
        ).fetchone():
            continue
        if spec.kind == "baut_auf" and find_cycle(edges, from_id, to_id) is not None:
            counts.dropped_cycles += 1
            continue
        relation_id = uuid7()
        conn.execute(
            "INSERT INTO concept_relation (id, user_id, from_id, to_id, kind, source, confidence, "
            "confirmed, why, proposal_session_id, job_id) "
            "VALUES (%s, %s, %s, %s, %s, 'ki', %s, false, %s, %s, %s)",
            (
                relation_id,
                user_id,
                from_id,
                to_id,
                spec.kind,
                spec.confidence,
                spec.why,
                sid,
                job_id,
            ),
        )
        item_id = _insert_item(
            conn,
            user_id,
            sid,
            job_id,
            {
                "kind": "relation",
                "from_concept_id": str(from_id),
                "to_concept_id": str(to_id),
                "relation_kind": spec.kind,
                "why": spec.why,
                "confidence": spec.confidence,
                "prompt_version": spec.prompt_version,
                "model": spec.model,
            },
            1000 + counts.proposed_relations,
            relation_id=relation_id,
        )
        counts.proposed_relations += 1
        written.relations.append((item_id, spec))

    _automatic(conn, written)
    done_row = conn.execute(
        "SELECT count(*) FROM inbox_item WHERE job_id = %s AND status = 'automatisch'", (job_id,)
    ).fetchone()
    counts.auto_accepted = int(done_row[0]) if done_row else 0
    return counts


# ---------- Handler ----------


@handler(TASK, payload_type=ConceptsResolvePayload)
def concepts_resolve(payload: ConceptsResolvePayload, ctx: JobContext) -> dict[str, Any]:
    sid = uuid.UUID(payload.session_id)
    conn = ctx.conn
    llm_mod.require_configured()
    row = conn.execute(
        "SELECT s.user_id, s.deleted_at, m.name, m.lang FROM session s "
        "LEFT JOIN module m ON m.id = s.module_id WHERE s.id = %s",
        (sid,),
    ).fetchone()
    if row is None:
        raise NonRetryableError("Session unbekannt")
    user_id, deleted_at, module_name, lang = row
    if deleted_at is not None:
        with conn.transaction():
            progress.lock_session(conn, sid)
            return _finish(ctx, _result(sid, payload, session_deleted=True))
    extract = _extract(conn, payload, sid)
    digest = extract.input_hash
    if digest is not None and not payload.force:
        previous = _previous(conn, sid, ctx.job_id)
        if (
            previous is not None
            and previous.get("extract_input_hash") == digest
            and previous.get("resolve_version") == RESOLVE_VERSION
            # Ein degradierter Vorlauf bleibt nur stehen, solange der Embedder fehlt
            and not (_degraded_before(conn, sid, digest, ctx.job_id) and _embedder_ready())
        ):
            with conn.transaction():
                if not progress.lock_session(conn, sid):
                    return _finish(ctx, _result(sid, payload, session_deleted=True))
                return _finish(
                    ctx, _result(sid, payload, extract_input_hash=digest, unchanged=True)
                )

    xs, extract_relations = _extracted(extract)
    vectors = embed_all(conn, xs)
    degraded = vectors.model is None
    near: dict[str, list[tuple[uuid.UUID, float]]] = {}
    if not degraded:
        for x in xs:
            vector = vectors.by_key.get(x.key)
            if vector is not None:
                near[x.key] = nearest(conn, vectors, vector)
    known = load_known(conn, sorted({cid for found in near.values() for cid, _ in found}))

    # Erste Zuordnung ohne Entscheidungen: Welche Paare und Nachbarn gehen an die KI?
    first = plan(
        xs,
        load_state(conn, sid),
        near,
        known,
        {},
        degraded=degraded,
        actives=load_actives(conn) if degraded else [],
    )
    question = build_question(first, near, known)
    meter = CostMeter(conn, user_id=user_id, job_id=ctx.job_id, session_id=str(sid), task=TASK)
    verdicts: dict[tuple[str, uuid.UUID], Verdict] = {}
    ki_relations: list[tuple[str, uuid.UUID, bool, str, str, float]] = []
    resolve_meta: tuple[str, str] | None = None
    if not question.empty:
        llm = llm_mod.get_llm()

        def usable(out: ConceptsResolveOutput) -> str | None:
            if question.pairs and not read_output(out, question)[0]:
                return NO_DECISION
            return None

        request = StructuredRequest(
            task=TASK,
            tier=TIER,
            prompt_version=CONCEPTS_RESOLVE_PROMPT,
            system=system_prompt(),
            material=build_material(question, known, module_name, lang),
            output=ConceptsResolveOutput,
            effort=EFFORT,
            max_tokens=MAX_TOKENS,
            stream=False,
            check=usable,
            fake=partial(_fake, question, known),
        )
        with llm_mod.job_errors(ctx):
            answer = llm.structured(request, meter)
        verdicts, ki_relations = read_output(answer.parsed, question)
        resolve_meta = (CONCEPTS_RESOLVE_PROMPT, answer.model)

    extract_meta = (extract.prompt_version or "concepts.extract/v1", extract.model or "unbekannt")
    cost = round(meter.total_eur, 6)
    with conn.transaction():
        if not progress.lock_session(conn, sid):
            return _finish(ctx, _result(sid, payload, session_deleted=True, cost_eur=cost))
        counts = _write(
            ctx, sid, xs, vectors, near, known, verdicts, extract_relations, ki_relations,
            extract_meta, resolve_meta,
        )  # fmt: skip
        ctx.logger.info(
            "Konzepte abgeglichen",
            extra={
                "auto_merged": counts.auto_merged,
                "proposed_new": counts.proposed_new,
                "proposed_merge": counts.proposed_merge,
                "proposed_relations": counts.proposed_relations,
                "auto_accepted": counts.auto_accepted,
            },
        )
        return _finish(
            ctx,
            _result(
                sid,
                payload,
                extract_input_hash=digest,
                auto_merged=counts.auto_merged,
                proposed_new=counts.proposed_new,
                proposed_merge=counts.proposed_merge,
                proposed_relations=counts.proposed_relations,
                auto_accepted=counts.auto_accepted,
                skipped_rejected=counts.skipped_rejected,
                dropped_cycles=counts.dropped_cycles,
                embedded_concepts=counts.embedded_concepts,
                embedding_model=vectors.model,
                embedding_error=vectors.error,
                prompt_version=None if resolve_meta is None else resolve_meta[0],
                model=None if resolve_meta is None else resolve_meta[1],
                cost_eur=cost,
            ),
        )
