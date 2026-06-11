#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build chunked upsert SQL for the completed BBMP street register.

Inputs:
  tmp/bbmp-uav-register.json          — deterministic parse (parse-bbmp-uav-register.py)
  tmp/bbmp-uav-visual-fixups.json     — optional; from the visual workflow:
      { "aro_names": {"<page>": "ARO NAME", ...},
        "extra_rows": [{page, sl, ward, street, zone, aro}, ...],   # the 32 glyph pages
        "zone_fixes": {"<page>": "A".."F", ...} }                   # zone for top rows

Output: tmp/sql/bbmp_register_<nnn>.sql — batched INSERT ... ON CONFLICT upserts
        (the unique key is (lower(street_name_en), ward_no, page_number)), plus
        tmp/sql/bbmp_register_000_prelude.sql which retires the legacy partial
        rows in the non-residential page range (they lack provenance and are
        superseded by the deterministic re-parse).

Apply order: 000 prelude, then 001..NNN (any client; idempotent).
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

TMP = Path(__file__).resolve().parent.parent / "tmp"
OUT = TMP / "sql"
ROWS_FILE = TMP / "bbmp-uav-register.json"
FIXUPS_FILE = TMP / "bbmp-uav-visual-fixups.json"
SOURCE_DOC = "BBMP Guidance Value Notification No. 384 (09-Mar-2016)"
CHUNK = 2500


