-- Migration: Drop the exchange_rates + exchange_rate_fetch_log tables.
-- Date: 2026-06-13
-- Purpose: The multi-currency display feature was retired 2026-05-24.
--          REDIP is India-only; every value is shown in INR Crores. The
--          tables originally created by 20260413_exchange_rates.sql no
--          longer have any reader — both the /api/fx route and its
--          service were deleted, and the frontend Settings card +
--          formatCrores conversion path are gone too.
--
-- Idempotent. Safe to re-run; uses IF EXISTS.

DROP TABLE IF EXISTS exchange_rate_fetch_log;
DROP TABLE IF EXISTS exchange_rates;
