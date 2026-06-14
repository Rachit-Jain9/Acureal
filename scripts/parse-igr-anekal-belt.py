# -*- coding: utf-8 -*-
"""
Deterministic coordinate parser for the IGR guidance-value gazettes of the
Anekal-belt Sub-Registrar Offices: ANEKAL, ATTIBELE, JIGANI (block 2023-24).

Unlike the clean single-column Gandhinagara extract, these are full 8-column
ruled tables:
  C1 Sl.No | C2 Kannada name | C3 English name (Hobli/Village/Area)
  C4 Competent-authority residential sites  (Rs / sq.m)   <- developed land
  C5 Local-body residential sites           (Rs / sq.m)   <- developed land
  C6 Villa / row-house                      (Rs / sq.m)   <- developed land
  C7 Agricultural land                      (per acre)    <- EXCLUDED (diff unit)
  C8 Apartments                             (per built-up)<- EXCLUDED (diff unit)

The column sub-headers explicitly read "per square metre, in Rupees" for C4-C6
(verified against the rendered header), so the developed-land guidance value is
PER SQUARE METRE — value_inr_per_sqft = rate / 10.76391.

Numbers come from COLUMN POSITION (deterministic), never from an LLM's reading
(CLAUDE.md hard rule). The developed-land rate for a row = the smallest value
in the C4-C6 x-band with magnitude >= 1000 (the per-sq.m developed rates are
4-5 digits; the agricultural per-acre values are < 1000 and/or sit in C7, so
both position AND magnitude exclude them). Taking the minimum is conservative
for the downstream "land priced below guidance" flag (fewer false positives).

English locality names (which wrap across lines and interleave with Kannada and
with all-caps hobli/ward HEADER rows) are read from the C3 x-band; header rows
are detected and carried as a group label, not folded into a street name.

The apartment "READY RECKONER" pages (Jigani 49-58) are excluded by page range.
Output: structured JSON rows + a summary for adversarial verification.
"""
import io, os, json, re
import fitz

SQM_TO_SQFT = 10.76391041671
DESK = r'C:\Users\rachi\OneDrive - UW\Desktop'
OUT = r'C:\Users\rachi\OneDrive - UW\Desktop\REDIP\backend\_pdf_tmp\igr_anekal_belt.json'

# Per-file calibration: ruled column-divider x-positions (detected from the PDF
# vector grid; identical across pages within a file) + the land-table page span.
FILES = {
    'Anekal':   {'dividers': [40, 78, 244, 423, 476, 552, 631, 684, 751], 'pages': (1, 34)},
    'Attibele': {'dividers': [43, 88, 288, 468, 528, 581, 628, 694, 747], 'pages': (1, 25)},
    # Jigani land table = pp.1-48; pp.49-58 are the apartment ready-reckoner.
    'Jigani':   {'dividers': [41, 78, 249, 400, 472, 544, 603, 682, 750], 'pages': (1, 48)},
}

VALUE_MIN = 1000  # a developed per-sq.m rate is >= 1000; agri per-acre values are smaller

# Group-header / non-street lines in the C3 column to keep OUT of street names
# (carried as the locality group instead). Matches the Kannada-gazette English.
HEADER_RE = re.compile(
    r'\b(HOBLI|WARD|LIMITS|TOWN|ZONE|TALUK|VILLAGE\s+PANCHAYAT|GRAMA|PURASABHE|'
    r'MUNICIPAL|CMC|TMC|PANCHAYAT|HUDI|KASABA)\b', re.I)
# A C3 line that is essentially ALL CAPS (a section header like "ANEKAL TOWN LIMITS")
def is_caps_header(s):
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 4:
        return False
    caps = sum(1 for c in letters if c.isupper())
    return caps / len(letters) >= 0.85

# Agricultural / survey-number rows carry no developed rate; they are dropped
# automatically (no value in the developed band). This regex only annotates.
AGRI_RE = re.compile(r'\bSurvey\s+Numbers?\b|\bSy\s*Nos?\b.*\bRoad\b', re.I)


def ascii_clean(s):
    return ''.join(c for c in (s or '') if 32 <= ord(c) < 127).strip()


def classify(name):
    s = name.lower()
    if 'industrial' in s or 'kiadb' in s or 'factory' in s:
        return 'industrial'
    if ('commercial' in s or 'shop' in s or 'market' in s or 'complex' in s
            or 'mall' in s or 'bazaar' in s or 'bazar' in s):
        return 'commercial'
    return 'residential'


