-- Schema alignment for existing databases
-- Adds documents.updated_at and extends RLS coverage to newer deal-centric tables.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE IF EXISTS documents
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

UPDATE documents
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_documents_updated_at'
  ) THEN
    CREATE TRIGGER update_documents_updated_at
      BEFORE UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE IF EXISTS market_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS micro_market_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dd_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS approval_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS risk_flags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.market_transactions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "market_transactions_select_all" ON market_transactions';
    EXECUTE 'CREATE POLICY "market_transactions_select_all" ON market_transactions FOR SELECT USING (true)';
  END IF;

  IF to_regclass('public.micro_market_benchmarks') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "micro_market_benchmarks_select_all" ON micro_market_benchmarks';
    EXECUTE 'CREATE POLICY "micro_market_benchmarks_select_all" ON micro_market_benchmarks FOR SELECT USING (true)';
  END IF;

  IF to_regclass('public.document_extractions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "document_extractions_select_all" ON document_extractions';
    EXECUTE 'CREATE POLICY "document_extractions_select_all" ON document_extractions FOR SELECT USING (true)';
  END IF;

  IF to_regclass('public.dd_items') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "dd_items_select_all" ON dd_items';
    EXECUTE 'CREATE POLICY "dd_items_select_all" ON dd_items FOR SELECT USING (true)';
  END IF;

  IF to_regclass('public.approval_items') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "approval_items_select_all" ON approval_items';
    EXECUTE 'CREATE POLICY "approval_items_select_all" ON approval_items FOR SELECT USING (true)';
  END IF;

  IF to_regclass('public.risk_flags') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "risk_flags_select_all" ON risk_flags';
    EXECUTE 'CREATE POLICY "risk_flags_select_all" ON risk_flags FOR SELECT USING (true)';
  END IF;
END $$;
