'use strict';

/**
 * Pure helpers + constants for the PPTX deal-deck pipeline.
 *
 * Extracted from the original dealPptx.service.js (2,292 LOC) as part of
 * the Bet 3 god-service decomposition. Every export here is dependency-
 * free or only depends on other exports from this same file.
 *
 * 2026-05-10 — palette migrated to the editorial export palette
 * (`shared/palette.js`). Legacy COLORS keys kept as a translation layer so
 * existing render code continues to work; the *values* now resolve to the
 * new deep-navy + copper + semantic-emerald/red/amber tokens.
 */

const palette = require('../shared/palette');

const FONT = palette.FONTS.body;

// Translation map: legacy key → new palette token.
//   plum / plumSoft / sandDeep — these were the old "primary brand" tones;
//   they all collapse to inkDeep + accent in the new palette so the existing
//   slides shift visually without us editing every renderer.
const COLORS = {
  paper:     palette.pptx('paper'),
  white:     palette.pptx('paperElevated'),
  charcoal:  palette.pptx('ink'),
  muted:     palette.pptx('mutedHigh'),
  line:      palette.pptx('hairline'),
  plum:      palette.pptx('inkDeep'),     // primary structural colour
  plumSoft:  palette.pptx('accent'),      // secondary accent
  sand:      palette.pptx('paperSubtle'), // soft surface
  sandDeep:  palette.pptx('accent'),      // accent rule colour
  green:     palette.pptx('dataPositive'),
  amber:     palette.pptx('dataWarning'),
  red:       palette.pptx('dataNegative'),
  blue:      palette.pptx('mutedHigh'),
  cloud:     palette.pptx('hairlineStrong'),
  mist:      palette.pptx('paperSubtle'),
};

const ASSET_CLASS_LABELS = {
  residential_apartments: 'Residential Apartments',
  plotted_development: 'Plotted Development',
  villas: 'Villas',
  commercial_office: 'Commercial Office',
  retail: 'Retail',
  industrial_warehousing: 'Industrial & Warehousing',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed Use',
  raw_land: 'Raw Land',
  redevelopment: 'Redevelopment',
};

const DEAL_TYPE_LABELS = {
  acquisition: 'Acquisition',
  jv: 'Joint Venture',
  da: 'Development Agreement',
  outright: 'Outright',
};

const DEAL_STRUCTURE_LABELS = {
  outright: 'Outright Purchase',
  jv: 'Joint Venture',
  jda: 'Joint Development Agreement',
  revenue_share: 'Revenue Share',
  area_share: 'Area Share',
  profit_share: 'Profit Share',
  ground_lease: 'Ground Lease',
  hybrid: 'Hybrid Structure',
};

const STAGE_LABELS = {
  sourced: 'Sourced',
  screening: 'Screening',
  site_visit: 'Site Visit',
  loi: 'LOI',
  due_diligence: 'Due Diligence',
  underwriting: 'Underwriting',
  ic_review: 'Investor-Grade Review',
  negotiation: 'Negotiation',
  active: 'Active',
  closed: 'Closed',
  dead: 'Dead',
};

const PRIORITY_LABELS = {
  low: 'Low Priority',
  medium: 'Medium Priority',
  high: 'High Priority',
};

