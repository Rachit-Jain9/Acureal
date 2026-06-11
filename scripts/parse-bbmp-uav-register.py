#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deterministic parser for the BBMP Guidance Value / UAV zone register PDF.

Supersedes build-bbmp-street-index.py (pypdf-based), whose blind spots left
~45% of the register unextracted or unverifiable:
  1. ~300 pages embed the English text in a subset font whose char codes are
     uniformly shifted by +0x1D ("$5(.(03$1$+$//," = "AREKEMPANAHALLI").
     The old is_garbage() filter rejected those rows as corruption.
  2. pypdf reordered multi-zone pages so ZONE headers detached from their rows;
     zone codes then had to come from a later heuristic/LLM pass.
  3. Sections with the alternate table layout (e.g. ARO Hormavu) wrap street
     cells over multiple lines and use typo'd headers ("Guidence Value
     bandwith"), which line-oriented parsing mangles.

This parser works on PyMuPDF *blocks* (one table cell-group per block, so a
street row keeps its Sl/Ward numbers and wrapped fragments together), decodes
the shifted font per-span, and runs a y-ordered state machine over
ARO / ZONE / GUIDANCE VALUE BANDWIDTH headers — so every street row carries
its zone + bandwidth deterministically from the page itself, plus the register
it belongs to (pages 17-362 = residential, 363-686 = non-residential).

Outputs:
  tmp/bbmp-uav-register.json            — parsed rows
  tmp/bbmp-uav-register-anomalies.json  — rejected fragments for human review