def parse_file(name, cfg):
    pdf = os.path.join(DESK, '%s.pdf' % name)
    doc = fitz.open(pdf)
    d = cfg['dividers']
    # Column x-bands. Name = C3 [d2,d3]. Developed = C4..C6 [d3, d6].
    name_lo, name_hi = d[2], d[3]
    dev_lo, dev_hi = d[3], d[6]      # C4 left .. C7 left (covers CA-resi, local-resi, villa)
    slno_lo, slno_hi = d[0], d[1]

    rows = []
    p0, p1 = cfg['pages']
    for pidx in range(p0 - 1, p1):
        page = doc[pidx]
        words = page.get_text('words')  # (x0,y0,x1,y1, word, block,line,wn)
        # Bucketize tokens
        slnos, values, names = [], [], []  # each: (y, x, text/intval)
        for w in words:
            x0, y0, txt = w[0], w[1], w[4]
            t = ascii_clean(txt)
            if not t:
                continue
            xc = (w[0] + w[2]) / 2.0
            if slno_lo <= xc < slno_hi and re.fullmatch(r'\d{1,4}', t):
                slnos.append((y0, xc, int(t)))
            elif dev_lo <= xc < dev_hi and re.fullmatch(r'\d{3,7}', t):
                v = int(t)
                if v >= VALUE_MIN:
                    values.append((y0, xc, v))
            elif name_lo <= xc < name_hi:
                names.append((y0, xc, t))

        if not slnos:
            continue
        slnos.sort()
        # Row y-windows: from this Sl.No to the next.
        for i, (sy, sx, sl) in enumerate(slnos):
            y_top = sy - 6
            y_bot = (slnos[i + 1][0] - 4) if i + 1 < len(slnos) else (sy + 120)
            # developed value(s) in this window
            vlist = sorted(v for (vy, vx, v) in values if y_top <= vy < y_bot)
            if not vlist:
                continue  # agri-only / header row -> dropped
            value_sqm = vlist[0]   # conservative: lowest developed rate
            # name fragments in this window, excluding header lines
            frags = [(ny, nx, nt) for (ny, nx, nt) in names if y_top <= ny < y_bot]
            frags.sort()
            # group fragments into visual lines by y, then drop header lines
            line_map = {}
            for ny, nx, nt in frags:
                line_map.setdefault(round(ny / 5) * 5, []).append((nx, nt))
            keep_parts = []
            for ly in sorted(line_map):
                toks = [t for _, t in sorted(line_map[ly])]
                line = ' '.join(toks).strip()
                if not line:
                    continue
                if is_caps_header(line) or HEADER_RE.search(line):
                    continue  # section header, not a street name
                keep_parts.append(line)
            locality = ' '.join(keep_parts).strip()
            locality = re.sub(r'\s+', ' ', locality)
            if not locality or len(locality) < 2:
                continue
            rows.append({
                'sro': name,
                'sl_no': sl,
                'page': pidx + 1,
                'locality': locality,
                'value_inr_per_sqm': value_sqm,
                'value_inr_per_sqft': round(value_sqm / SQM_TO_SQFT, 2),
                'all_dev_values': vlist,
                'land_use_type': classify(locality),
                'is_agri_named': bool(AGRI_RE.search(locality)),
            })
    doc.close()
    return rows


def main():
    allrows = []
    for name, cfg in FILES.items():
        r = parse_file(name, cfg)
        allrows.extend(r)
        vals = [x['value_inr_per_sqm'] for x in r]
        print('%-9s rows=%4d  per-sqm range %s-%s  (per-sqft %s-%s)' % (
            name, len(r),
            min(vals) if vals else '-', max(vals) if vals else '-',
            round(min(vals)/SQM_TO_SQFT) if vals else '-',
            round(max(vals)/SQM_TO_SQFT) if vals else '-'))
    io.open(OUT, 'w', encoding='utf-8').write(json.dumps(allrows, ensure_ascii=False, indent=1))
    print('wrote', OUT, 'total', len(allrows))
    # eyeball: Anekal p14 (known answer)
    print('\n--- Anekal p14 sample ---')
    for x in allrows:
        if x['sro'] == 'Anekal' and x['page'] == 14:
            print('  %3d %-46s sqm=%-6d sqft=%-7.0f %s' % (
                x['sl_no'], x['locality'][:46], x['value_inr_per_sqm'],
                x['value_inr_per_sqft'], x['land_use_type']))


main()
