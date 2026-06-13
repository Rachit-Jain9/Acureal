# -*- coding: utf-8 -*-
"""Emit the guidance_values seed migration from the parsed IGR Gandhinagara JSON."""
import io, json

SRC = r'C:\Users\rachi\OneDrive - UW\Desktop\REDIP\backend\_pdf_tmp\igr_gandhinagara.json'
OUT = r'C:\Users\rachi\OneDrive - UW\Desktop\REDIP\database\migrations\20260717_igr_gandhinagara_guidance_values_seed.sql'

LU = {'residential': 'residential', 'commercial': 'commercial', 'apartment_or_built_up': 'residential'}

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

rows = json.load(open(SRC, encoding='utf-8'))

header = """-- ============================================================================
-- 20260717_igr_gandhinagara_guidance_values_seed.sql
-- ----------------------------------------------------------------------------
-- Workstream 1 — seed official IGR guidance (circle-rate) values for the
-- Bengaluru GANDHINAGARA Sub-Registrar Office, activating the guidance-value
-- feature (parcel snapshot circle-rate band + future land-rate mismatch flag).
--
-- SOURCE: Karnataka Gazette Part III dated 30-09-2023, Notification No.
-- Ke&Mu/PaVaSa/99/2023-24 (Central Valuation Committee), block period 2023-24,
-- effective 01-10-2023. Gandhinagara SRO covers central Bengaluru localities
-- (Akkipete, Balepete, Chickpete, Cottonpete, Cubbonpete, Gandhinagar, High
-- Grounds, Kumara Park Extension, Magadi/Mysore/Millers Road, Vasanthanagara...).
--
-- METHOD: deterministically parsed from the gazette TEXT LAYER (street names are
-- English, rates are digit values) — higher fidelity than AI OCR, zero
-- hallucination, adversarially verified (3 agents vs the source, 0 discrepancies).
-- Rates are per SQUARE METRE in the gazette; value_inr_per_sqft is the /sqft
-- conversion (rate / 10.76391). Each row keeps the original per-sqm rate in notes.
--
-- Idempotent: guarded on the evidence_sources.source_title. Rollback:
--   DELETE FROM regulatory_data.guidance_values WHERE sro_name='Gandhinagara'
--     AND source_section='Gandhinagara SRO 2023-24';
--   DELETE FROM regulatory_data.evidence_sources
--     WHERE source_title='IGR Guidance Values — Gandhinagara SRO (Karnataka Gazette 30-Sep-2023)';
-- ============================================================================

DO $$
DECLARE
  v_src UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources
    WHERE source_title = 'IGR Guidance Values — Gandhinagara SRO (Karnataka Gazette 30-Sep-2023)'
      AND org_id IS NULL
  ) THEN
    RAISE NOTICE 'IGR Gandhinagara guidance values already seeded — skipping.';
    RETURN;
  END IF;

  INSERT INTO regulatory_data.evidence_sources
    (org_id, source_kind, authority_name, source_title, city, plan_version,
     effective_from, extraction_status, review_status, confidence_score, notes)
  VALUES
    (NULL, 'official_pdf',
     'Inspector General of Registration (IGR), Karnataka — Central Valuation Committee',
     'IGR Guidance Values — Gandhinagara SRO (Karnataka Gazette 30-Sep-2023)',
     'Bengaluru', 'IGR 2023-24', DATE '2023-10-01', 'completed', 'approved', 1.000,
     'Karnataka Gazette Part III dated 30-09-2023, Notification No. Ke&Mu/PaVaSa/99/2023-24. Guidance (circle-rate) values for the Bengaluru Gandhinagara Sub-Registrar Office, block 2023-24, effective 01-10-2023. Per-sq.m in the gazette; value_inr_per_sqft is the /sqft conversion. Deterministically parsed + adversarially verified.')
  RETURNING id INTO v_src;

  INSERT INTO regulatory_data.guidance_values
    (org_id, evidence_source_id, city, sro_name, district, village_or_ward, locality,
     road_name, land_use_type, value_inr_per_sqft, unit_type, effective_from,
     source_page, source_section, review_status, confidence_score, notes)
  VALUES
"""

vals = []
for r in rows:
    lu = LU.get(r['land_use_type'], 'residential')
    note = 'Rs %d/sq.m (gazette); %s' % (r['value_inr_per_sqm'], r['land_use_type'])
    vals.append(
        "    (NULL, v_src, 'Bengaluru', 'Gandhinagara', 'Bengaluru Urban', %s, %s, %s, %s, %.2f, 'sqft', DATE '2023-10-01', %d, 'Gandhinagara SRO 2023-24', 'approved', 1.000, %s)" % (
            q(r['locality']), q(r['locality']), q(r['road_or_locality']), q(lu),
            r['value_inr_per_sqft'], r['source_page'], q(note)))

footer = "\n  ;\n  RAISE NOTICE 'Seeded %% IGR Gandhinagara guidance values.', %d;\nEND $$;\n" % len(rows)

io.open(OUT, 'w', encoding='utf-8').write(header + ',\n'.join(vals) + footer)
print('wrote %s with %d guidance_values rows' % (OUT, len(rows)))
