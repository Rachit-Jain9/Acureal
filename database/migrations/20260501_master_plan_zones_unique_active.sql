-- Prevent duplicate active master_plan_zones rows for the same
-- (zone_code, plan_version). Historical rows (effective_to IS NOT NULL)
-- are exempt so amendments and re-issues can coexist.
--
-- Today's incident: zone-library re-seed inserted a second row for every
-- zone code, doubling the count. Soft-deleted via effective_to manually;
-- this migration prevents recurrence at the database layer.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_plan_zones_active_code
  ON regulatory_data.master_plan_zones (zone_code, plan_version)
  WHERE effective_to IS NULL;
