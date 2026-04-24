import { SQFT_PER_ACRE } from '../config/india';

const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  AED: 'AED ',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  SGD: 'S$',
  LKR: 'Rs ',
  THB: '฿',
};

const getFxConfig = () => {
  const code = localStorage.getItem('pref_currencyCode') || 'INR';
  const rate = parseFloat(localStorage.getItem('pref_fx_rate')) || null;
  return { code, rate };
};

const formatForeignCurrency = (valueInr, code, rateInrPerUnit) => {
  const foreign = valueInr / rateInrPerUnit;
  const sym = CURRENCY_SYMBOLS[code] || `${code} `;
  const abs = Math.abs(foreign);
  if (abs >= 1e9) return `${sym}${(foreign / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sym}${(foreign / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sym}${(foreign / 1e3).toFixed(2)}K`;
  return `${sym}${foreign.toFixed(2)}`;
};

/**
 * Format number as Indian currency (lakhs/crores)
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
 * Format as crores (respects user currency preference)
 */
export const formatCrores = (value) => {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return '-';
  const { code, rate } = getFxConfig();
  if (code !== 'INR' && rate) {
    return formatForeignCurrency(num * 1e7, code, rate);
  }
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
  ic_review:     { label: 'Investor-Grade Review',  tone: 'premium' },
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
