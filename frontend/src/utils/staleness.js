// Class-aware data-staleness assessment.
//
// REDIP's "verified-data-only" stance dies the moment users see month-old
// prices labelled current. Different data classes age at different rates:
// listings move weekly, IPC quarterly tear-sheets are valid for 90 days,
// macro KPIs for ~60. Use the per-class half-life so badges stay honest.

const DAY_MS = 24 * 60 * 60 * 1000;

// Half-life days by data category. Past 1× half-life → "aging"; past 2× → "stale".
// Tune as we get more reviewer feedback. Keys mirror the table /
// data_type strings the API returns.
export const STALENESS_HALF_LIFE_DAYS = {
  // Residential
  residential_listing:           7,    // 99acres / Magicbricks listings move fast
  residential_transaction:      30,    // SRO + verified txn data
  micro_market_benchmark_listing: 7,   // listing_q1_2026
  micro_market_benchmark_ipc:   90,    // ipc_q1_2026
  internal_benchmark:           30,    // internal_benchmark_apr_2026

  // Commercial / IPC tear-sheets
  office_ipc:                   90,
  retail_ipc:                   90,
  industrial_ipc:               90,
  hospitality_ipc:              90,
  macro_kpi:                    60,

  // Pipeline / transactions
  market_transaction:           30,

  // Generic fallback
  default:                      60,
};

const DATA_TYPE_TO_CATEGORY = {
  internal_benchmark_apr_2026: 'internal_benchmark',
  listing_q1_2026:             'micro_market_benchmark_listing',
  ipc_q1_2026:                 'micro_market_benchmark_ipc',
};

// Resolve a category key from either an explicit category prop OR from a row's
// `data_type` / fallback hints. Always returns a key valid for the half-life map.
export const resolveStalenessCategory = ({ category, dataType, fallback }) => {
  if (category && STALENESS_HALF_LIFE_DAYS[category] != null) return category;
  if (dataType && DATA_TYPE_TO_CATEGORY[dataType]) return DATA_TYPE_TO_CATEGORY[dataType];
  if (fallback && STALENESS_HALF_LIFE_DAYS[fallback] != null) return fallback;
  return 'default';
};

// Parse a date-ish input (Date, ISO string, YYYY-MM-DD, ms-epoch number) safely.
// Returns null on any garbage so callers can render "unknown" rather than crash.
const parseDate = (input) => {
  if (!input) return null;
  if (input instanceof Date) return Number.isFinite(input.getTime()) ? input : null;
  if (typeof input === 'number' && Number.isFinite(input)) return new Date(input);
  if (typeof input === 'string') {
    const d = new Date(input);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
};

// Core: assess freshness for a single row.
//   asOfDate         — ISO string, Date, ms-epoch, or YYYY-MM-DD
//   options.category — explicit category key from STALENESS_HALF_LIFE_DAYS
//   options.dataType — fallback: row.data_type
//   options.fallback — last-resort default (e.g. 'office_ipc')
//   options.now      — for testing; defaults to Date.now()
//
// Returns:
//   {
//     status:        'fresh' | 'aging' | 'stale' | 'unknown',
//     daysOld:        number | null,
//     halfLifeDays:   number,
//     category:       string,
//     label:          'Fresh' | 'Aging' | 'Stale' | 'Date unknown',
//     tone:           'success' | 'warn' | 'danger' | 'neutral'
//   }
export const assessStaleness = (asOfDate, options = {}) => {
  const category = resolveStalenessCategory(options);
  const halfLifeDays = STALENESS_HALF_LIFE_DAYS[category] || STALENESS_HALF_LIFE_DAYS.default;
  const parsed = parseDate(asOfDate);
  if (!parsed) {
    return {
      status: 'unknown',
      daysOld: null,
      halfLifeDays,
      category,
      label: 'Date unknown',
      tone: 'neutral',
    };
  }
  const now = options.now || Date.now();
  const daysOld = Math.max(0, Math.floor((now - parsed.getTime()) / DAY_MS));
  let status, label, tone;
  if (daysOld <= halfLifeDays) {
    status = 'fresh';
    label  = 'Fresh';
    tone   = 'success';
  } else if (daysOld <= halfLifeDays * 2) {
    status = 'aging';
    label  = 'Aging';
    tone   = 'warn';
  } else {
    status = 'stale';
    label  = 'Stale';
    tone   = 'danger';
  }
  return { status, daysOld, halfLifeDays, category, label, tone };
};

// Format `daysOld` as a short human string for tooltip / sub text.
export const formatDaysOld = (daysOld) => {
  if (daysOld == null) return 'date unknown';
  if (daysOld === 0) return 'today';
  if (daysOld === 1) return '1 day ago';
  if (daysOld < 30) return `${daysOld} days ago`;
  if (daysOld < 60) return '~1 month ago';
  if (daysOld < 365) return `~${Math.round(daysOld / 30)} months ago`;
  return `~${Math.round(daysOld / 365 * 10) / 10} years ago`;
};

// Aggregate: given an array of rows with `as_of_date`, return the worst status
// across the set ("stale" beats "aging" beats "fresh"). Useful for table-level
// summary badges. `getDate(row)` defaults to row.as_of_date.
const STATUS_RANK = { fresh: 0, aging: 1, stale: 2, unknown: 3 };

export const aggregateStaleness = (rows, options = {}) => {
  const getDate = options.getDate || ((r) => r.as_of_date);
  const getCategory = options.getCategory || (() => null);
  const getDataType = options.getDataType || ((r) => r.data_type);

  let worst = null;
  let worstRank = -1;
  let mostRecent = null;

  for (const row of rows || []) {
    const dt = parseDate(getDate(row));
    if (dt && (!mostRecent || dt > mostRecent)) mostRecent = dt;
    const result = assessStaleness(getDate(row), {
      category: getCategory(row),
      dataType: getDataType(row),
      fallback: options.fallback,
      now: options.now,
    });
    const rank = STATUS_RANK[result.status] ?? 3;
    if (rank > worstRank) {
      worst = result;
      worstRank = rank;
    }
  }
  return {
    worst: worst || { status: 'unknown', label: 'Date unknown', tone: 'neutral' },
    mostRecent,
    rowCount: rows?.length || 0,
  };
};
