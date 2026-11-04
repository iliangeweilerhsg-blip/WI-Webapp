#!/usr/bin/env python3
"""Prüfskript für die ICS-Testdaten (T1-01, F-KAL-01 / F-KAL-02).

Liest jede *.ics-Datei in diesem Verzeichnis mit `icalendar` und
`recurring-ical-events`, löst Serien im angegebenen Zeitraum auf und
vergleicht die berechneten Einzeltermine exakt mit der zugehörigen
*.json-Erwartungsdatei sowie `11-abgleich-erwartung.json`.

Ausführung (ohne Projektabhängigkeiten):
    uv run --python 3.12 --with icalendar --with recurring-ical-events python tests/fixtures/ics/pruefen.py
"""

from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import icalendar
import recurring_ical_events

FIXTURES_DIR = Path(__file__).resolve().parent
ZURICH = ZoneInfo("Europe/Zurich")
UTC = datetime.timezone.utc

ERLAUBTE_KINDS = {
    "vorlesung",
    "uebung",
    "tutorium",
    "pruefung",
    "fest",
    "lernblock_export",
    None,
}

PFLICHTFELDER_TERMIN = {
    "external_uid",
    "recurrence_id",
    "title",
    "location",
    "starts_at",
    "ends_at",
    "all_day",
    "cancelled",
    "kind_erwartet",
    "modul_erwartet",
}


def to_utc_iso(dt_or_date: datetime.date | datetime.datetime) -> tuple[str, bool]:
    """Konvertiert datetime oder date nach UTC ISO-8601 (Suffix Z) und gibt (iso, all_day) zurück."""
    if isinstance(dt_or_date, datetime.datetime):
        dt_aware = dt_or_date.replace(tzinfo=ZURICH) if dt_or_date.tzinfo is None else dt_or_date
        dt_utc = dt_aware.astimezone(UTC)
        return dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), False
    dt_utc = datetime.datetime(
        dt_or_date.year, dt_or_date.month, dt_or_date.day, 0, 0, 0, tzinfo=UTC
    )
    return dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), True


def format_recurrence_id(rec_prop: object, is_recurring_uid: bool) -> str | None:
    """Formatiert RECURRENCE-ID für wiederkehrende Serien als ISO-String oder None bei Einzelterminen."""
    if not is_recurring_uid or rec_prop is None:
        return None
    dt = getattr(rec_prop, "dt", None)
    if dt is None:
        return None
    if isinstance(dt, datetime.datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZURICH)
        return dt.isoformat()
    return dt.isoformat()


def resolve_ics(ics_path: Path, von_iso: str, bis_iso: str) -> list[dict]:
    """Parst eine ICS-Datei und löst alle Termine im Zeitraum [von_iso, bis_iso] auf."""
    raw = ics_path.read_bytes()
    cal = icalendar.Calendar.from_ical(raw)

    recurring_uids: set[str] = set()
    for comp in cal.walk("VEVENT"):
        uid = str(comp.get("UID"))
        if any(comp.get(k) is not None for k in ("RRULE", "RDATE", "EXDATE", "RECURRENCE-ID")):
            recurring_uids.add(uid)

    von_date = datetime.date.fromisoformat(von_iso)
    bis_date = datetime.date.fromisoformat(bis_iso)
    bis_exclusive = bis_date + datetime.timedelta(days=1)

    events = recurring_ical_events.of(cal, keep_recurrence_attributes=True).between(
        von_date, bis_exclusive
    )

    resolved: list[dict] = []
    for ev in events:
        uid = str(ev.get("UID"))
        starts_at, all_day = to_utc_iso(ev.get("DTSTART").dt)
        ends_at, _ = to_utc_iso(ev.get("DTEND").dt)
        rec_id = format_recurrence_id(ev.get("RECURRENCE-ID"), uid in recurring_uids)
        title = str(ev.get("SUMMARY")) if ev.get("SUMMARY") is not None else ""
        loc = str(ev.get("LOCATION")) if ev.get("LOCATION") is not None else None
        status = str(ev.get("STATUS", "")).upper()
        cancelled = status == "CANCELLED"

        resolved.append(
            {
                "external_uid": uid,
                "recurrence_id": rec_id,
                "title": title,
                "location": loc,
                "starts_at": starts_at,
                "ends_at": ends_at,
                "all_day": all_day,
                "cancelled": cancelled,
            }
        )

    resolved.sort(key=lambda t: (t["starts_at"], t["external_uid"], t["recurrence_id"] or ""))
    return resolved


def check_abgleich(
    vorher_termine: list[dict], nachher_termine: list[dict], abgleich_path: Path
) -> list[str]:
    """Prüft 11-abgleich-erwartung.json gegen die aufgelösten Termine aus 11a und 11b."""
    errors: list[str] = []
    if not abgleich_path.exists():
        return [f"Fehlende Datei: {abgleich_path.name}"]

    erwartet = json.loads(abgleich_path.read_text(encoding="utf-8"))
    vorher_map = {(t["external_uid"], t["recurrence_id"]): t for t in vorher_termine}
    nachher_map = {(t["external_uid"], t["recurrence_id"]): t for t in nachher_termine}

    geaendert = []
    entfallen = []
    neu = []

    for key, t_vor in vorher_map.items():
        if key not in nachher_map:
            entfallen.append({"external_uid": key[0], "recurrence_id": key[1]})
        else:
            t_nach = nachher_map[key]
            if t_nach["cancelled"] and not t_vor["cancelled"]:
                entfallen.append({"external_uid": key[0], "recurrence_id": key[1]})
            elif (
                t_vor["starts_at"] != t_nach["starts_at"]
                or t_vor["ends_at"] != t_nach["ends_at"]
                or t_vor["title"] != t_nach["title"]
                or t_vor["location"] != t_nach["location"]
            ):
                geaendert.append({"external_uid": key[0], "recurrence_id": key[1]})

    for key in nachher_map:
        if key not in vorher_map:
            neu.append({"external_uid": key[0], "recurrence_id": key[1]})

    for feld, ist_liste in (("geaendert", geaendert), ("entfallen", entfallen), ("neu", neu)):
        soll_liste = erwartet.get(feld)
        if soll_liste != ist_liste:
            errors.append(
                f"{abgleich_path.name}: Feld '{feld}' weicht ab: erwartet={soll_liste}, berechnet={ist_liste}"
            )
    return errors