def esc(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def num(v) -> str:
    return "NULL" if v is None else str(int(v))


def main() -> int:
    rows = json.loads(ROWS_FILE.read_text(encoding="utf-8"))
    fixups = {"aro_names": {}, "extra_rows": [], "zone_fixes": {}}
    if FIXUPS_FILE.exists():
        fixups.update(json.loads(FIXUPS_FILE.read_text(encoding="utf-8")))

    aro_names = {int(k): v for k, v in fixups.get("aro_names", {}).items()}
    zone_fixes = {int(k): v for k, v in fixups.get("zone_fixes", {}).items()}

    # 1. apply fixups to the deterministic rows
    for r in rows:
        pg = r["page_number"]
        if r.get("aro_inherited") and pg in aro_names:
            r["aro_section"] = aro_names[pg]
        if not r.get("zone_code") and pg in zone_fixes and zone_fixes[pg] in "ABCDEF":
            r["zone_code"] = zone_fixes[pg]

    # 2. fold in the visually-extracted pages (glyph-substituted layouts)
    for er in fixups.get("extra_rows", []):
        street = str(er.get("street", "")).strip().upper()
        ward = er.get("ward")
        pg = er.get("page")
        if not street or ward is None or pg is None:
            continue
        zone = (er.get("zone") or "").strip().upper() or None
        if zone not in (None, "A", "B", "C", "D", "E", "F"):
            zone = None
        rows.append({
            "street_name_en": street[:300],
            "ward_no": int(ward),
            "page_number": int(pg),
            "aro_section": (er.get("aro") or aro_names.get(int(pg)) or None),
            "register": "residential" if int(pg) <= 362 else "non_residential",
            "zone_code": zone,
            "band_label": None,
            "band_min_inr": None,
            "band_max_inr": None,
            "sl_no": er.get("sl"),
            "row_excerpt": f"{er.get('sl', '?')} {ward} {street[:130]} [visual extraction]",
            "visual": True,
        })

    # 3. dedupe on the unique key, preferring rows WITH a zone
    best: dict[tuple, dict] = {}
    for r in rows:
        key = (r["street_name_en"].lower(), r["ward_no"], r["page_number"])
        cur = best.get(key)
        if cur is None or (not cur.get("zone_code") and r.get("zone_code")):
            best[key] = r
    final = list(best.values())
    final.sort(key=lambda r: (r["page_number"], r.get("sl_no") or 0))

    # Emit the final merged rows as one JSON so the Node loader
    # (scripts/seed-bbmp-uav-register.js) can bulk-upsert via the same pg pool
    # the API uses — no need to shuttle large SQL strings through tool calls.
    (TMP / "bbmp-uav-register-final.json").write_text(
        json.dumps([{
            "street_name_en": r["street_name_en"],
            "ward_no": r["ward_no"],
            "page_number": r["page_number"],
            "aro_section": r.get("aro_section"),
            "register": r.get("register"),
            "zone_code": r.get("zone_code"),
            "band_min_inr": r.get("band_min_inr"),
            "band_max_inr": r.get("band_max_inr"),
            "row_excerpt": (r.get("row_excerpt") or "")[:160],
            "confidence_score": 0.85 if r.get("visual") else 0.95,
        } for r in final], ensure_ascii=False), encoding="utf-8")

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("bbmp_register_*.sql"):
        old.unlink()

    # prelude: retire the legacy partial non-res rows (no provenance, superseded)
    (OUT / "bbmp_register_000_prelude.sql").write_text(
        "-- Retire the legacy partial rows in the non-residential page range.\n"
        "-- They came from the pypdf pipeline that could not read the shifted\n"
        "-- font (pages 363+), carry no aro_section, and are fully superseded\n"
        "-- by the deterministic re-parse loaded by the numbered chunks.\n"
        "DELETE FROM regulatory_data.bbmp_street_index WHERE page_number >= 363;\n",
        encoding="utf-8")

    n_chunks = 0
    for i in range(0, len(final), CHUNK):
        n_chunks += 1
        chunk = final[i:i + CHUNK]
        values = []
        for r in chunk:
            conf = "0.85" if r.get("visual") else "0.95"
            values.append(
                f"({esc(r['street_name_en'])},{num(r['ward_no'])},{num(r['page_number'])},"
                f"{esc(r.get('aro_section'))},{esc(r.get('register'))},{esc(r.get('zone_code'))},"
                f"{num(r.get('band_min_inr'))},{num(r.get('band_max_inr'))},"
                f"{esc((r.get('row_excerpt') or '')[:160])},{esc(SOURCE_DOC)},{conf})")
        sql = (
            "INSERT INTO regulatory_data.bbmp_street_index\n"
            "  (street_name_en, ward_no, page_number, aro_section, register, zone_code,\n"
            "   guidance_value_band_min_inr, guidance_value_band_max_inr,\n"
            "   row_excerpt, source_document, confidence_score)\n"
            "VALUES\n  " + ",\n  ".join(values) + "\n"
            "ON CONFLICT (lower(street_name_en), ward_no, page_number) DO UPDATE SET\n"
            "  register = EXCLUDED.register,\n"
            "  aro_section = COALESCE(EXCLUDED.aro_section, regulatory_data.bbmp_street_index.aro_section),\n"
            "  zone_code = COALESCE(EXCLUDED.zone_code, regulatory_data.bbmp_street_index.zone_code),\n"
            "  guidance_value_band_min_inr = COALESCE(EXCLUDED.guidance_value_band_min_inr, regulatory_data.bbmp_street_index.guidance_value_band_min_inr),\n"
            "  guidance_value_band_max_inr = COALESCE(EXCLUDED.guidance_value_band_max_inr, regulatory_data.bbmp_street_index.guidance_value_band_max_inr),\n"
            "  row_excerpt = EXCLUDED.row_excerpt,\n"
            "  confidence_score = EXCLUDED.confidence_score,\n"
            "  updated_at = now();\n")
        (OUT / f"bbmp_register_{n_chunks:03d}.sql").write_text(sql, encoding="utf-8")

    with_zone = sum(1 for r in final if r.get("zone_code"))
    by_reg = {}
    for r in final:
        by_reg[r["register"]] = by_reg.get(r["register"], 0) + 1
    print(f"final rows: {len(final)} ({by_reg}); with zone: {with_zone} "
          f"({round(100 * with_zone / max(1, len(final)))}%)")
    print(f"wrote {n_chunks} chunks of <= {CHUNK} rows to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
