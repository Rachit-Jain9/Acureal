// Preflight check that mirrors the kernel's REQUIRED_BY_CLASS schema.
// Runs before any kernel compute call so we can show a coherent "enter
// these fields" banner instead of letting each panel crash independently.

const REQUIRED_BY_CLASS = {
  residential_apartments: [
    'plotAreaSqft',
    'fsi',
    'constructionCostPerSqft',
    'sellingRatePerSqft',
    'landCostCr',
  ],
  villas: ['plotAreaSqft', 'constructionCostPerSqft', 'sellingRatePerSqft', 'landCostCr'],
  mixed_use: [
    'plotAreaSqft',
    'fsi',
    'constructionCostPerSqft',
    'sellingRatePerSqft',
    'landCostCr',
  ],
  redevelopment: ['plotAreaSqft', 'fsi', 'constructionCostPerSqft', 'sellingRatePerSqft'],
  plotted_development: ['totalLandSqft', 'sellingRatePerSqft', 'landCostCr'],
  commercial_office: ['leasableAreaSqft', 'constructionCostPerSqft', 'baseRentPerSqftMonth', 'landCostCr'],
  retail: ['leasableAreaSqft', 'constructionCostPerSqft', 'baseRentPerSqftMonth', 'landCostCr'],
  industrial_warehousing: [
    'leasableAreaSqft',
    'constructionCostPerSqft',
    'baseRentPerSqftMonth',
    'landCostCr',
  ],
  hospitality: ['keys', 'adr', 'landCostCr'],
};

const LABELS = {
  plotAreaSqft: 'Plot Area',
  totalLandSqft: 'Total Land Area',
  leasableAreaSqft: 'Leasable Area',
  fsi: 'FSI',
  constructionCostPerSqft: 'Construction Cost (₹/sqft)',
  sellingRatePerSqft: 'Selling Rate (₹/sqft)',
  baseRentPerSqftMonth: 'Base Rent (₹/sqft/month)',
  landCostCr: 'Land Cost',
  keys: 'Number of Keys',
  adr: 'Average Daily Rate',
};

const isPresent = (v) =>
  v != null && v !== '' && (typeof v !== 'number' || Number.isFinite(v));

export function preflightDealInput(raw, assetClass) {
  const required = REQUIRED_BY_CLASS[assetClass];
  if (!required) return { ok: true, missing: [] };
  if (!raw || typeof raw !== 'object') {
    return { ok: false, missing: required };
  }
  const missing = required.filter((key) => !isPresent(raw[key]));
  return { ok: missing.length === 0, missing };
}

// Oxford-comma "Land Cost, FSI, and Selling Rate"
export function describeMissingInputs(missing) {
  const labels = missing.map((k) => LABELS[k] || k);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}
