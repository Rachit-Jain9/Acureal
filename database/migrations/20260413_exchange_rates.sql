-- Migration: Exchange rates table for daily FX auto-updates
-- Date: 2026-04-13
-- Purpose: Stage 5 — remove manual FX entry; rates auto-refresh daily.
--          INR is the canonical platform currency. Conversions are display-only.

CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  base_currency CHAR(3) NOT NULL,         -- e.g. 'INR'
  quote_currency CHAR(3) NOT NULL,        -- e.g. 'USD', 'AED', 'SGD'
  rate DECIMAL(20, 8) NOT NULL,           -- units of quote per 1 base (INR→USD = ~0.012)
  source VARCHAR(50) NOT NULL,            -- 'exchangerate_host', 'open_exchange_rates', 'manual'
  effective_date DATE NOT NULL,           -- the business day this rate applies to
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  freshness_status VARCHAR(20) NOT NULL DEFAULT 'fresh',  -- 'fresh', 'stale', 'fallback'
  fetch_error TEXT,                       -- non-null when last fetch failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Composite unique index: one rate per base/quote pair per effective date
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_rates_unique
  ON exchange_rates(base_currency, quote_currency, effective_date);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
  ON exchange_rates(base_currency, quote_currency, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_date
  ON exchange_rates(effective_date DESC);

-- FX fetch log for debugging and audit
CREATE TABLE IF NOT EXISTS exchange_rate_fetch_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fetch_date DATE NOT NULL,
  source VARCHAR(50) NOT NULL,
  success BOOLEAN NOT NULL,
  currencies_updated INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fx_fetch_log_date ON exchange_rate_fetch_log(fetch_date DESC);

-- Seed current approximate rates (INR base) as a safe starting point.
-- These will be overwritten by the daily fetch job.
-- Rates approximate as of 2026-04: 1 INR ≈ rates below
INSERT INTO exchange_rates (base_currency, quote_currency, rate, source, effective_date, freshness_status)
VALUES
  ('INR', 'USD', 0.01195,  'seed', '2026-04-13', 'stale'),
  ('INR', 'EUR', 0.01102,  'seed', '2026-04-13', 'stale'),
  ('INR', 'GBP', 0.00941,  'seed', '2026-04-13', 'stale'),
  ('INR', 'AED', 0.04388,  'seed', '2026-04-13', 'stale'),
  ('INR', 'SGD', 0.01611,  'seed', '2026-04-13', 'stale'),
  ('INR', 'JPY', 1.79200,  'seed', '2026-04-13', 'stale'),
  ('INR', 'AUD', 0.01876,  'seed', '2026-04-13', 'stale'),
  ('INR', 'CAD', 0.01658,  'seed', '2026-04-13', 'stale')
ON CONFLICT (base_currency, quote_currency, effective_date) DO NOTHING;

COMMENT ON TABLE exchange_rates IS 'Daily FX rates with INR as canonical base. Refreshed by the /api/fx/refresh endpoint or scheduled job.';
COMMENT ON COLUMN exchange_rates.rate IS '1 unit of base_currency expressed in quote_currency';
COMMENT ON COLUMN exchange_rates.freshness_status IS 'fresh = fetched today; stale = older than 1 business day; fallback = using prior day rate because provider unavailable';
