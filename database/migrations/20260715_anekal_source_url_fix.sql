-- ============================================================================
-- 20260715_anekal_source_url_fix.sql
-- ----------------------------------------------------------------------------
-- The Anekal evidence source (seeded by 20260714) set source_url to the BMRDA
-- homepage 'https://www.bmrda.kar.in/', which does not resolve (DNS NXDOMAIN) —
-- so the citation drawer's "Open source" button errored.
--
-- The authoritative source for the Anekal rulebook is the operator-uploaded
-- primary PDF, not a public webpage. Null the URL: the drawer then shows the
-- fully page-cited reference (authority + table + page) without a broken
-- external link, and the "Open source" button degrades to the in-app
-- placeholder. (If the PDF is later uploaded as a viewable Master Plan document,
-- a signed in-app URL can be linked then.)
--
-- Idempotent, additive, reversible. Safe to re-run.
-- ============================================================================

UPDATE regulatory_data.evidence_sources
   SET source_url = NULL
 WHERE source_title = 'Anekal LPA Master Plan 2031 — Chapter 11/12: Zoning Regulations'
   AND org_id IS NULL;