const INCOME_ASSETS = new Set(['commercial_office', 'retail', 'industrial_warehousing', 'hospitality']);
const LAND_LED_ASSETS = new Set(['raw_land', 'plotted_development', 'redevelopment']);

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = num(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const positiveNumber = (value) => {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const firstText = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
};

const humanize = (value) =>
  String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const formatNumber = (value, decimals = 0) => {
  const parsed = num(value);
  if (parsed === null) return null;
  return parsed.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
};

const formatCrores = (value, decimals = 2) => {
  const formatted = formatNumber(value, decimals);
  return formatted ? `INR ${formatted} Cr` : null;
};

const formatPct = (value, decimals = 1) => {
  const formatted = formatNumber(value, decimals);
  return formatted ? `${formatted}%` : null;
};

const formatArea = (value) => {
  const formatted = formatNumber(value, 0);
  return formatted ? `${formatted} sqft` : null;
};

const formatRate = (value) => {
  const formatted = formatNumber(value, 0);
  return formatted ? `INR ${formatted} / sqft` : null;
};

const formatRent = (value) => {
  const formatted = formatNumber(value, 0);
  return formatted ? `INR ${formatted} / sqft / month` : null;
};

const formatDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const truncate = (value, max) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

const pickSeverityColor = (severity) => {
  switch (severity) {
    case 'deal_breaker':
    case 'critical':
      return palette.pptx('dataNegative');
    case 'buildability_blocker':
    case 'high':
      return palette.pptx('dataNegative');
    case 'medium':
      return palette.pptx('dataWarning');
    case 'low':
      return palette.pptx('mutedHigh');
    default:
      return palette.pptx('dataPositive');
  }
};

const resolveStatusText = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const dedupeByTitle = (items = []) => {
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    const key = `${item.title || ''}::${item.detail || ''}`;
    if (!key.trim() || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
};

const severityRank = (severity) => {
  switch (severity) {
    case 'deal_breaker':
    case 'critical':
      return 4;
    case 'buildability_blocker':
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
};

const normalizeStructureFamily = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['acquisition', 'outright', 'purchase', 'buyout'].includes(normalized)) return 'outright';
  if (['jv', 'joint_venture', 'joint venture', 'joint development', 'jda', 'jvda'].includes(normalized)) return 'structured';
  if (['revenue_share', 'area_share', 'profit_share', 'ground_lease', 'hybrid'].includes(normalized)) return 'structured';
  return normalized;
};

const hasStructureMismatch = (deal = {}) => {
  const dealTypeFamily = normalizeStructureFamily(deal.deal_type);
  const structureFamily = normalizeStructureFamily(deal.deal_structure);
  return !!(dealTypeFamily && structureFamily && dealTypeFamily !== structureFamily);
};

const getAssetClassLabel = (assetClass) =>
  ASSET_CLASS_LABELS[assetClass] || humanize(assetClass) || 'Real Estate Opportunity';

const getDealTypeLabel = (dealType) => DEAL_TYPE_LABELS[dealType] || humanize(dealType) || 'Transaction';

const getDealStructureLabel = (dealStructure) =>
  DEAL_STRUCTURE_LABELS[dealStructure] || humanize(dealStructure) || 'Structure Not Provided';

const isIncomeAsset = (assetClass) => INCOME_ASSETS.has(assetClass);
const isLandLedAsset = (assetClass) => LAND_LED_ASSETS.has(assetClass);
const isStructuredDeal = (dealStructure) =>
  ['jv', 'jda', 'revenue_share', 'area_share', 'profit_share', 'ground_lease', 'hybrid'].includes(dealStructure);

const midpoint = (min, max) => {
  const minValue = num(min);
  const maxValue = num(max);
  if (minValue === null && maxValue === null) return null;
  if (minValue === null) return maxValue;
  if (maxValue === null) return minValue;
  return (minValue + maxValue) / 2;
};

const filterRows = (rows) => rows.filter((row) => row && row.value);


module.exports = {
  FONT,
  COLORS,
  // Re-export the shared palette so renderers can reach the richer token API
  // (severityColor, deltaColor, TYPE_SCALE, FONTS) without taking a separate
  // import — keeps slide files looking close to the existing pattern.
  palette,
  ASSET_CLASS_LABELS,
  DEAL_TYPE_LABELS,
  DEAL_STRUCTURE_LABELS,
  STAGE_LABELS,
  PRIORITY_LABELS,
  INCOME_ASSETS,
  LAND_LED_ASSETS,
  num,
  firstNumber,
  positiveNumber,
  firstText,
  humanize,
  formatNumber,
  formatCrores,
  formatPct,
  formatArea,
  formatRate,
  formatRent,
  formatDate,
  truncate,
  pickSeverityColor,
  resolveStatusText,
  dedupeByTitle,
  severityRank,
  normalizeStructureFamily,
  hasStructureMismatch,
  getAssetClassLabel,
  getDealTypeLabel,
  getDealStructureLabel,
  isIncomeAsset,
  isLandLedAsset,
  isStructuredDeal,
  midpoint,
  filterRows,
};
