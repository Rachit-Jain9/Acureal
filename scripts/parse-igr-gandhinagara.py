# -*- coding: utf-8 -*-
"""
Deterministic parser for the IGR guidance-value gazette — Gandhinagara SRO.

Source: Karnataka Gazette Part III, 30-Sep-2023 (Notification No. Ke&Mu/PaVaSa/
99/2023-24), "Central Valuation Committee" guidance values for the Bengaluru
Gandhinagara Sub-Registrar Office, effective 01-10-2023 (block 2023-24).

The street/road names are in English and the rates are clean digits in the PDF
text layer, so a deterministic state machine is higher-fidelity than AI OCR
(zero hallucination, fully verifiable). Output: structured rows + a summary.

State machine over the linear text of the value-table pages (12..end):
  - A number < VALUE_MIN is a serial number (Sl.No) -> the following text line(s)
    are the street, and the next number >= VALUE_MIN is the rate.
  - A text line that appears BETWEEN rows (after a rate, before the next Sl.No)
    is a LOCALITY-group header (carried across pages; Sl.No is continuous).
Rate is per square metre. Land-use type is inferred from the entry text.
"""
import io, os, json, re
import fitz

SRC = r'C:\Users\rachi\OneDrive - UW\Desktop\Masterplan 2015 - Copy\Gandhinagara_compressed.pdf'
OUT = r'C:\Users\rachi\OneDrive - UW\Desktop\Acureal\backend\_pdf_tmp\igr_gandhinagara.json'

VALUE_MIN = 10000          # a number >= this is a rate (Rs/sq.m); else a Sl.No
SQM_TO_SQFT = 10.76391041671
FIRST_VALUE_PAGE = 12      # pp.1-11 are the gazette notification + methodology

def classify(street):
    s = street.lower()
    if 'commercial' in s:
        return 'commercial'
    if 'apartment' in s or 'apartments' in s or 'mansion' in s or 'residency' in s \
       or 'complex' in s or 'plaza' in s or 'tower' in s or 'arcade' in s or 'avenue ' in s:
        return 'apartment_or_built_up'
    return 'residential'  # plain street/road -> residential land circle rate

def is_int(tok):
    return bool(re.fullmatch(r'\d{1,7}', tok))

def main():
    doc = fitz.open(SRC)

    # Flatten the value pages into (token, page) keeping order, dropping blanks,
    # the bare page-number line, and the Kannada column-header echoes.
    toks = []
    for pidx in range(FIRST_VALUE_PAGE - 1, doc.page_count):
        page_no = pidx + 1
        for ln in doc[pidx].get_text('text').split('\n'):
            ln = ln.strip()
            if not ln or ln == str(page_no):
                continue
            if re.search(r'2023-24|ZÀ\.«ÄÃl|¥Àæw|gÀÆ\.|¸ÀÜ½ÃAiÀÄ|¤ªÁ±|¤ªÉÃ±|KjAiÀ', ln):
                continue
            toks.append((ln, page_no))

    def kind(t):
        if is_int(t):
            return 'value' if int(t) >= VALUE_MIN else 'slno'
        return 'text'

    rows = []
    locality = None
    last_slno = 0
    i, n = 0, len(toks)
    while i < n:
        tok, page = toks[i]
        k = kind(tok)
        if k == 'value':
            i += 1  # stray value with no open row — skip
            continue
        if k == 'slno':
            slno = int(tok); last_slno = slno
            i += 1
        else:
            # text in the between-rows position. LOOKAHEAD: a locality header is
            # followed by a Sl.No; a street that lost its Sl.No is followed by its
            # value. (Handles the gazette's occasional missing serial number.)
            nxt = kind(toks[i + 1][0]) if i + 1 < n else None
            if nxt == 'slno' or nxt == 'text':
                locality = tok
                i += 1
                continue
            slno = last_slno + 1; last_slno = slno  # recovered street

        # Now read the street (1+ text lines) then the value. A PID number can
        # wrap across lines (e.g. "...PID No.28-4-" + "78"): when the accumulated
        # street ends in a hanging hyphen, the next token — even a bare number —
        # is a continuation of the PID, NOT a new serial.
        street_parts = []
        while i < n:
            t = toks[i][0]
            kt = kind(t)
            ends_hyphen = bool(street_parts) and street_parts[-1].rstrip().endswith('-')
            if kt == 'text' or (kt == 'slno' and ends_hyphen):
                street_parts.append(t); i += 1
            else:
                break
        if i < n and kind(toks[i][0]) == 'value':
            # glue hyphen-ended fragments without a space (PID line-wraps)
            street = ''
            for p in street_parts:
                if street and not street.endswith('-'):
                    street += ' '
                street += p
            street = street.strip()
            per_sqm = int(toks[i][0]); i += 1
            if street:
                rows.append({
                    'sro': 'Gandhinagara',
                    'district': 'Bengaluru Urban',
                    'locality': locality,
                    'sl_no': slno,
                    'road_or_locality': street,
                    'value_inr_per_sqm': per_sqm,
                    'value_inr_per_sqft': round(per_sqm / SQM_TO_SQFT, 2),
                    'land_use_type': classify(street),
                    'source_page': page,
                })
        # else: no value followed — drop (defensive)

    # summary
    localities = sorted({r['locality'] for r in rows if r['locality']})
    by_type = {}
    for r in rows:
        by_type[r['land_use_type']] = by_type.get(r['land_use_type'], 0) + 1
    vals = [r['value_inr_per_sqm'] for r in rows]
    io.open(OUT, 'w', encoding='utf-8').write(json.dumps(rows, ensure_ascii=False, indent=1))
    print('rows:', len(rows))
    print('localities (%d):' % len(localities), ', '.join(localities[:40]))
    print('by_type:', by_type)
    print('value/sqm range: %d - %d' % (min(vals), max(vals)) if vals else 'none')
    print('sample rows:')
    for r in rows[:4] + rows[len(rows)//2:len(rows)//2+2] + rows[-3:]:
        print('  [p%d] %s | %s | Rs %d/sqm (Rs %.0f/sqft) | %s' % (
            r['source_page'], r['locality'], r['road_or_locality'][:42],
            r['value_inr_per_sqm'], r['value_inr_per_sqft'], r['land_use_type']))
    print('wrote', OUT)

main()
