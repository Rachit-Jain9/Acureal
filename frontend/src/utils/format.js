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
    const acres = num / 43560;
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
 * Stage display config
 */
export const STAGE_CONFIG = {
  sourced: { label: 'Sourced', color: 'bg-slate-100 text-slate-700' },
  screening: { label: 'Screening', color: 'bg-gray-100 text-gray-800' },
  site_visit: { label: 'Site Visit', color: 'bg-blue-100 text-blue-800' },
  loi: { label: 'LOI', color: 'bg-yellow-100 text-yellow-800' },
  due_diligence: { label: 'Due Diligence', color: 'bg-orange-100 text-orange-800' },
  underwriting: { label: 'Underwriting', color: 'bg-purple-100 text-purple-800' },
  ic_review: { label: 'IC Review', color: 'bg-indigo-100 text-indigo-800' },
  negotiation: { label: 'Negotiation', color: 'bg-cyan-100 text-cyan-800' },
  active: { label: 'Active', color: 'bg-green-100 text-green-800' },
  closed: { label: 'Closed', color: 'bg-emerald-100 text-emerald-800' },
  dead: { label: 'Dead', color: 'bg-red-100 text-red-800' },
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
  low: { label: 'Low', color: 'bg-gray-100 text-gray-700' },
  medium: { label: 'Medium', color: 'bg-blue-100 text-blue-700' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-700' },
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
  open: { label: 'Open', color: 'bg-amber-100 text-amber-800' },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-700' },
};

export const ACTIVITY_PRIORITY_CONFIG = {
  low: { label: 'Low', color: 'bg-gray-100 text-gray-700' },
  medium: { label: 'Medium', color: 'bg-blue-100 text-blue-700' },
  high: { label: 'High', color: 'bg-red-100 text-red-700' },
};
