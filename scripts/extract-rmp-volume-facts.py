#!/usr/bin/env python3
# scripts/extract-rmp-volume-facts.py
#
# Extracts structured facts from RMP 2031 Volume-3 (Master Plan rules,
# 432K chars / 214pp) and Volume-6 (Zoning Regulations + SDZ/heritage,
# 337K chars / 206pp) via Gemini text-mode. Output goes to
# tmp/rmp-volume-facts.json, ready to be embedded in a SQL migration.
#
# Focus areas (per the panels that consume the facts):
#   1. SDZ corridors (sdz.special_development_zones)            — Vol-6
#   2. Heritage zones (heritage.heritage_zones)                  — Vol-6
#   3. NGT drainage classification (environmental.ngt_*)         — Vol-3
#   4. Regional parks (environmental.regional_parks)             — Vol-3
#   5. Peripheral Ring Road (road_network.peripheral_ring_road)  — Vol-3
#   6. Substantive zoning rule narratives (rmp_table.*)          — Vol-3/6
#
# Usage:
#   python scripts/extract-rmp-volume-facts.py [--dry-run]
#
# --dry-run    Dump the prompt + text to tmp/, skip Gemini.

from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

from pypdf import PdfReader


def load_env() -> None:
    for fname in (".env.local", ".env"):
        p = Path(__file__).resolve().parent.parent / "backend" / fname
        if not p.exists():
            continue
        raw = p.read_text(encoding="utf-8").lstrip("﻿")
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


SOURCES = {
    "vol3": {
        "path": r"C:\Users\rachi\OneDrive - UW\Desktop\Masterplan\Volume-3 Master Plan Document.pdf",
        "evidence_source_id": "a29884e4-6bf9-434a-ac24-f4e2385f7b92",
    },
    "vol1": {
        "path": r"C:\Users\rachi\OneDrive - UW\Desktop\Masterplan\Volume-1 Vision DOcument.pdf",
        "evidence_source_id": "0c72c6c8-0e60-41ba-b4fa-45cf1005d958",
    },
    # Vol-6 deferred — token-budget hit on the full inventory pass; needs a
    # narrower prompt or chunked extraction. The Vol-3 SDZ/heritage facts
    # cover the panels' immediate need.
}

OUT_JSON = Path(__file__).resolve().parent.parent / "tmp" / "rmp-volume-facts.json"

PROMPT_TEMPLATE = """You are extracting structured facts from {volume_name} of the Bengaluru RMP 2031 (Revised Master Plan). Each page is tagged with [PAGE N].

Find and return ALL of the following kinds of facts that appear in the document. SKIP categories that aren't substantively covered.

1. SDZ corridors (sdz.special_development_zones) — array of {{name, corridor_axis, length_km, key_features, source_page}}
2. Heritage zones / precincts (heritage.heritage_zones) — array of {{name, location, era, conservation_grade, source_page}}
3. NGT-mandated drainage classification (environmental.ngt_drainage_classification) — object {{primary_drains_count, secondary_drains_count, tertiary_drains_count, lake_buffer_m, primary_buffer_m, secondary_buffer_m, tertiary_buffer_m, source_page, notes}}
4. Regional parks (environmental.regional_parks) — array of {{name, area_ha, location, source_page}}
5. Peripheral Ring Road (road_network.peripheral_ring_road) — object {{alignment, length_km, completed_pct, status, source_page}}
6. Substantive zoning rule narratives — array of {{rule_topic, statement, source_page, source_section}} (e.g. setback floor for high-rises, mandatory open space, plot-coverage cap)

Return STRICT JSON:
{{
  "facts": [
    {{ "fact_type": "sdz", "fact_key": "special_development_zones", "fact_value": [...], "source_page": <int>, "source_section": "..." }},
    {{ "fact_type": "heritage", "fact_key": "heritage_zones", "fact_value": [...], ... }},
    {{ "fact_type": "environmental", "fact_key": "ngt_drainage_classification", "fact_value": {{...}}, ... }},
    {{ "fact_type": "environmental", "fact_key": "regional_parks", "fact_value": [...], ... }},
    {{ "fact_type": "road_network", "fact_key": "peripheral_ring_road", "fact_value": {{...}}, ... }},
    {{ "fact_type": "rmp_table", "fact_key": "<short_key>", "fact_value": {{...}}, ... }}
  ]
}}

Rules:
- Use the [PAGE N] markers for `source_page`.
- Only include facts that are TEXTUALLY stated in the document — don't infer or make up.
- If a category is absent or only partially covered, OMIT its entry from the facts array (don't return placeholder/empty entries).
- Output ONLY the JSON, no prose, no markdown fences.
"""


def extract_text(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    parts: list[str] = []
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            parts.append(f"[PAGE {i}]\n{text}")
    return "\n\n".join(parts)


def call_gemini(prompt: str, text: str) -> str:
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

    print(f"  Calling Gemini ({model}) — {len(text):,} chars ...")
    response = client.models.generate_content(
        model=model,
        contents=[prompt, text],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
            max_output_tokens=32768,
        ),
    )
    return (response.text or "").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    load_env()

    if not args.dry_run and not os.environ.get("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY missing from backend/.env", file=sys.stderr)
        return 1

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    all_facts: list[dict] = []

    for vol_key, vol_info in SOURCES.items():
        vol_path = vol_info["path"]
        evidence_source_id = vol_info["evidence_source_id"]
        if not os.path.exists(vol_path):
            print(f"SKIP {vol_key}: missing {vol_path}", file=sys.stderr)
            continue

        volume_name = "Volume-3 (RMP 2031 Master Plan Document)" if vol_key == "vol3" else "Volume-6 (RMP 2031 Zoning Regulations)"
        prompt = PROMPT_TEMPLATE.format(volume_name=volume_name)

        print(f"\n=== Extracting {vol_key} ===")
        text = extract_text(vol_path)
        print(f"  Pages extracted: {text.count('[PAGE ')}, {len(text):,} chars")

        if args.dry_run:
            print("  --dry-run: skipping Gemini")
            continue

        raw = call_gemini(prompt, text)
        # Save raw response for debugging
        (OUT_JSON.parent / f"rmp-{vol_key}-facts.raw.json").write_text(raw, encoding="utf-8")

        # Strip code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0]
            raw = raw.strip()

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as e:
            print(f"  ERROR: bad JSON: {e}", file=sys.stderr)
            print(f"  --- raw head ---\n{raw[:500]}", file=sys.stderr)
            continue

        facts = parsed.get("facts", [])
        # Tag each fact with the source_id so the seed knows where it came from
        for f in facts:
            f["evidence_source_id"] = evidence_source_id
            f["volume"] = vol_key
        all_facts.extend(facts)
        print(f"  Extracted {len(facts)} facts from {vol_key}")

    if not all_facts and not args.dry_run:
        print("\nNo facts extracted from any volume.", file=sys.stderr)
        return 1

    if not args.dry_run:
        OUT_JSON.write_text(json.dumps(all_facts, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nWrote {len(all_facts)} total facts to {OUT_JSON}")
        # Summary
        from collections import Counter
        tally = Counter((f.get("fact_type"), f.get("fact_key")) for f in all_facts)
        for (ftype, fkey), n in sorted(tally.items()):
            print(f"  {ftype}.{fkey}: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
