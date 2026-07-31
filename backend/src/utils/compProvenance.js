'use strict';

/**
 * Deterministic comp-provenance deriver (2026-06-25).
 *
 * Acureal hard rule (CLAUDE.md): "Never expose unverified market intelligence or
 * comps as authoritative. Always surface source, freshness, and confidence
 * level — or 'No verified feed available.'"
 *
 * This module turns the raw provenance columns a `comps` row carries
 * (`data_type`, `source`, `source_url`, `is_verified`, `as_of_date`,
 * `updated_at`) into a small, honest, presentation-ready descriptor that BOTH
 * the server-side exports (DOCX / PPTX / XLSX / reportPack) and the in-app React
 * surfaces render — so a comp reads identically everywhere. A byte-for-byte twin
 * lives at `frontend/src/utils/compProvenance.js`; keep the bucket logic in sync.
 *
 * Honesty constraints baked in here:
 *   - NO fabricated confidence number. "Confidence" is expressed ONLY as the
 *     (verified × source-type) pair — an ordinal a reader can judge — never a %.
 *   - Verification comes ONLY from the raw `is_verified === true`. A null/absent
 *     flag is NEVER treated as verified (fixes the `is_verified === false ? 'No'
 *     : 'Yes'` overclaim that read null as "Yes").
 *   - Freshness prefers `as_of_date` (the date the market data is current AS OF —
 *     the one truthful currency signal), then a period encoded in `data_type`
 *     (e.g. "Q1 2026"), then `updated_at` (last edit). It is NEVER labelled
 *     "verified <date>" — there is no verified_at column; updated_at is an edit
 *     time, not an observation/verification time.
 *   - Pure deterministic string matching — no LLM (CLAUDE.md: "Never use LLMs
 *     for ... rule-engine decisions").
 */

// Closed set of source categories. `tone` is a semantic hint the UI maps to a
// token; exports use `label` as plain text. Ordered loosely strongest→weakest.
const SOURCE_TYPES = {
  transaction: { key: 'transaction', label: 'Transaction', tone: 'positive' },
  research: { key: 'research', label: 'Research report', tone: 'premium' },
  internal: { key: 'internal', label: 'Internal benchmark', tone: 'accent' },
  listing: { key: 'listing', label: 'Listing', tone: 'info' },
  guidance: { key: 'guidance', label: 'Guidance value', tone: 'info' },
  other: { key: 'other', label: 'Other source', tone: 'neutral' },
  none: { key: 'none', label: 'No verified feed', tone: 'muted' },
};

// data_type prefixes are the authoritative signal when present (Acureal sets them
// at ingest). Checked before the free-text source heuristics.
const DATA_TYPE_RULES = [
  [/^ipc/i, 'research'],
  [/^internal/i, 'internal'],
  [/^listing/i, 'listing'],
  [/^transaction|^registry|^deed/i, 'transaction'],
  [/^guidance|^circle|^sro/i, 'guidance'],
];

