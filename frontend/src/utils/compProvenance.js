// Comp-provenance deriver — frontend twin of backend/src/utils/compProvenance.js.
// Keep the bucket logic byte-for-byte equivalent so a comp reads identically
// in-app and in every export. See the backend file for the full rationale.
//
// Acureal hard rule (CLAUDE.md): comps must always surface source, freshness, and
// confidence — or "No verified feed available." Deterministic string matching
// only (no AI, no fabricated confidence number).

const SOURCE_TYPES = {
  transaction: { key: 'transaction', label: 'Transaction', tone: 'positive' },
  research: { key: 'research', label: 'Research report', tone: 'premium' },
  internal: { key: 'internal', label: 'Internal benchmark', tone: 'accent' },
  listing: { key: 'listing', label: 'Listing', tone: 'info' },
  guidance: { key: 'guidance', label: 'Guidance value', tone: 'info' },
  other: { key: 'other', label: 'Other source', tone: 'neutral' },
  none: { key: 'none', label: 'No verified feed', tone: 'muted' },
};

const DATA_TYPE_RULES = [
  [/^ipc/i, 'research'],
  [/^internal/i, 'internal'],
  [/^listing/i, 'listing'],
  [/^transaction|^registry|^deed/i, 'transaction'],
  [/^guidance|^circle|^sro/i, 'guidance'],
];

const SOURCE_KEYWORD_RULES = [
  [/sale deed|registr|kaveri|\bsro\b|sub.?regist|encumbrance|conveyance/i, 'transaction'],
  [/jll|knight frank|cbre|colliers|anarock|cushman|savills|propequity|\breport\b|research/i, 'research'],
  [/magicbricks|99\s?acres|housing\.com|nobroker|squareyards|square yards|proptiger|\blisting\b|portal/i, 'listing'],
  [/redip|internal|in.?house|\bdesk\b|benchmark/i, 'internal'],
  [/guidance value|circle rate|government|gazette|\bbbmp\b|\bbda\b|\bigr\b/i, 'guidance'],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatAbsoluteDate(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export function extractPeriodToken(dataType) {
  if (!dataType || typeof dataType !== 'string') return null;
  const q = dataType.match(/q([1-4])[_-]?(\d{4})/i);
  if (q) return `Q${q[1]} ${q[2]}`;
  const m = dataType.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[_-]?(\d{4})/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1, 3).toLowerCase()} ${m[2]}`;
  return null;
}

function resolveSourceType(comp) {
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
    return 'other';
  }
  return 'none';
}

function resolveFreshness(comp) {
  const asOf = formatAbsoluteDate(comp.as_of_date);
  if (asOf) return { kind: 'as_of', label: `as of ${asOf}` };
  const period = extractPeriodToken(comp.data_type);
  if (period) return { kind: 'period', label: period };
  const updated = formatAbsoluteDate(comp.updated_at);
  if (updated) return { kind: 'updated', label: `updated ${updated}` };
  return { kind: null, label: null };
}

export function deriveCompProvenance(comp = {}) {
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
    verifiedLabel: verified ? 'Verified' : 'Unverified',
    freshnessKind: freshness.kind,
    freshnessLabel: freshness.label,
    sourceText,
    sourceUrl,
  };
}

export { SOURCE_TYPES };
