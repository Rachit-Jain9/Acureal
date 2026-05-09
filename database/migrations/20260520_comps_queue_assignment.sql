-- ============================================================================
-- 0066 — comps_review_queue assignment columns
-- ============================================================================
-- Adds assigned_to + assigned_at + assigned_by to the queue so analysts can
-- distribute incoming broker quotes / IPC reports across the team instead of
-- everyone fighting over the same Pending Review tray.
--
-- Wired by:
--   • POST /api/comps-review-queue/bulk/reassign (compsReviewQueue.routes)
--   • CompsQueuePage bulk action bar "Reassign" button
--   • CompsQueueDetailPage assignee badge (follow-up PR)
--
-- Why nullable: every existing row is currently unassigned. Backfilling to
-- a single user would be wrong — there's no historical record of who picked
-- up which row when this column didn't exist.
--
-- Behavior contract (enforced at the application layer, not the DB):
--   • Only rows in status=pending_review or pending_extraction can be
--     reassigned. Terminal states (committed/rejected) reject the bulk
--     reassign with a 409.
--   • Setting assigned_to = NULL is "unassign" — a valid operation.
--
-- Idempotent: every operation guarded by IF NOT EXISTS / DROP IF EXISTS.
-- ============================================================================

BEGIN;

ALTER TABLE public.comps_review_queue
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.comps_review_queue
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

ALTER TABLE public.comps_review_queue
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Index supports the common "show me my queue" filter on the queue page.
-- Partial index keeps it small — terminal rows (committed/rejected) never
-- need to be queried by assignee.
CREATE INDEX IF NOT EXISTS comps_review_queue_assigned_to_idx
  ON public.comps_review_queue (assigned_to, status, created_at DESC)
  WHERE status IN ('pending_review', 'pending_extraction', 'extracting', 'approved', 'failed');

COMMENT ON COLUMN public.comps_review_queue.assigned_to IS
  'User responsible for reviewing this queue row. NULL = unassigned (default). '
  'Mutated via POST /api/comps-review-queue/bulk/reassign.';
COMMENT ON COLUMN public.comps_review_queue.assigned_at IS
  'Timestamp when assigned_to was last set (or unset → NULL).';
COMMENT ON COLUMN public.comps_review_queue.assigned_by IS
  'Who performed the most recent (re)assignment. Useful for audit; not enforced.';

COMMIT;

-- ── Verification (run after applying) ───────────────────────────────────────
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name = 'comps_review_queue'
--    AND column_name IN ('assigned_to', 'assigned_at', 'assigned_by');
-- Expect 3 rows, all is_nullable = YES.
