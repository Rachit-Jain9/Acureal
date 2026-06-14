# -*- coding: utf-8 -*-
"""
Assemble the final Anekal/Attibele/Jigani guidance rows and emit one idempotent
seed migration.

Final clean set =
  (a) the cross-checked rows (deterministic value AND the independent vision
      read agreed) from igr_anekal_merged.json, PLUS
  (b) the adjudicated discrepancy rows from the resolution pass, keeping only
      category == 'developed_land' (agricultural / apartment / other dropped).

Per-sq.m -> per-sqft via /10.76391. Rows are written with sro_name + district +
city='Bengaluru' (so the guidance matcher's city filter — which keys on the
property's city, 'Bengaluru' for the Anekal-belt deals — resolves them).
"""
import io, os, json, re

TMP = r'C:\Users\rachi\OneDrive - UW\Desktop\REDIP\backend\_pdf_tmp'
MERGED = os.path.join(TMP, 'igr_anekal_merged.json')
RESOLUTION = os.path.join(TMP, 'igr_resolution.json')
OUT = r'C:\Users\rachi\OneDrive - UW\Desktop\REDIP\database\migrations\20260718_igr_anekal_belt_guidance_values_seed.sql'

SQM_TO_SQFT = 10.76391041671

SRO_META = {
    'Anekal':   {'district': 'Bengaluru Urban',
                 'title': 'IGR Guidance Values — Anekal SRO (Karnataka Gazette, block 2023-24)',
                 'desc': 'Anekal Sub-Registrar Office, Anekal taluk, Bengaluru Urban district.'},
    'Attibele': {'district': 'Bengaluru Urban',
                 'title': 'IGR Guidance Values — Attibele SRO (Karnataka Gazette, block 2023-24)',
                 'desc': 'Attibele Sub-Registrar Office, Anekal taluk, Bengaluru Urban district.'},
    'Jigani':   {'district': 'Bengaluru Urban',
                 'title': 'IGR Guidance Values — Jigani SRO (Karnataka Gazette, block 2023-24)',
                 'desc': 'Jigani Sub-Registrar Office, Anekal taluk, Bengaluru Urban district. (Source PDF began at Sl.No 30; earlier items not present in the supplied extract.)'},
}


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def clean_name(s):
    s = (s or '').replace('&amp;', '&').strip()
    return ' '.join(s.split())


def split_name_road(s):
    """Strip PID/Sy/Survey-number boilerplate from the locality (it dilutes the
    trigram match + breaks the substring boost), and lift a trailing
    "(... Road)" qualifier into road_name (which the matcher boosts on).
    Meaningful landmark parentheticals are kept on the locality."""
    s = clean_name(s)
    # drop PID / Survey-number parentheticals entirely (kept in notes)
    s = re.sub(r'\s*\((?:PID|Sy|Survey)[^)]*\)?', '', s, flags=re.I)
    s = re.sub(r'\s*\(\s*$', '', s)  # dangling open paren left by a truncated PID
    road = None
    m = re.search(r'\(([^)]*\bRoad\b[^)]*)\)\s*$', s, flags=re.I)
    if m:
        road = ' '.join(m.group(1).split())
        s = s[:m.start()].strip()
    s = ' '.join(s.split()).strip(' ,;-')
    return s, road