Usage: python scripts/parse-bbmp-uav-register.py "<path to Guidance Value.pdf>"
"""
from __future__ import annotations
import json
import re
import sys
from collections import Counter
from pathlib import Path

import fitz  # PyMuPDF

TMP = Path(__file__).resolve().parent.parent / "tmp"
OUT_ROWS = TMP / "bbmp-uav-register.json"
OUT_ANOM = TMP / "bbmp-uav-register-anomalies.json"

RESIDENTIAL_PAGES = (17, 362)
NON_RESIDENTIAL_PAGES = (363, 686)

# Kannada legacy fonts — their spans are the Kannada column; never row data.
KANNADA_FONTS = ("Nudi", "Tunga", "Kedage", "BRH")

# Legacy-Nudi zone letters printed after 'ªÀ®AiÀÄ' ("Zone") in the Kannada
# header — the only zone marker on many pages. Mapping confirmed against pages
# carrying both the English and Kannada headers (485 markers in the register).
NUDI_ZONE_LETTERS = {"J": "A", "©": "B", "¹": "C", "r": "D", "E": "E", "J¥sï": "F"}


def shift_decode(s: str) -> str:
    """Undo the +0x1D subset-font shift ('$'->'A', '\\x14'->'1', '\\x03'->' ')."""
    return "".join(chr(ord(c) + 0x1D) if ord(c) <= 0x7F - 0x1D else c for c in s)


def plausibility(t: str) -> float:
    t = t.strip()
    if not t:
        return -1.0
    good = sum(1 for c in t if c.isalnum() or c in " ,.-()/&':;+#*\"!?_%[]@=")
    ctrl = sum(1 for c in t if ord(c) < 0x20)
    return good / len(t) - (1.0 if ctrl else 0.0)


def decode_span(text: str) -> str | None:
    """Pick the more plausible of identity vs +0x1D-shift for one span."""
    ident, shifted = text, shift_decode(text)
    best = max((ident, shifted), key=plausibility)
    return best if plausibility(best) > 0.80 else None


def nudi_zone_marker(text: str) -> str | None:
    if "ªÀ®AiÀÄ" not in text:
        return None
    tail = text.split("ªÀ®AiÀÄ", 1)[1].strip()
    for glyph, zone in sorted(NUDI_ZONE_LETTERS.items(), key=lambda kv: -len(kv[0])):
        if tail.startswith(glyph):
            return zone
    return None


ZONE_RE = re.compile(r"\bZONE\s*[-–]?\s*([A-F])\b", re.IGNORECASE)
# Tolerates the register's spelling drift: GUIDANCE/GUIDENCE, BANDWIDTH/BANDWITH
BAND_RE = re.compile(r"GUID[AE]NCE\s+VALUE\s+BAND\s*WI[D]?TH?", re.IGNORECASE)
BAND_RANGE_RE = re.compile(
    r"RS\.?\s*([\d,]+)\s*(?:/-)?\s*(?:TO|&)\s*(?:RS\.?\s*)?([\d,]+)", re.IGNORECASE)
BAND_ABOVE_RE = re.compile(r"RS\.?\s*([\d,]+)\s*(?:/-)?\s*&?\s*ABOVE", re.IGNORECASE)
# ARO header comes in both orders: 'ARO NAME / RESIDENTIAL' and
# 'ARO / NAME (RESIDENTIAL)'; names may be parenthesised.
ARO_PATTERNS = (
    re.compile(r"ARO\s*\(?\s*([A-Z0-9 .\-&]{3,}?)\s*\)?\s*/\s*(?:NON[\s\-]*)?RESIDENTIAL", re.IGNORECASE),
    re.compile(r"ARO\s*/\s*\(?\s*([A-Z0-9 .\-&]{3,}?)\s*\)?\s*[(/]\s*(?:NON[\s\-]*)?RESIDENTIAL", re.IGNORECASE),
    re.compile(r"ARO\s*\(?\s*([A-Z0-9 .\-&]{3,}?)\s*\)?\s*$", re.IGNORECASE),
)
HEADER_NOISE = re.compile(
    r"^(Sl\.?|No\.?|Sl\.? ?No\.?|WARD ?NO\.?|Ward|WARD|NO|Name of the Street|"
    r"NAME OF THE STREET|Road ?/ ?Street ?Name|Page \d+|UNIT: .*|Column ?\d?)$",
    re.IGNORECASE,
)
NUM = re.compile(r"^\d{1,4}$")


def parse_band(text: str) -> tuple[int | None, int | None]:
    t = text.replace(",", "")
    m = BAND_RANGE_RE.search(t)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = BAND_ABOVE_RE.search(t)
    if m:
        return int(m.group(1)), None
    return None, None


def clean_street(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip(" ,.;:-")


# Column-header detection. The two table layouts print a header row that is NOT
# a single token ("Sl. No Ward No Road / Street Name" / "Sl. WARD No. NO NAME OF
# THE STREET"), so the single-token HEADER_NOISE regex misses it — the block
# then bleeds into the first street name. Catch it by its unmistakable marker.
HEADER_MARKER_RE = re.compile(r"(NAME\s+OF\s+THE\s+STREET|ROAD\s*/\s*STREET\s*NAME)", re.IGNORECASE)
HEADER_TOKEN_RE = re.compile(r"^(SL\.?|NO\.?|WARD|\d{1,2}R|ROAD|/|STREET|NAME|OF|THE|:|1R)$", re.IGNORECASE)


def strip_header_prefix(s: str) -> str:
    """Cut a leading 'Sl … Name of the Street' header that merged into a street."""
    m = HEADER_MARKER_RE.search(s)
    if m and m.start() <= 45:
        return s[m.end():].strip(" ,.;:-")
    return s


def is_pure_header(s: str) -> bool:
    if not s.strip():
        return False
    toks = re.split(r"\s+", s.strip())
    if HEADER_MARKER_RE.search(s) and len(toks) <= 8:
        return True
    return all(HEADER_TOKEN_RE.match(t) for t in toks)


# Glyph-substituted Calibri subsets (a third encoding in this PDF) survive the
# +0x1D plausibility check because they are printable ASCII/Greek — but they
# are NOT English. Detect them so they become anomalies instead of polluting
# street names, and so pages whose ARO header is garbled get flagged for the
# visual naming pass rather than silently inheriting the previous section.
GARBLE_CHARS = set("ϭϮϯϰϱͶͻͬͲͿ{}[]!;ʹ͵ͺ͸͹Ϳ")


def looks_garbled(text: str) -> bool:
    if not text:
        return False
    weird = sum(1 for c in text if c in GARBLE_CHARS or 0x370 <= ord(c) <= 0x3FF)
    if weird / max(1, len(text)) > 0.15:
        return True
    # words like 'w9{L59bdL![' — digits/punct embedded mid-word
    tokens = text.split()
    odd = sum(1 for t in tokens if re.search(r"[A-Za-z][0-9{}\[\]!;][A-Za-z]|[{}\[\];!]{2}", t))
    return odd >= max(1, len(tokens) // 2)


def page_items(page: fitz.Page) -> list[dict]:
    """Classify each PyMuPDF block into header/zone/band/row items, y-ordered.

    Kannada spans are excluded, except the 'ªÀ®AiÀÄ <letter>' zone marker,
    which becomes a synthetic zone item (many pages have no English header).
    """
    d = page.get_text("dict")
    items: list[dict] = []
    for b in d["blocks"]:
        y0 = b["bbox"][1]
        tokens: list[str] = []
        zone_marker: str | None = None
        for line in b.get("lines", []):
            for s in line.get("spans", []):
                if any(k in s["font"] for k in KANNADA_FONTS):
                    z = nudi_zone_marker(s["text"])
                    if z:
                        zone_marker = z
                        continue
                    # Some layouts (e.g. ARO Hormavu) typeset the Sl/Ward
                    # DIGITS in the Nudi font — ASCII digits render as digits
                    # there, so keep pure-ASCII numeric/short tokens.
                    t = s["text"].strip()
                    if t.isascii() and re.fullmatch(r"[\d .,/()-]{1,8}", t):
                        tokens.append(t)
                    continue
                t = decode_span(s["text"])
                if t and t.strip():
                    tokens.append(t.strip())
        text = re.sub(r"\s+", " ", " ".join(tokens)).strip()
        if zone_marker and not ZONE_RE.search(text):
            items.append({"y": y0, "kind": "zone", "zone": zone_marker})
        if not text:
            continue
        zm = ZONE_RE.search(text)
        if zm and len(text) <= 24:  # short header cell, not a street containing 'zone'
            items.append({"y": y0, "kind": "zone", "zone": zm.group(1).upper()})
            rest = ZONE_RE.sub("", text)
            if BAND_RE.search(rest):
                items.append({"y": y0 + 0.1, "kind": "band", "text": rest})
            continue
        if BAND_RE.search(text):
            items.append({"y": y0, "kind": "band", "text": text})
            if zm:
                items.append({"y": y0 - 0.1, "kind": "zone", "zone": zm.group(1).upper()})
            continue
        if "ARO" in text.upper():
            for pat in ARO_PATTERNS:
                m = pat.search(text.upper())
                if m:
                    name = m.group(1).strip(" ()./-")
                    name = re.sub(r"\s+(NAGARA?|NAGAR)$", "", name).strip()
                    if len(name) >= 3:
                        items.append({"y": y0, "kind": "aro", "aro": name})
                    break
            continue
        if HEADER_NOISE.match(text) or HEADER_MARKER_RE.search(text):
            continue
        if looks_garbled(text):
            items.append({"y": y0, "kind": "garbled", "text": text[:120]})
            continue
        items.append({"y": y0, "kind": "rowblock", "tokens": tokens})
    items.sort(key=lambda it: it["y"])
    return items


def rows_from_block(tokens: list[str]) -> tuple[list[dict], list[str]]:
    """Split one row-block into street rows.

    Typical block: ['1', '25', 'CHELEKERE RING ROAD'] — sl, ward, fragments.
    Merged blocks may contain several rows; a new row starts at each numeric
    pair followed by text. Blocks with no numeric pair are street-only rows
    (alternate layout) or wrapped fragments (handled by the caller).
    """
    rows: list[dict] = []
    rejects: list[str] = []
    i = 0
    n = len(tokens)
    while i < n:
        if NUM.match(tokens[i]) and i + 1 < n and NUM.match(tokens[i + 1]):
            sl, ward = int(tokens[i]), int(tokens[i + 1])
            i += 2
            frags: list[str] = []
            while i < n and not (NUM.match(tokens[i]) and i + 1 < n and NUM.match(tokens[i + 1])):
                frags.append(tokens[i])
                i += 1
            street = strip_header_prefix(clean_street(" ".join(frags)))
            if street and not is_pure_header(street):
                rows.append({"sl": sl, "ward": ward, "street": street})
            else:
                rejects.append(f"{sl} {ward} <no street>")
        else:
            # leading fragment(s) before the numeric pair (vertical centring
            # put the wrapped first line above the numbers) — attach to the
            # row that follows in this block, else surface to the caller.
            frags = []
            while i < n and not NUM.match(tokens[i]):
                frags.append(tokens[i])
                i += 1
            if frags:
                lead = clean_street(" ".join(frags))
                if is_pure_header(lead):
                    pass  # drop header fragments outright
                elif rows:
                    rows[-1]["street"] = clean_street(rows[-1]["street"] + " " + lead)
                else:
                    rejects.append(lead)
            elif i < n:
                # lone number (page number etc.)
                rejects.append(tokens[i])
                i += 1
    return rows, rejects


def parse(pdf_path: str) -> tuple[list[dict], list[dict]]:
    doc = fitz.open(pdf_path)
    out: list[dict] = []
    anomalies: list[dict] = []
    state = {"aro": None, "zone": None, "band": None, "band_min": None, "band_max": None}

    # pages whose header row is garbled (ARO unreadable) — the rows there carry
    # an INHERITED aro that the visual naming pass must overwrite. Group pages
    # by the raw first-line signature so one visual read names a whole section.
    page_flags: dict[int, dict] = {}

    for pno in range(RESIDENTIAL_PAGES[0], NON_RESIDENTIAL_PAGES[1] + 1):
        page = doc[pno - 1]
        register = "residential" if pno <= RESIDENTIAL_PAGES[1] else "non_residential"
        pending_lead: str | None = None  # fragment block awaiting its numbered row

        items = page_items(page)
        saw_aro = any(it["kind"] == "aro" for it in items)
        garbled_header = any(it["kind"] == "garbled" and it["y"] < 60 for it in items)
        if garbled_header and not saw_aro:
            raw_first = page.get_text().splitlines()
            page_flags[pno] = {
                "aro_inherited": True,
                "header_sig": (raw_first[0] if raw_first else "")[:60],
            }

        for it in items:
            if it["kind"] == "garbled":
                anomalies.append({"page": pno, "kind": "garbled_block", "text": it["text"]})
                continue
            if it["kind"] == "aro":
                if it["aro"] != state["aro"]:
                    state.update(zone=None, band=None, band_min=None, band_max=None)
                state["aro"] = it["aro"]
                pending_lead = None
                continue
            if it["kind"] == "zone":
                state["zone"] = it["zone"]
                pending_lead = None
                continue
            if it["kind"] == "band":
                state["band"] = it["text"][:120]
                state["band_min"], state["band_max"] = parse_band(it["text"])
                pending_lead = None
                continue
            rows, rejects = rows_from_block(it["tokens"])
            for rej in rejects:
                # a fragment-only block: either the wrapped tail of the LAST
                # emitted row, or the lead of the NEXT row. Heads are rare;
                # tails dominate. Attach to the last row on the same page.
                # Header fragments are dropped so they never pollute a street.
                if is_pure_header(rej):
                    continue
                if out and out[-1]["page_number"] == pno and len(rej) > 3 and not NUM.match(rej):
                    out[-1]["street_name_en"] = strip_header_prefix(clean_street(
                        out[-1]["street_name_en"] + " " + rej)).upper()
                elif len(rej) > 3 and not NUM.match(rej):
                    pending_lead = clean_street((pending_lead or "") + " " + rej)
                else:
                    anomalies.append({"page": pno, "kind": "stray", "text": rej[:120]})
            for r in rows:
                street = r["street"]
                if pending_lead:
                    street = strip_header_prefix(clean_street(pending_lead + " " + street))
                    pending_lead = None
                street = strip_header_prefix(street)
                letters = sum(1 for c in street if c.isalpha())
                if letters < 3 or not (1 <= r["ward"] <= 250):
                    anomalies.append({"page": pno, "kind": "bad_row",
                                      "data": f"{r['sl']} {r['ward']} {street[:100]}"})
                    continue
                out.append({
                    "street_name_en": street.upper()[:300],
                    "ward_no": r["ward"],
                    "page_number": pno,
                    "aro_section": state["aro"],
                    "aro_inherited": pno in page_flags,
                    "register": register,
                    "zone_code": state["zone"],
                    "band_label": state["band"],
                    "band_min_inr": state["band_min"],
                    "band_max_inr": state["band_max"],
                    "sl_no": r["sl"],
                    "row_excerpt": f"{r['sl']} {r['ward']} {street[:130]}",
                })
        if pending_lead:
            anomalies.append({"page": pno, "kind": "orphan_fragment", "text": pending_lead[:120]})

    doc.close()
    return out, anomalies, page_flags


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: parse-bbmp-uav-register.py <Guidance Value.pdf>", file=sys.stderr)
        return 1
    rows, anomalies, page_flags = parse(sys.argv[1])

    # group inherited-ARO pages by header signature for the visual naming pass
    groups: dict[str, list[int]] = {}
    for pno, fl in sorted(page_flags.items()):
        groups.setdefault(fl["header_sig"], []).append(pno)
    (TMP / "bbmp-uav-aro-groups.json").write_text(
        json.dumps([{"sig": sig, "pages": ps} for sig, ps in groups.items()],
                   ensure_ascii=False, indent=1), encoding="utf-8")

    # dedupe (street, ward, page, register) keeping the first occurrence
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for r in rows:
        key = (r["street_name_en"], r["ward_no"], r["page_number"], r["register"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)

    TMP.mkdir(parents=True, exist_ok=True)
    OUT_ROWS.write_text(json.dumps(deduped, ensure_ascii=False, indent=1), encoding="utf-8")
    OUT_ANOM.write_text(json.dumps(anomalies, ensure_ascii=False, indent=1), encoding="utf-8")

    by_reg = Counter(r["register"] for r in deduped)
    by_zone = Counter((r["register"], r["zone_code"] or "?") for r in deduped)
    pages = Counter(r["page_number"] for r in deduped)
    print(f"rows: {len(deduped)} (dedup from {len(rows)}); anomalies: {len(anomalies)}")
    print("by register:", dict(by_reg))
    print("by (register, zone):", dict(sorted(by_zone.items())))
    empty = [p for p in range(RESIDENTIAL_PAGES[0], NON_RESIDENTIAL_PAGES[1] + 1) if p not in pages]
    print(f"pages covered: {len(pages)}; empty pages: {len(empty)} -> {empty[:25]}")
    no_zone = sum(1 for r in deduped if not r["zone_code"])
    no_aro = sum(1 for r in deduped if not r["aro_section"])
    no_band = sum(1 for r in deduped if r["band_min_inr"] is None)
    inherited = sum(1 for r in deduped if r.get("aro_inherited"))
    print(f"rows missing zone: {no_zone}; missing aro: {no_aro}; missing band: {no_band}")
    print(f"rows on inherited-ARO pages (visual naming required): {inherited} "
          f"across {len(page_flags)} pages in {len(groups)} header groups")
    return 0


if __name__ == "__main__":
    sys.exit(main())
