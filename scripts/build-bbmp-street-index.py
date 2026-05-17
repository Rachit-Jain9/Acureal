#!/usr/bin/env python3
"""Build the BBMP street index from the extracted Guidance Value PDF text.

Reads the per-page text files produced by `extract-guidance-value-pdf.py` and
turns them into one row per (street, ward, page) — saved to a JSON file the
backend can pick up to seed `regulatory_data.bbmp_street_index`.

The per-row schema:
    {
      "street_name_en": "AKKAMAHADEVI ROAD AND 1ST CROSS ROAD",
      "ward_no": 120,
      "page_number": 19,
      "aro_section": "CHICKPET / RESIDENTIAL",
      "row_excerpt": "73 109 MAKALAPPA LANE, . ªÀiÁPÀ®¥Àà ¯ÉÃ£ï"
    }

Why this script does not also extract the zone code:
    pypdf reorders the visual layout of multi-zone pages — the zone footers
    end up grouped at the bottom of the text instead of interleaved with the
    streets they govern. Reliable zone association needs a multimodal LLM pass
    over the page image, which we will do in Phase 2. Phase 1 ships the
    searchable index; Phase 2 adds zone codes.

Output: tmp/bbmp-street-index.json (a single JSON array, ~5k entries).
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

TMP = Path(__file__).resolve().parent.parent / "tmp"
PAGES_DIR = TMP / "guidance-value"
OUT_FILE = TMP / "bbmp-street-index.json"

# Kannada script Unicode range. Most rows leak the second column either as
# proper Kannada (U+0C80–U+0CFF) or as legacy-font glyphs encoded in Latin
# Supplement / IPA / Greek / symbols. The cleanest split signal is "any
# non-ASCII run after the English name ends" — Kannada or legacy alike.
KANNADA_RE = re.compile(r"[ಀ-೿]+")
NON_ASCII_RUN_RE = re.compile(r"[^\x00-\x7F]+.*$")
# Common typographic separators between the English and Kannada columns.
COLUMN_SEP_RE = re.compile(r"\s+[.,]\s+[^A-Za-z0-9\s]")

# A street-row pattern: starts with sl_no + ward_no, then street text.
# We accept rows where sl_no is 1-5 digits and ward_no is 1-3 digits.
ROW_RE = re.compile(r"^\s*(\d{1,5})\s+(\d{1,3})\s+(.+?)\s*$")

# ARO (Assistant Revenue Officer) section header.
ARO_RE = re.compile(r"^ARO\s+(.+?)\s+(?:¸ÀºÁAiÀÄPÀ|$)", re.IGNORECASE)

# Skip lines that are clearly NOT street rows.
SKIP_PREFIXES = (
    "Sl.", "WARD", "NAME OF THE STREET", "ZONE", "GUIDANCE VALUE",
    "Page", "ARO ", "Column", "Whether", "Tenanted", "Owner",
    "ªÀ®AiÀÄ",  # Kannada for "zone"
)


def clean_english_only(street_cell: str) -> str:
    """Drop the Kannada half of the bilingual cell, normalise whitespace.

    Three-pass cleanup so legacy-font glyphs (which present as Latin Supplement
    or Greek codepoints, not the U+0C80 block) still get dropped:
      1. Cut at the first proper-Kannada run if there is one.
      2. Cut at the first non-ASCII run after that.
      3. Strip ASCII-but-clearly-junk trailing fragments like " . " separators.
    """
    en = street_cell
    # Pass 1: proper Kannada block.
    m = KANNADA_RE.search(en)
    if m:
        en = en[: m.start()]
    # Pass 2: any other non-ASCII run (legacy font glyphs).
    m = NON_ASCII_RUN_RE.search(en)
    if m:
        en = en[: m.start()]
    # Pass 3: drop trailing column-separator punctuation.
    en = re.sub(r"\s*[.,]\s*$", "", en).strip()
    # Pass 4: collapse internal whitespace runs.
    en = re.sub(r"\s+", " ", en)
    # Pass 5: drop a trailing 1–2 character "word" that's actually the first
    # glyph of the Kannada column leaking through ASCII (e.g. "ROAD C" → "ROAD",
    # "S.B.PALYA J" → "S.B.PALYA", "1ST CROSS g" → "1ST CROSS"). Only strip
    # if preceded by a real word so we don't damage legitimate short tokens
    # like "M G ROAD" or "K R PURAM" (those have the short tokens INSIDE, not
    # trailing).
    en = re.sub(r"\b([A-Z]{3,}[A-Z0-9.,&'/() -]*?)\s+[A-Za-z]{1,2}$", r"\1", en).strip()
    # Drop any orphaned trailing punctuation again after the trim.
    en = re.sub(r"[\s,.;:-]+$", "", en).strip()
    return en


def is_garbage(street_en: str) -> bool:
    """Reject rows that look like character-encoding corruption rather than
    real street names. Heuristics:
      - Mostly non-letter ASCII (e.g. "9,6+:$.$50$/$<2870('$+$//")
      - Letters-to-non-letters ratio < 0.5
      - All-digits or all-punct after the ward number prefix.
    """
    if not street_en:
        return True
    letters = sum(1 for c in street_en if c.isalpha())
    if letters < 3:
        return True
    if letters / max(1, len(street_en)) < 0.5:
        return True
    if not re.search(r"[A-Za-z]{3,}", street_en):
        return True
    return False


def parse_page(text: str, page_number: int) -> tuple[str | None, list[dict]]:
    """Return (aro_section, list of street rows) for one page."""
    aro_section: str | None = None
    rows: list[dict] = []

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue

        # Capture ARO section header (sticks for the rest of the page).
        aro_match = ARO_RE.match(line)
        if aro_match:
            aro_section = aro_match.group(1).strip()
            continue

        # Skip non-row lines.
        if any(line.startswith(prefix) for prefix in SKIP_PREFIXES):
            continue

        row_match = ROW_RE.match(line)
        if not row_match:
            continue

        sl_no, ward_no, rest = row_match.groups()

        # Drop the row if the "rest" is purely numeric / structural (e.g. a
        # continuation of a long street name on a wrapped line).
        if not re.search(r"[A-Za-z]", rest):
            continue

        street_en = clean_english_only(rest)
        if is_garbage(street_en):
            continue

        # Reject rows where the "street name" is just a year, a price, or
        # column boilerplate.
        if re.fullmatch(r"\d+(\.\d+)?", street_en):
            continue

        rows.append({
            "street_name_en": street_en,
            "ward_no": int(ward_no),
            "page_number": page_number,
            "aro_section": aro_section,
            "row_excerpt": line[:160],
        })

    return aro_section, rows


def main() -> int:
    if not PAGES_DIR.exists():
        print(f"ERROR: pages directory missing — run extract-guidance-value-pdf.py first", file=sys.stderr)
        return 1

    all_rows: list[dict] = []
    page_files = sorted(PAGES_DIR.glob("page-*.txt"))
    for page_file in page_files:
        page_number = int(page_file.stem.split("-")[1])
        text = page_file.read_text(encoding="utf-8", errors="replace")
        _aro, rows = parse_page(text, page_number)
        all_rows.extend(rows)

    # Deduplicate exact (street, ward, page) triples — same street can appear
    # multiple times on a page in pypdf's wrapped output; the index entry
    # itself stays unique per (street, ward, page).
    seen: set[tuple[str, int, int]] = set()
    deduped: list[dict] = []
    for row in all_rows:
        key = (row["street_name_en"].upper(), row["ward_no"], row["page_number"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    TMP.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(deduped, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Extracted {len(all_rows)} raw rows → {len(deduped)} unique street/ward/page entries")
    print(f"Wrote {OUT_FILE}")

    # Quick stats so the agent can sanity-check.
    pages_with_rows = len({r['page_number'] for r in deduped})
    wards = sorted({r['ward_no'] for r in deduped if r['ward_no']})
    aros = sorted({r['aro_section'] for r in deduped if r['aro_section']})
    print(f"  Pages with at least one street: {pages_with_rows}")
    print(f"  Distinct ward numbers: {len(wards)} (min {wards[0]}, max {wards[-1]})")
    print(f"  Distinct ARO sections: {len(aros)}")
    if aros:
        print(f"  ARO examples: {aros[:5]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