def main():
    merged = json.load(open(MERGED, encoding='utf-8'))
    resdoc = json.load(open(RESOLUTION, encoding='utf-8'))
    res_pages = resdoc.get('resolved', resdoc) if isinstance(resdoc, dict) else resdoc

    # Base: cross-checked rows only.
    final = {}
    for r in merged['rows']:
        if r.get('value_cross_checked'):
            loc, road = split_name_road(r['locality'])
            final[(r['sro'], r['sl_no'])] = {
                'sro': r['sro'], 'sl_no': r['sl_no'], 'page': r['page'],
                'locality': loc, 'road_name': road, 'full_name': clean_name(r['locality']),
                'value_inr_per_sqm': r['value_inr_per_sqm'],
                'land_use_type': r['land_use_type'],
            }

    # need page lookup for resolution rows (resolution carries sro+page)
    dropped, added, overridden = 0, 0, 0
    for pg in res_pages:
        sro, page = pg['sro'], pg['page']
        for it in pg.get('resolutions', []):
            key = (sro, int(it['sl_no']))
            cat = it.get('category')
            if cat == 'developed_land' and it.get('value_inr_per_sqm'):
                if key in final:
                    overridden += 1
                else:
                    added += 1
                loc, road = split_name_road(it.get('locality_english'))
                final[key] = {
                    'sro': sro, 'sl_no': int(it['sl_no']), 'page': page,
                    'locality': loc, 'road_name': road, 'full_name': clean_name(it.get('locality_english')),
                    'value_inr_per_sqm': int(it['value_inr_per_sqm']),
                    'land_use_type': it.get('land_use_type') or 'residential',
                }
            else:
                if key in final:
                    final.pop(key)
                    dropped += 1

    rows = sorted(final.values(), key=lambda x: (x['sro'], x['sl_no']))
    # drop any blank/short names defensively
    rows = [r for r in rows if r['locality'] and len(r['locality']) >= 2 and r['value_inr_per_sqm'] >= 1000]

    by_sro = {}
    for r in rows:
        by_sro.setdefault(r['sro'], []).append(r)

    # ---- emit migration ----
    out = []
    out.append("""-- ============================================================================
-- 20260718_igr_anekal_belt_guidance_values_seed.sql
-- ----------------------------------------------------------------------------
-- Workstream 1 (cont.) — seed official IGR guidance (circle-rate) values for the
-- ANEKAL-belt Sub-Registrar Offices: ANEKAL, ATTIBELE, JIGANI (block 2023-24).
-- These cover the operator's live Anekal-belt deals (Jigani, Attibele, Anekal/
-- Gattahalli), activating the parcel circle-rate band + the land-rate-below-
-- guidance flag for those areas.
--
-- SOURCE: Karnataka IGR (Central Valuation Committee) guidance-value gazettes,
-- block period 2023-24, for the Anekal / Attibele / Jigani SROs (Anekal taluk,
-- Bengaluru Urban district). Rates for developed residential / villa / row-house
-- SITES are PER SQUARE METRE (confirmed from the gazette column sub-headers
-- "per square metre, in Rupees"); value_inr_per_sqft = rate / 10.76391.
--
-- METHOD (deterministic numbers + verified names): the per-sq.m value for each
-- row was extracted DETERMINISTICALLY from the ruled table's column position
-- (the developed-land columns C4-C6; the agricultural per-acre column C7 and the
-- apartment column C8 were excluded by position + magnitude). The English
-- locality names were read from the rendered pages and cross-checked against the
-- deterministic value (96%+ agreement); every disagreeing row was individually
-- re-adjudicated against the source page. No hallucinated numbers.
--
-- city='Bengaluru' so the guidance matcher (which keys on the property city,
-- 'Bengaluru' for these deals) resolves them; district + sro_name disambiguate.
--
-- Idempotent: guarded per-SRO on evidence_sources.source_title. Rollback:
--   DELETE FROM regulatory_data.guidance_values
--     WHERE sro_name IN ('Anekal','Attibele','Jigani')
--       AND source_section = 'IGR Anekal-belt SRO 2023-24';
--   DELETE FROM regulatory_data.evidence_sources
--     WHERE source_title LIKE 'IGR Guidance Values — % SRO (Karnataka Gazette, block 2023-24)';
-- ============================================================================
""")

    for sro, srows in by_sro.items():
        meta = SRO_META[sro]
        out.append("DO $$\nDECLARE\n  v_src UUID;\nBEGIN")
        out.append("  IF EXISTS (SELECT 1 FROM regulatory_data.evidence_sources WHERE source_title = %s AND org_id IS NULL) THEN" % q(meta['title']))
        out.append("    RAISE NOTICE 'IGR %s guidance values already seeded — skipping.';" % sro)
        out.append("    RETURN;\n  END IF;")
        out.append("""  INSERT INTO regulatory_data.evidence_sources
    (org_id, source_kind, authority_name, source_title, city, plan_version,
     effective_from, extraction_status, review_status, confidence_score, notes)
  VALUES
    (NULL, 'official_pdf',
     'Inspector General of Registration (IGR), Karnataka — Central Valuation Committee',
     %s, 'Bengaluru', 'IGR 2023-24', DATE '2023-10-01', 'completed', 'approved', 1.000,
     %s)
  RETURNING id INTO v_src;""" % (q(meta['title']),
        q('Karnataka IGR guidance-value gazette, block 2023-24. ' + meta['desc']
          + ' Developed-land site rates per sq.m; value_inr_per_sqft is the /sqft conversion. '
          + 'Deterministic column-position value extraction + verified locality names.')))
        out.append("""  INSERT INTO regulatory_data.guidance_values
    (org_id, evidence_source_id, city, sro_name, district, village_or_ward, locality,
     road_name, land_use_type, value_inr_per_sqft, unit_type, effective_from,
     source_page, source_section, review_status, confidence_score, notes)
  VALUES""")
        vals = []
        for r in srows:
            sqft = round(r['value_inr_per_sqm'] / SQM_TO_SQFT, 2)
            note = 'Rs %d/sq.m (gazette); %s' % (r['value_inr_per_sqm'], r['full_name'])
            road_sql = q(r['road_name']) if r.get('road_name') else 'NULL'
            vals.append("    (NULL, v_src, 'Bengaluru', %s, %s, %s, %s, %s, %s, %.2f, 'sqft', DATE '2023-10-01', %d, 'IGR Anekal-belt SRO 2023-24', 'approved', 1.000, %s)" % (
                q(sro), q(meta['district']), q(sro), q(r['locality']),
                road_sql, q(r['land_use_type']), sqft, r['page'], q(note)))
        out.append(',\n'.join(vals) + ";")
        out.append("  RAISE NOTICE 'Seeded %% IGR %s guidance values.', %d;\nEND $$;\n" % (sro, len(srows)))

    io.open(OUT, 'w', encoding='utf-8').write('\n'.join(out))
    print('FINAL rows: %d  (added %d, overridden %d, dropped %d)' % (len(rows), added, overridden, dropped))
    print('by sro:', {s: len(v) for s, v in by_sro.items()})
    print('land_use:', {u: sum(1 for r in rows if r['land_use_type'] == u) for u in ['residential', 'commercial', 'industrial']})
    sqfts = [round(r['value_inr_per_sqm'] / SQM_TO_SQFT) for r in rows]
    print('per-sqft range: %d - %d' % (min(sqfts), max(sqfts)))
    print('wrote', OUT)


main()