def main() -> int:
    ics_files = sorted(FIXTURES_DIR.glob("*.ics"))
    if not ics_files:
        print("FEHLER: Keine .ics-Dateien gefunden.", file=sys.stderr)
        return 1

    all_errors: list[str] = []
    resolved_cache: dict[str, list[dict]] = {}

    print(f"Prüfe {len(ics_files)} ICS-Dateien in {FIXTURES_DIR.relative_to(FIXTURES_DIR.parents[2])} ...\n")

    for ics_path in ics_files:
        json_path = ics_path.with_suffix(".json")
        file_errors: list[str] = []

        if not json_path.exists():
            all_errors.append(f"{ics_path.name}: Zugehörige JSON-Datei {json_path.name} fehlt.")
            continue

        data = json.loads(json_path.read_text(encoding="utf-8"))
        if data.get("datei") != ics_path.name:
            file_errors.append(
                f"Feld 'datei' ({data.get('datei')}) stimmt nicht mit Dateinamen ({ics_path.name}) überein."
            )
        if not isinstance(data.get("beschreibung"), str) or not data["beschreibung"].strip():
            file_errors.append("Feld 'beschreibung' fehlt oder ist leer.")

        zeitraum = data.get("zeitraum", {})
        von_iso = zeitraum.get("von")
        bis_iso = zeitraum.get("bis")
        if not von_iso or not bis_iso:
            file_errors.append("Feld 'zeitraum.von' oder 'zeitraum.bis' fehlt.")
            all_errors.extend(f"{ics_path.name}: {e}" for e in file_errors)
            continue

        ist_termine = resolve_ics(ics_path, von_iso, bis_iso)
        resolved_cache[ics_path.name] = ist_termine
        soll_termine = data.get("termine", [])

        # Prüfe Sortierung nach starts_at in JSON
        starts_list = [t.get("starts_at", "") for t in soll_termine]
        if starts_list != sorted(starts_list):
            file_errors.append("Termine in JSON sind nicht aufsteigend nach 'starts_at' sortiert.")

        if len(ist_termine) != len(soll_termine):
            file_errors.append(
                f"Anzahl Termine weicht ab: ICS ergibt {len(ist_termine)}, JSON enthält {len(soll_termine)}."
            )
        else:
            for idx, (ist, soll) in enumerate(zip(ist_termine, soll_termine)):
                fehlende_felder = PFLICHTFELDER_TERMIN - set(soll.keys())
                if fehlende_felder:
                    file_errors.append(f"Termin #{idx + 1}: Fehlende Felder {sorted(fehlende_felder)}")
                if soll.get("kind_erwartet") not in ERLAUBTE_KINDS:
                    file_errors.append(
                        f"Termin #{idx + 1}: Ungültiges kind_erwartet={soll.get('kind_erwartet')!r}"
                    )
                for k, v_ist in ist.items():
                    v_soll = soll.get(k)
                    if v_ist != v_soll:
                        file_errors.append(
                            f"Termin #{idx + 1} ({ist['external_uid']} @ {ist['starts_at']}): "
                            f"Feld '{k}' weicht ab (ICS={v_ist!r}, JSON={v_soll!r})"
                        )

        if file_errors:
            print(f"[FEHLER] {ics_path.name} ({len(file_errors)} Abweichung(en))")
            all_errors.extend(f"{ics_path.name}: {e}" for e in file_errors)
        else:
            print(f"[OK]     {ics_path.name:<38} -> {len(soll_termine):>2} Termin(e) verifiziert")

    # Zusatzprüfung für Fall 11 (Abgleich vorher/nachher)
    abgleich_path = FIXTURES_DIR / "11-abgleich-erwartung.json"
    if "11a-abgleich-vorher.ics" in resolved_cache and "11b-abgleich-nachher.ics" in resolved_cache:
        abgleich_errors = check_abgleich(
            resolved_cache["11a-abgleich-vorher.ics"],
            resolved_cache["11b-abgleich-nachher.ics"],
            abgleich_path,
        )
        if abgleich_errors:
            print(f"[FEHLER] {abgleich_path.name}")
            all_errors.extend(abgleich_errors)
        else:
            abgleich_json = json.loads(abgleich_path.read_text(encoding="utf-8"))
            print(
                f"[OK]     {abgleich_path.name:<38} -> "
                f"{len(abgleich_json['geaendert'])} geändert, "
                f"{len(abgleich_json['entfallen'])} entfallen, "
                f"{len(abgleich_json['neu'])} neu"
            )

    if all_errors:
        print("\nAbweichungen gefunden:", file=sys.stderr)
        for err in all_errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print("\nErgebnis: Alle 13 ICS-Dateien und 14 JSON-Erwartungsdateien (Fälle 1–11) sind konsistent (0 Abweichungen).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
