-- Enforce organization-scoped unique constraint on intelligence_briefs
-- This is required for the ON CONFLICT clause in getDailyBrief() to work correctly.

-- Drop the non-unique index if it exists, then create a UNIQUE index
DROP INDEX IF EXISTS idx_intelligence_briefs_org_date_scope;

CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_briefs_org_date_scope
  ON intelligence_briefs (organization_id, brief_date, market_scope);

-- Also ensure market_notes has a unique constraint for the ON CONFLICT in saveMarketNotes()
DROP INDEX IF EXISTS idx_market_notes_org_section;

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_notes_org_section
  ON market_notes (organization_id, section);