// Free-text `source` keyword buckets — only consulted when data_type is absent.
// Ordered by specificity (a sale-deed string should win over a generic "report").
const SOURCE_KEYWORD_RULES = [
  [/sale deed|registr|kaveri|\bsro\b|sub.?regist|encumbrance|conveyance/i, 'transaction'],
  [/jll|knight frank|cbre|colliers|anarock|cushman|savills|propequity|\breport\b|research/i, 'research'],
  [/magicbricks|99\s?acres|housing\.com|nobroker|squareyards|square yards|proptiger|\blisting\b|portal/i, 'listing'],
  [/acureal|redip|internal|in.?house|\bdesk\b|benchmark/i, 'internal'],
  [/guidance value|circle rate|government|gazette|\bbbmp\b|\bbda\b|\bigr\b/i, 'guidance'],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Date-only / timestamp → "4 May 2026". UTC so a date-only column never drifts a
// day under a negative-offset server timezone.
const formatAbsoluteDate = (value) => {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
};

// Pull an honest period token out of a data_type slug, e.g.
// "ipc_q1_2026_..." → "Q1 2026"; "internal_benchmark_apr_2026" → "Apr 2026".
const extractPeriodToken = (dataType) => {
  if (!dataType || typeof dataType !== 'string') return null;
  const q = dataType.match(/q([1-4])[_-]?(\d{4})/i);
  if (q) return `Q${q[1]} ${q[2]}`;
  const m = dataType.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[_-]?(\d{4})/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1, 3).toLowerCase()} ${m[2]}`;
  return null;
};

const resolveSourceType = (comp) => {
  const dataType = typeof comp.data_type === 'string' ? comp.data_type.trim() : '';
  if (dataType) {
    for (const [re, key] of DATA_TYPE_RULES) {
      if (re.test(dataType)) return key;
    }
  }
  const source = typeof comp.source === 'string' ? comp.source.trim() : '';
  if (source) {
    for (const [re, key] of SOURCE_KEYWORD_RULES) {
      if (re.test(source)) return key;
    }
    return 'other'; // non-empty source that matched nothing known
  }
  // No data_type AND no source → genuinely unsourced.
  return 'none';
};

// Freshness: prefer the true "as of" observation date, then a data_type period,
// then last-edit. Returns { kind, label } where label is render-ready.
const resolveFreshness = (comp) => {
  const asOf = formatAbsoluteDate(comp.as_of_date);
  if (asOf) return { kind: 'as_of', label: `as of ${asOf}` };

  const period = extractPeriodToken(comp.data_type);
  if (period) return { kind: 'period', label: period };

  const updated = formatAbsoluteDate(comp.updated_at);
  if (updated) return { kind: 'updated', label: `updated ${updated}` };

  return { kind: null, label: null };
};

/**
 * @param {object} comp a raw `comps` row (or export-mapped comp object)
 * @returns {{
 *   sourceType: string, sourceTypeLabel: string, tone: string,
 *   verified: boolean, verifiedLabel: string,
 *   freshnessKind: string|null, freshnessLabel: string|null,
 *   sourceText: string|null, sourceUrl: string|null,
 * }}
 */
const deriveCompProvenance = (comp = {}) => {
  const typeKey = resolveSourceType(comp);
  const type = SOURCE_TYPES[typeKey] || SOURCE_TYPES.other;

  const verified = comp.is_verified === true;
  const freshness = resolveFreshness(comp);

  const sourceText = typeof comp.source === 'string' && comp.source.trim() ? comp.source.trim() : null;
  const sourceUrl = typeof comp.source_url === 'string' && comp.source_url.trim() ? comp.source_url.trim() : null;

  return {
    sourceType: typeKey,
    sourceTypeLabel: type.label,
    tone: type.tone,
    verified,
    // Verification is independent of source-type. Only an explicit TRUE earns
    // "Verified"; everything else is "Unverified" (never silently promoted).
    verifiedLabel: verified ? 'Verified' : 'Unverified',
    freshnessKind: freshness.kind,
    freshnessLabel: freshness.label,
    sourceText,
    sourceUrl,
  };
};

/**
 * One compact text line for the constrained export surfaces (no chrome):
 *   "Research report · Verified · as of 4 May 2026"
 * Falls back gracefully when pieces are missing; never empty for a real comp.
 */
const formatProvenanceLine = (comp = {}) => {
  const p = deriveCompProvenance(comp);
  if (p.sourceType === 'none' && !p.freshnessLabel) return 'No verified feed available';
  const parts = [p.sourceTypeLabel, p.verifiedLabel];
  if (p.freshnessLabel) parts.push(p.freshnessLabel);
  return parts.join(' · ');
};

module.exports = {
  deriveCompProvenance,
  formatProvenanceLine,
  // exported for tests + the frontend twin to mirror
  SOURCE_TYPES,
  extractPeriodToken,
  formatAbsoluteDate,
};
