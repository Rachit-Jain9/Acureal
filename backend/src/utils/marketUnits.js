'use strict';

// market_transactions.quantum_inr_mn is stored in INR millions
// (see database/migrations/20260404_market_data.sql). 1 Crore = 10 million,
// so Crore = millions / 10.
//
// This divisor lived inline in four places (Intelligence page, PDF tear-sheet,
// daily brief, IC memo) and silently diverged to /100, rendering every
// market-transaction quantum 10× too small. Centralised here so the conversion
// has a single source of truth and a test.
const MILLIONS_PER_CRORE = 10;

// INR millions → INR Crore. Returns null for non-numeric input so callers can
// render an em-dash / skip the row rather than print "NaN Cr".
function millionsToCr(mn) {
  if (mn === null || mn === undefined || mn === '') return null;
  const n = Number(mn);
  return Number.isFinite(n) ? n / MILLIONS_PER_CRORE : null;
}

// Compact "NNN Cr" label used by the brief / analysis / IC-memo payloads.
// Returns null for a falsy quantum (null/undefined/0/'') so the existing
// "show nothing when there's no value" behaviour is preserved.
function formatQuantumCr(mn) {
  if (!mn) return null;
  const cr = millionsToCr(mn);
  return cr == null ? null : `${cr.toFixed(0)} Cr`;
}

module.exports = { MILLIONS_PER_CRORE, millionsToCr, formatQuantumCr };
