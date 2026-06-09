import { SQFT_PER_ACRE } from '../config/india';

/**
 * Format number as Indian currency (lakhs/crores).
 *
 * REDIP is India-only. Numbers are always stored and shown in INR — the
 * old multi-currency display layer (2026-04 → 2026-05-24) was retired
 * because it added confusion without earning its complexity. Stored
 * values were never converted; only the displayed unit was.
 */
export const formatINR = (value, decimals = 2) => {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return '-';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

/**
 * Format as INR Crores — the canonical pricing unit for Indian real estate.
 */
export const formatCrores = (value) => {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return '-';
  return `₹${num.toFixed(2)} Cr`;
};

/**
 * Format a PRICE-in-crore field, treating a missing OR non-positive value
 * as "not set" → "-".
 *
 * Use this for ask / negotiated / entry price fields where a stored 0 — or
 * the Postgres driver's NUMERIC-as-string "0.00", which is truthy and slips
 * past a plain `value ? ... : '-'` guard — means "not yet populated", never a
 * genuine ₹0 acquisition price. Plain `formatCrores` stays correct for
 * cost / revenue / profit fields where 0 is a real, displayable value.
 */
export const formatCroresOrDash = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '-';
  return `₹${num.toFixed(2)} Cr`;
};

// ─── Large-number entry readout (AmountReadout) ──────────────────────────────
// Unit-aware "what did I just type" echo shown beneath numeric inputs so a
// fat-fingered zero on a crore-scale number is obvious at a glance. The input
// box is never reformatted (no caret hazard) — these pure helpers only build
// the muted line below it. House style mirrors formatCrores / FinancialTab's
// formatINRPerUnit: en-IN grouping, ₹, Cr (≥1e7) / L (≥1e5), 2-dp crore.

/**
 * Classify a field label into a readout "kind" from the unit it already encodes.
 * Labels are the single source of truth ("Land Cost (₹ Cr)", "Selling Rate
 * (₹/sqft)", "Plot Area (sqft)", "Debt LTV (0–1)"), so no per-field annotation.
 *
 * @param {string} label
 * @returns {'rupeeCrore'|'rupeePlain'|'count'|'none'}
 */
export const inferAmountKind = (label) => {
  if (typeof label !== 'string') return 'none';
  const l = label.toLowerCase();
  // Money branches FIRST. No "none" field (%, ratios, durations) carries a ₹,
  // so this is safe — and it stops "Base Rent (₹/sqft/month)" from being eaten
  // by the "month" duration token below.
  // 1) Crore: literal "₹ cr" (note the space — every real label uses "(₹ Cr)").
  if (l.includes('₹ cr')) return 'rupeeCrore';
  // 2) Plain rupee RATE: any "₹/…" token. BEFORE the area branch because
  //    "(₹/sqft)", "(₹/sqft GFA)" etc. also contain "sqft".
  if (l.includes('₹/')) return 'rupeePlain';
  // 3) Hard NONE: ratios, rates, durations, small counts.
  //    "Debt LTV (0–1)" / "(years)" / "(%)" / "FSI / FAR" → no readout.
  if (
    l.includes('%') ||
    l.includes('(0–1)') || l.includes('(0-1)') ||
    /\bltv\b/.test(l) || /\bltc\b/.test(l) ||
    l.includes('cap rate') || l.includes('caprate') ||
    l.includes('year') || l.includes('month') ||
    l.includes('multiple') || l.includes('ratio') ||
    l.includes('bps') || l.includes('dscr') ||
    l.includes('fsi') || l.includes('far') ||
    l.includes('(rooms)') || l.includes('number of keys')
  ) {
    return 'none';
  }
  // 4) Bare area count (plotArea, totalLand, leasable, avgUnitSize…).
  if (l.includes('sqft') || l.includes('sq ft')) return 'count';
  return 'none';
};

/** Indian digit grouping (53567890 → "5,35,67,890"). '' for non-finite. */
export const groupIndian = (value, maxFractionDigits = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('en-IN', { maximumFractionDigits: maxFractionDigits });
};

