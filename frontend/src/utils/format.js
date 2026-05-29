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
