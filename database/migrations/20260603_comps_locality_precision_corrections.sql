-- 20260603_comps_locality_precision_corrections.sql
--
-- Corrects the `locality` text on 5 comps whose lat/lng pins were
-- upgraded to rooftop precision by tonight's run of
-- scripts/upgrade-comps-geocoding.mjs (PR #221 / 2026-05-18). The
-- script's --apply mode updates lat/lng + geocode_quality but
-- INTENTIONALLY does not auto-rewrite the locality string — that
-- field is operator-curated and changing it can affect downstream
-- benchmarks/filters that group by locality. The script flagged the
-- 5 mismatches; this migration commits the precise sub-locality
-- names the operator approved on 2026-05-18.
--
-- Before               → After
-- ─────────────────────────────────────────────────────────────────
-- KR Puram             → Krishnarajapuram  (Sobha Lake Gardens)
-- Devanahalli (taluk)  → Navarathna Agrahara (Embassy Verde)
-- Mysore Road (road)   → Kambipura          (Brigade Horizon)
-- Devanahalli (taluk)  → Yerthiganahalli    (Godrej MSR City)
-- Shettigere-Devanahalli airport corridor → Yerthiganahalli
--                        (Birla Trimaya / Godrej MSR City — same pin
--                         as Godrej MSR City, same project)
--
-- Idempotent — each UPDATE filters on both `id` AND the original
-- locality value, so re-runs after the fix is in place are no-ops.
-- No row count enforcement (zero-rows-updated on a re-run is fine).
--
-- No locality groups are split or consolidated in a breaking way:
-- the target localities (Krishnarajapuram, Navarathna Agrahara,
-- Kambipura, Yerthiganahalli) do not exist as separate groups in
-- public.comps yet; the source localities (KR Puram, Devanahalli,
-- Mysore Road, Shettigere-Devanahalli airport corridor) had only
-- the affected rows in them OR retain other rows that are
-- legitimately at the source granularity.
--
-- Apply via:
--   Supabase SQL editor — paste this file's contents — preferred
--   OR psql "$DATABASE_URL" -f database/migrations/20260603_comps_locality_precision_corrections.sql

BEGIN;

-- Sobha Lake Gardens — KR Puram → Krishnarajapuram
-- (Naming normalisation; same place, full vs abbreviated spelling)
UPDATE public.comps
   SET locality   = 'Krishnarajapuram',
       updated_at = NOW()
 WHERE id = 'aa334a44-0efe-4faf-9d43-9041510d1b74'
   AND locality <> 'Krishnarajapuram';

-- Embassy Verde — Devanahalli (taluk) → Navarathna Agrahara (village)
-- Pin: 13.2073, 77.6151
UPDATE public.comps
   SET locality   = 'Navarathna Agrahara',
       updated_at = NOW()
 WHERE id = '107c58e8-c9a7-4eb4-9549-2acda96e46f1'
   AND locality <> 'Navarathna Agrahara';

-- Brigade Horizon — Mysore Road (arterial label) → Kambipura (village)
-- Pin: 12.8855, 77.4535
UPDATE public.comps
   SET locality   = 'Kambipura',
       updated_at = NOW()
 WHERE id = '348452dc-1d57-4965-9a24-a24f4bc95622'
   AND locality <> 'Kambipura';

-- Godrej MSR City — Devanahalli (taluk) → Yerthiganahalli (village)
-- Pin: 13.1941, 77.6599
UPDATE public.comps
   SET locality   = 'Yerthiganahalli',
       updated_at = NOW()
 WHERE id = '48e8159a-9874-48d2-be57-c8fc46289a03'
   AND locality <> 'Yerthiganahalli';

-- Birla Trimaya / Godrej MSR City — same pin as Godrej MSR City
-- (same project, joint-venture branding) → Yerthiganahalli
UPDATE public.comps
   SET locality   = 'Yerthiganahalli',
       updated_at = NOW()
 WHERE id = '5123c115-3f5b-4ade-90d2-56a42d574b93'
   AND locality <> 'Yerthiganahalli';

-- Verification — should show all 5 with the new locality + rooftop quality.
SELECT id,
       project_name,
       locality,
       lat,
       lng,
       geocode_quality,
       updated_at::date AS last_updated
  FROM public.comps
 WHERE id IN (
         'aa334a44-0efe-4faf-9d43-9041510d1b74',
         '107c58e8-c9a7-4eb4-9549-2acda96e46f1',
         '348452dc-1d57-4965-9a24-a24f4bc95622',
         '48e8159a-9874-48d2-be57-c8fc46289a03',
         '5123c115-3f5b-4ade-90d2-56a42d574b93'
       )
 ORDER BY project_name;

COMMIT;
