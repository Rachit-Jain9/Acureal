-- 20260508_geocode_basket_localities.sql
-- =============================================================================
-- Geocode the 25 GBA basket / premium comps with descriptive locality strings
-- that didn't match the centroid lookup in PR #167.
-- =============================================================================
--
-- PR #167 mapped 65 simple Bengaluru locality names ('Whitefield', 'Hebbal',
-- 'Marathahalli', etc.) to centroid coords. The PR #163 named premium comps
-- and PR #165 GBA baskets used DIFFERENT locality string conventions —
-- composite labels like "AECS Layout, Marathahalli" or "Marathahalli /
-- ORR-East" or "Indiranagar 100 Feet Road / 1st-12th Main" — none of which
-- exact-matched the simple-name lookup.
--
-- Result: 25 of 81 Bengaluru comps still have NULL lat/lng. When the user
-- clicks one in the table, the Comps map either stays stuck on the previous
-- selection or shows an ocean view (zoomed to a coordinate that no longer
-- has a marker).
--
-- This migration UPDATEs by pattern-match — pulling the canonical locality
-- name out of the composite label and applying the centroid coords. The
-- coords match the Bengaluru centroid table from PR #167.
--
-- Idempotent: only updates rows where lat OR lng is NULL.

BEGIN;

UPDATE public.comps
SET lat = sub.lat,
    lng = sub.lng,
    updated_at = NOW()
FROM (
  VALUES
    -- East Bengaluru
    ('AECS Layout, Marathahalli',                12.9501::NUMERIC, 77.7079::NUMERIC),
    ('Marathahalli / ORR-East',                  12.9591::NUMERIC, 77.6974::NUMERIC),
    ('Seegehalli / Whitefield',                  12.9784::NUMERIC, 77.7499::NUMERIC),
    ('KR Puram',                                 12.9888::NUMERIC, 77.6629::NUMERIC),

    -- South-East / ORR
    ('Bellandur / ORR-South',                    12.9293::NUMERIC, 77.6781::NUMERIC),
    ('Kadubeesanahalli / Bellandur ORR',         12.9396::NUMERIC, 77.6919::NUMERIC),
    ('Inner Sarjapur Road / Carmelaram',         12.8970::NUMERIC, 77.7037::NUMERIC),
    ('Ambalipura / Sarjapur-ORR junction',       12.9152::NUMERIC, 77.6743::NUMERIC),
    ('HSR Layout Sectors 1-7',                   12.9080::NUMERIC, 77.6476::NUMERIC),

    -- Off-Central / East premium
    ('Indiranagar 100 Feet Road / 1st-12th Main', 12.9784::NUMERIC, 77.6408::NUMERIC),
    ('Defence Colony / Indiranagar',             12.9785::NUMERIC, 77.6416::NUMERIC),

    -- South
    ('Koramangala 1st-8th Block',                12.9352::NUMERIC, 77.6245::NUMERIC),
    ('JP Nagar Phases 1-9',                      12.9073::NUMERIC, 77.5801::NUMERIC),
    ('Jayanagar 1st-9th Block',                  12.9279::NUMERIC, 77.5836::NUMERIC),
    ('Arekere / IIM-Bannerghatta corridor',      12.8857::NUMERIC, 77.5970::NUMERIC),
    ('Kanakapura Road / Metro Green Line',       12.8839::NUMERIC, 77.5500::NUMERIC),
    ('Electronic City / Hosur Road belt',        12.8395::NUMERIC, 77.6770::NUMERIC),

    -- North
    ('Hebbal / Nagavara / Bellary Road',         13.0450::NUMERIC, 77.5948::NUMERIC),
    ('Thanisandra Main Road / Manyata fringe',   13.0608::NUMERIC, 77.6219::NUMERIC),
    ('Hennur-Bagalur belt',                      13.0633::NUMERIC, 77.6566::NUMERIC),
    ('Yelahanka / Kogilu-Airport Road belt',     13.1007::NUMERIC, 77.5963::NUMERIC),
    ('Shettigere-Devanahalli airport corridor',  13.2469::NUMERIC, 77.7079::NUMERIC),

    -- North-West / West
    ('Yeshwanthpur',                             13.0254::NUMERIC, 77.5400::NUMERIC),
    ('Rajajinagar West',                         12.9907::NUMERIC, 77.5556::NUMERIC)
) AS sub(locality, lat, lng)
WHERE comps.organization_id = 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b'
  AND comps.city = 'Bengaluru'
  AND comps.locality = sub.locality
  AND (comps.lat IS NULL OR comps.lng IS NULL);

COMMIT;

-- Sanity check: SELECT COUNT(*) FROM comps WHERE city='Bengaluru' AND (lat IS NULL OR lng IS NULL);
-- Expected: 0 (was 25 before)