/**
 * Format a numeric magnitude into a compact scale label for a FIXED scale unit
 * (unit chosen once from the final value so the count-up animation never flips
 * its suffix mid-roll). `value` units depend on `scaleUnit`:
 *   'cr'        → value already in crore     → "₹25.50 Cr"
 *   'crINR'     → value in rupees            → "₹5.36 Cr"
 *   'lakhINR'   → value in rupees            → "₹80.00 L"
 *   'plainINR'  → value in rupees            → "₹8,000"
 *   'crCount'   → value as a plain count     → "2.00 Cr"
 *   'lakhCount' → value as a plain count     → "2.00 Lakh"
 */
export const formatAmountScale = (value, scaleUnit) => {
  const v = Number(value);
  if (!Number.isFinite(v) || !scaleUnit) return '';
  // Grouped 2-dp — so a fat-finger like ₹2,550.00 Cr keeps its commas.
  const f2 = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  switch (scaleUnit) {
    case 'cr':        return `₹${f2(v)} Cr`;
    case 'crINR':     return `₹${f2(v / 1e7)} Cr`;
    case 'lakhINR':   return `₹${f2(v / 1e5)} L`;
    case 'plainINR':  return `₹${groupIndian(Math.round(v))}`;
    case 'crCount':   return `${f2(v / 1e7)} Cr`;
    case 'lakhCount': return `${f2(v / 1e5)} Lakh`;
    default:          return '';
  }
};

/**
 * Build the readout for a typed value under a unit kind, or null when nothing
 * should show (kind 'none', empty, NaN, ≤ 0, or below the magnitude threshold).
 *
 * @returns {{ grouped: string|null, compact: string|null, scaleValue: number|null, scaleUnit: string|null } | null}
 *   - `grouped` is the static Indian-grouped echo (null when it would duplicate
 *     the compact, e.g. a sub-₹1L rupee value).
 *   - `compact` is the final compact label.
 *   - `scaleValue` / `scaleUnit` drive the count-up (the component animates the
 *     compact figure toward `scaleValue`); both null ⇒ no animation (areas stay
 *     static so "2 Lakh sqft" never becomes "2.00 Lakh sqft" mid-roll).
 */
export const describeAmount = (value, kind) => {
  if (kind === 'none' || value === '' || value == null) return null;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  if (kind === 'rupeeCrore') {
    // Already in crore; a fat-finger 2550 → "₹2,550.00 Cr" stands out loudly.
    return {
      grouped: null,
      compact: formatAmountScale(raw, 'cr'),
      scaleValue: raw,
      scaleUnit: 'cr',
    };
  }

  if (kind === 'rupeePlain') {
    if (raw < 1000) return null;
    const rupees = Math.round(raw);
    if (rupees >= 1e7) {
      return { grouped: groupIndian(rupees), compact: formatAmountScale(rupees, 'crINR'), scaleValue: rupees, scaleUnit: 'crINR' };
    }
    if (rupees >= 1e5) {
      return { grouped: groupIndian(rupees), compact: formatAmountScale(rupees, 'lakhINR'), scaleValue: rupees, scaleUnit: 'lakhINR' };
    }
    // Below ₹1 lakh the grouped number IS the compact — show one, not "8,000 · ₹8,000".
    return { grouped: null, compact: formatAmountScale(rupees, 'plainINR'), scaleValue: rupees, scaleUnit: 'plainINR' };
  }

  if (kind === 'count') {
    if (raw < 1000) return null;
    const whole = Math.round(raw);
    // Areas stay static (no count-up): trim trailing zeros so 200000 → "2 Lakh".
    if (whole >= 1e7) {
      return { grouped: groupIndian(whole), compact: `${+(whole / 1e7).toFixed(2)} Cr`, scaleValue: null, scaleUnit: null };
    }
    if (whole >= 1e5) {
      return { grouped: groupIndian(whole), compact: `${+(whole / 1e5).toFixed(2)} Lakh`, scaleValue: null, scaleUnit: null };
    }
    return { grouped: groupIndian(whole), compact: null, scaleValue: null, scaleUnit: null };
  }

  return null;
};

