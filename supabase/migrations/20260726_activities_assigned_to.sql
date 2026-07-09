-- Activity assignment: "who should do this" on a logged activity.
-- Distinct from performed_by (who logged it) and completed_by (who closed it):
-- assigned_to is the owner of the follow-through. Nullable — most activities
-- are plain log entries; assignment is opt-in from the Log Activity form.
--
-- Idempotent: safe to re-run.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_activities_assigned_to ON activities(assigned_to);

COMMENT ON COLUMN activities.assigned_to IS
  'Workspace member responsible for following through on this activity (nullable; set from the Log Activity form).';
