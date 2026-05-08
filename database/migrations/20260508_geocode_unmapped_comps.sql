-- 20260508_geocode_unmapped_comps.sql
-- =============================================================================
-- Bulk-geocode unmapped comps using Bengaluru locality centroids.
-- =============================================================================
--
-- Why this migration exists:
--   The comps seeded in April 2026 (PR #103) carry lat/lng. The comps added
--   in PR #163 (30 named premium projects from GBA Q1 2026) and PR #165 (27
--   GBA Table 3 baskets) shipped with lat=NULL/lng=NULL because the source
--   docx didn't include precise coordinates.
--
--   Result: ~57 comps don't appear on the Comps page map, even though they
--   have a known `locality` value. Map UX feels broken — the table shows 80+
--   rows but the marker count stops at the 21 originally-geocoded ones.
--
-- What this fixes:
--   Sets lat/lng on every NULL-coordinate comp where `locality` matches a known
--   Bengaluru micro-market. We use centroid coordinates (not project-specific)
--   so multiple Whitefield comps will cluster at the same pin — but that's
--   fine: zoom in and the user can read the table side panel for project-level
--   detail. Future PR will replace centroids with Google Geocoding API hits
--   per project name once we wire that backend script.
--
-- Idempotent: only updates rows where lat IS NULL OR lng IS NULL.
--
-- Coverage: 30 Bengaluru localities + 6 outer GBA clusters (Devanahalli,
-- Doddaballapur, Hoskote, Bidadi, Nelamangala, Anekal). If `locality` doesn't
-- match any centroid, the row stays NULL and is gracefully omitted from the
-- map (existing behaviour).

BEGIN;

UPDATE public.comps
SET lat = sub.lat,
    lng = sub.lng,
    updated_at = NOW()
FROM (
  VALUES
    -- ── East Bengaluru (Whitefield / ITPL / Marathahalli / ORR-East) ────
    ('Whitefield',                    12.9698, 77.7499),
    ('Brookefield',                   12.9712, 77.7280),
    ('Kadugodi',                      12.9939, 77.7610),
    ('Varthur',                       12.9412, 77.7416),
    ('Marathahalli',                  12.9591, 77.6974),
    ('Marathahalli Junction',         12.9569, 77.7011),
    ('AECS Layout Marathahalli',      12.9501, 77.7079),
    ('Indiranagar 100 Feet Road',     12.9784, 77.6408),
    ('Indiranagar',                   12.9719, 77.6412),
    ('Defence Colony Indiranagar',    12.9785, 77.6416),
    ('CV Raman Nagar',                12.9888, 77.6629),

    -- ── North Bengaluru (Hebbal / Manyata / Airport corridor) ───────────
    ('Hebbal',                        13.0450, 77.5948),
    ('Hebbal Kempapura',              13.0537, 77.6021),
    ('Thanisandra',                   13.0608, 77.6219),
    ('Bellary Road',                  13.0560, 77.5901),
    ('Bhartiya City',                 13.0668, 77.6101),
    ('Yelahanka',                     13.1007, 77.5963),
    ('Yelahanka New Town',            13.1132, 77.5846),
    ('Devanahalli',                   13.2469, 77.7079),
    ('Hennur Main Road',              13.0395, 77.6437),
    ('Hennur Bagalur Main Road',      13.0633, 77.6566),
    ('Bagalur',                       13.1395, 77.6648),
    ('Tumkur Road',                   13.0254, 77.5247),

    -- ── CBD / Off-CBD / Premium central ─────────────────────────────────
    ('MG Road',                       12.9756, 77.6068),
    ('Brigade Road',                  12.9722, 77.6064),
    ('Commercial Street',             12.9818, 77.6097),
    ('Vittal Mallya Road',            12.9706, 77.5963),
    ('Residency Road',                12.9701, 77.6037),
    ('Millers Road',                  12.9871, 77.6020),
    ('Shivajinagar',                  12.9858, 77.6042),
    ('Lavelle Road',                  12.9707, 77.5938),

    -- ── South Bengaluru (Inner premium + Bannerghatta) ──────────────────
    ('Koramangala',                   12.9352, 77.6245),
    ('Koramangala 1st Block',         12.9332, 77.6133),
    ('Koramangala 80 Feet Road',      12.9374, 77.6271),
    ('HSR Layout',                    12.9080, 77.6476),
    ('HSR Layout 27th Main',          12.9099, 77.6444),
    ('BTM Layout',                    12.9166, 77.6101),
    ('Jayanagar',                     12.9279, 77.5836),
    ('Jayanagar 4th Block, 11th Main', 12.9292, 77.5832),
    ('Sampige Road, Malleshwaram',    13.0035, 77.5717),
    ('JP Nagar',                      12.9073, 77.5801),
    ('Bannerghatta Road',             12.8857, 77.5970),
    ('Bannerghatta Main Road',        12.8857, 77.5970),
    ('Begur',                         12.8634, 77.6195),
    ('Banashankari',                  12.9252, 77.5466),
    ('Kanakapura Road',               12.8839, 77.5500),

    -- ── South-East (ORR tech belt) ─────────────────────────────────────
    ('Bellandur',                     12.9293, 77.6781),
    ('Marathahalli-Sarjapur ORR',     12.9234, 77.6953),
    ('Sarjapur Road',                 12.8806, 77.6890),
    ('Panathur',                      12.9534, 77.7046),
    ('Outer Ring Road',               12.9293, 77.6781),

    -- ── West / North-West (Established city) ───────────────────────────
    ('Rajajinagar',                   12.9907, 77.5556),
    ('Rajajinagar 1st Block',         12.9920, 77.5547),
    ('Malleshwaram',                  13.0035, 77.5640),
    ('Vijayanagar',                   12.9728, 77.5360),
    ('Kamanahalli Main Road',         13.0156, 77.6403),
    ('New BEL Road',                  13.0353, 77.5583),

    -- ── Far South (Electronic City / Hosur Road / Mysore Road) ──────────
    ('Electronic City',               12.8395, 77.6770),
    ('Electronic City Phase 1',       12.8458, 77.6614),
    ('Electronic City Phase 2',       12.8310, 77.6700),
    ('Hosur Road',                    12.8950, 77.6240),
    ('Mysore Road',                   12.9492, 77.5210),
    ('Bommasandra',                   12.8128, 77.6962),

    -- ── Outer GBA (Industrial / logistics belts) ───────────────────────
    ('Hoskote',                       13.0683, 77.7937),
    ('Doddaballapur',                 13.2945, 77.5379),
    ('Bidadi',                        12.7976, 77.3805),
    ('Nelamangala',                   13.1011, 77.3935),
    ('Anekal',                        12.7110, 77.6964),
    ('Peenya',                        13.0292, 77.5232),
    ('Narsapura',                     13.1456, 78.0117),
    ('Jigani',                        12.7757, 77.6298),
    ('Attibele',                      12.7836, 77.7693)
) AS sub(locality, lat, lng)
WHERE comps.organization_id = 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b'
  AND comps.city = 'Bengaluru'
  AND comps.locality = sub.locality
  AND (comps.lat IS NULL OR comps.lng IS NULL);

-- Sanity check: how many rows still have NULL coordinates after this update?
-- Run after applying:
--   SELECT locality, COUNT(*) FROM comps
--   WHERE city = 'Bengaluru' AND (lat IS NULL OR lng IS NULL)
--   GROUP BY locality ORDER BY COUNT(*) DESC;
-- Anything still NULL is a locality the centroid table doesn't cover; add it
-- here in a follow-up migration.

COMMIT;
