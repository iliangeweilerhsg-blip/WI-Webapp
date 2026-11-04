"""Contract-Tests (09 §6): Pydantic muss dieselben Beispiele wie JSON Schema und Zod akzeptieren bzw. ablehnen."""

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

import sg_schemas.models as models

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def _cases(kind: str) -> list[tuple[str, str, object]]:
    return [
        (f.name, f.name.split(".")[0], json.loads(f.read_text(encoding="utf-8")))
        for f in sorted((EXAMPLES / kind).glob("*.json"))
    ]


@pytest.mark.parametrize(("name", "type_name", "data"), _cases("valid"))
def test_valid(name: str, type_name: str, data: object) -> None:
    TypeAdapter(getattr(models, type_name)).validate_python(data)


@pytest.mark.parametrize(("name", "type_name", "data"), _cases("invalid"))
def test_invalid(name: str, type_name: str, data: object) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(getattr(models, type_name)).validate_python(data)


# Referenz-Striche aus tests/fixtures/strokes (08 §4, PR #39): jeder Strich muss ein gültiger Stroke sein
STROKES = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "strokes"
STROKE_FILES = sorted(STROKES.glob("[0-9][0-9]-*.json"))


def test_stroke_fixtures_present() -> None:
    assert len(STROKE_FILES) >= 7


@pytest.mark.parametrize("path", STROKE_FILES, ids=lambda p: p.name)
def test_stroke_fixtures(path: Path) -> None:
    adapter = TypeAdapter(list[models.Stroke])
    adapter.validate_python(json.loads(path.read_text(encoding="utf-8")))