/**
 * Format percentage
 */
export const formatPct = (value, decimals = 1) => {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return '-';
  return `${num.toFixed(decimals)}%`;
};

// Kernel returns IRR in percent form (14.0 for 14% p.a.). No * 100 anywhere.
export const formatIRR = (value, decimals = 2) => {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(decimals)}%`;
};

/**
 * Format area — respects pref_areaUnit (sqft | sqm | acres)
 */
export const formatArea = (value) => {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return '-';
  const unit = localStorage.getItem('pref_areaUnit') || 'sqft';
  if (unit === 'sqm') {
    const sqm = num * 0.092903;
    return `${sqm.toLocaleString('en-IN', { maximumFractionDigits: 1 })} sqm`;
  }
  if (unit === 'acres') {
    const acres = num / SQFT_PER_ACRE;
    return `${acres.toLocaleString('en-IN', { maximumFractionDigits: 3 })} acres`;
  }
  return `${num.toLocaleString('en-IN')} sqft`;
};

/**
 * Format date — respects pref_dateFormat locale
 */
export const formatDate = (value) => {
  if (!value) return '-';
  const locale = localStorage.getItem('pref_dateFormat') || 'en-IN';
  if (locale === 'iso') return new Date(value).toISOString().slice(0, 10);
  return new Date(value).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

/**
 * Format relative time
 */
export const formatRelativeTime = (value) => {
  if (!value) return '-';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
};

/**
 * Stage display config. `tone` maps to <Badge tone="…"> in the design system.
 */
export const STAGE_CONFIG = {
  sourced:       { label: 'Sourced',                tone: 'neutral' },
  screening:     { label: 'Screening',              tone: 'neutral' },
  site_visit:    { label: 'Site Visit',             tone: 'info' },
  loi:           { label: 'LOI',                    tone: 'warn' },
  due_diligence: { label: 'Due Diligence',          tone: 'warn' },
  underwriting:  { label: 'Underwriting',           tone: 'info' },
  ic_review:     { label: 'IC Review',              tone: 'premium' },
  negotiation:   { label: 'Negotiation',            tone: 'info' },
  active:        { label: 'Active',                 tone: 'success' },
  closed:        { label: 'Closed',                 tone: 'success' },
  dead:          { label: 'Dead',                   tone: 'danger' },
};

export const STAGE_TRANSITIONS = {
  sourced: ['screening', 'dead'],
  screening: ['site_visit', 'sourced', 'dead'],
  site_visit: ['loi', 'screening', 'dead'],
  loi: ['due_diligence', 'site_visit', 'dead'],
  due_diligence: ['underwriting', 'loi', 'dead'],
  underwriting: ['ic_review', 'due_diligence', 'dead'],
  ic_review: ['negotiation', 'underwriting', 'dead'],
  negotiation: ['active', 'ic_review', 'dead'],
  active: ['closed', 'negotiation', 'dead'],
  closed: [],
  dead: ['sourced', 'screening'],
};

export const PRIORITY_CONFIG = {
  low:      { label: 'Low',      tone: 'neutral' },
  medium:   { label: 'Medium',   tone: 'info' },
  high:     { label: 'High',     tone: 'warn' },
  critical: { label: 'Critical', tone: 'danger' },
};

export const DEAL_TYPE_LABELS = {
  acquisition: 'Acquisition',
  jv: 'Joint Venture',
  da: 'Dev Agreement',
  outright: 'Outright',
};

export const PROPERTY_TYPE_LABELS = {
  land: 'Land',
  residential: 'Residential',
  commercial: 'Commercial',
  mixed_use: 'Mixed Use',
  industrial: 'Industrial',
  office: 'Office',
  retail: 'Retail',
  hospitality: 'Hospitality',
};

export const ACTIVITY_STATUS_CONFIG = {
  open:      { label: 'Open',      tone: 'warn' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const ACTIVITY_PRIORITY_CONFIG = {
  low:    { label: 'Low',    tone: 'neutral' },
  medium: { label: 'Medium', tone: 'info' },
  high:   { label: 'High',   tone: 'danger' },
};
