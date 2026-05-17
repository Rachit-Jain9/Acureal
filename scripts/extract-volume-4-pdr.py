#!/usr/bin/env python3
# scripts/extract-volume-4-pdr.py
#
# Extracts per-Planning-District demographics (population, area, density,
# wards, villages) from the 376-page RMP 2031 Volume-4 PDR for all 42 PDs
# and writes the result to tmp/volume-4-pdr-demographics.json.
#
# Strategy: pull all page text via pypdf in one pass (the PDR is
# text-extractable from page 4 onwards — covers/figures are image-only),
# tag each page with a [PAGE N] marker, then call Gemini once with the
# full text + strict JSON schema. Total cost ~$0.03 on gemini-3.x.
#
# Output schema (one entry per PD):
#   {
#     "pd_code": "PD-01",
#     "pd_name": "Central Business District",
#     "notes":   "Population (2011 Census): 5,93,883; Area of PD: 2774.3 ha;
#                 Wards in PD: 19; Gross Density: 214PPH",
#     "source_page": 27,
#     "source_section": "PD 1: CENTRAL BUSINESS DISTRICT"
#   }
#
# Notes-string format follows the regex parser in
# backend/src/services/masterplan.service.js → parseDistrictNotes().
# Keep semicolon separators + labels exactly as below — changing them
# breaks the parser.
#
# Usage:
#   python scripts/extract-volume-4-pdr.py [--dry-run]
#
# --dry-run    Skip the Gemini call. Just write the pypdf-extracted text
#              to tmp/volume-4-pdr-text.txt for inspection.

from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

from pypdf import PdfReader

# Load env from backend/.env + backend/.env.local (Vercel convention).
# Strip BOM that Vercel CLI writes — without this the first key fails.
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


PDF = Path(r"C:\Users\rachi\OneDrive - UW\Desktop\Masterplan\Volume-4 PDR.pdf")
OUT_TEXT = Path(__file__).resolve().parent.parent / "tmp" / "volume-4-pdr-text.txt"
OUT_JSON = Path(__file__).resolve().parent.parent / "tmp" / "volume-4-pdr-demographics.json"

PROMPT = """You are extracting structured Planning District demographics from the Bengaluru RMP 2031 Volume-4 PDR document. The PDR contains 42 Planning Districts (PD-01 through PD-42) with demographic blocks scattered across 376 pages.

For EACH of the 42 Planning Districts, find the demographics block and extract:
- pd_code: canonical "PD-NN" format (zero-padded, e.g. "PD-01" not "PD 1")
- pd_name: official name as it appears in the section header (e.g. "Central Business District", "Indiranagar - Kagadasapura")
- population_2011_census: integer (e.g. 593883). The PDR usually states "Population (2011 Census)" or "Population".
- area_ha: float in hectares (e.g. 2774.3). PDR may give sq km — convert to ha (1 sq km = 100 ha).
- gross_density_pph: integer or float (persons per hectare). Look for "Gross Density".
- wards_in_pd: integer count of BBMP wards in the PD.
- villages_count: integer count of revenue villages / gramathanas in the PD (often 0 for inner-urban PDs).
- source_page: integer page number where the demographics block appears (1-indexed).
- source_section: the section header text (e.g. "PD 1: CENTRAL BUSINESS DISTRICT").

Return STRICT JSON with this exact shape:
{
  "districts": [
    {
      "pd_code": "PD-01",
      "pd_name": "Central Business District",
      "population_2011_census": 593883,
      "area_ha": 2774.3,
      "gross_density_pph": 214,
      "wards_in_pd": 19,
      "villages_count": 0,
      "source_page": 27,
      "source_section": "PD 1: CENTRAL BUSINESS DISTRICT"
    },
    ...
  ]
}

Rules:
- Return EXACTLY 42 entries, one per PD. If a PD's demographics are missing or unreadable, still include the entry with null values for the missing fields and set source_page/source_section to your best guess of where the section starts.
- Use the [PAGE N] markers in the text to determine source_page accurately.
- pd_code must always use zero-padded "PD-NN" format.
- Numbers must be unformatted (no commas, no currency symbols, no "ha" / "PPH" / "sq km" suffixes — just the value).
- Output ONLY the JSON, no prose, no markdown fences.
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Skip Gemini; dump text only")
    args = ap.parse_args()

    if not PDF.exists():
        print(f"ERROR: missing input PDF at {PDF}", file=sys.stderr)
        return 1

    load_env()

    print(f"Reading {PDF.name} ({PDF.stat().st_size // (1024 * 1024)} MB) ...")
    reader = PdfReader(str(PDF))
    page_count = len(reader.pages)
    print(f"  Pages: {page_count}")

    OUT_TEXT.parent.mkdir(parents=True, exist_ok=True)

    parts: list[str] = []
    skipped = 0
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if not text:
            skipped += 1
            continue
        parts.append(f"[PAGE {i}]\n{text}")
    body = "\n\n".join(parts)
    OUT_TEXT.write_text(body, encoding="utf-8")
    print(f"  Extracted text from {page_count - skipped}/{page_count} pages "
          f"(skipped {skipped} image-only), {len(body):,} chars total")
    print(f"  Wrote {OUT_TEXT}")

    if args.dry_run:
        print("\n--dry-run set — skipping Gemini call.")
        return 0

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY missing from backend/.env", file=sys.stderr)
        return 1

    try:
        from google import genai  # google-genai >= 0.3
        from google.genai import types
        client = genai.Client(api_key=api_key)
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

        print(f"\nCalling Gemini ({model}) — sending {len(body):,} chars ...")
        response = client.models.generate_content(
            model=model,
            contents=[PROMPT, body],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
                max_output_tokens=32768,
            ),
        )
        text = (response.text or "").strip()
        # Persist raw Gemini output for debugging (independent of JSON parse)
        raw_path = OUT_JSON.with_suffix(".raw.json")
        raw_path.write_text(text, encoding="utf-8")
        print(f"  Raw response written to {raw_path} ({len(text):,} chars)")
    except ImportError:
        # Fallback: legacy google-generativeai SDK
        import google.generativeai as genai_legacy
        genai_legacy.configure(api_key=api_key)
        model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        model = genai_legacy.GenerativeModel(
            model_name,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.0,
                "max_output_tokens": 16384,
            },
        )
        print(f"\nCalling Gemini ({model_name}) via legacy SDK — sending {len(body):,} chars ...")
        response = model.generate_content([PROMPT, body])
        text = (response.text or "").strip()

    # Strip code-fence wrappers if Gemini ignored the no-fence instruction
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        print(f"ERROR: Gemini returned invalid JSON: {e}", file=sys.stderr)
        print(f"--- response head ---\n{text[:500]}", file=sys.stderr)
        return 2

    districts = parsed.get("districts", [])
    if len(districts) != 42:
        print(f"WARNING: Gemini returned {len(districts)} PDs, expected 42", file=sys.stderr)

    # Convert each PD into the notes-string format that
    # parseDistrictNotes() in masterplan.service.js can parse.
    seeds = []
    for d in districts:
        pd_code = d.get("pd_code") or ""
        notes_parts = []
        if d.get("population_2011_census") is not None:
            notes_parts.append(f"Population (2011 Census): {d['population_2011_census']:,}")
        if d.get("area_ha") is not None:
            notes_parts.append(f"Area of PD: {d['area_ha']} ha")
        if d.get("wards_in_pd") is not None:
            notes_parts.append(f"Wards in PD: {d['wards_in_pd']}")
        if d.get("gross_density_pph") is not None:
            density = d["gross_density_pph"]
            notes_parts.append(f"Gross Density: {density}PPH")
        if d.get("villages_count") is not None:
            notes_parts.append(f"Villages in PD: {d['villages_count']}")
        seeds.append({
            "pd_code": pd_code,
            "pd_name": d.get("pd_name") or "",
            "notes": "; ".join(notes_parts),
            "source_page": d.get("source_page"),
            "source_section": d.get("source_section"),
            # Carry the structured fields too for traceability (the
            # service reads from notes via regex, but having both eases
            # downstream re-extraction).
            "population_2011_census": d.get("population_2011_census"),
            "area_ha": d.get("area_ha"),
            "gross_density_pph": d.get("gross_density_pph"),
            "wards_in_pd": d.get("wards_in_pd"),
            "villages_count": d.get("villages_count"),
        })

    OUT_JSON.write_text(json.dumps(seeds, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(seeds)} PD records to {OUT_JSON}")
    print("Sample entry:")
    print(json.dumps(seeds[0] if seeds else {}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
