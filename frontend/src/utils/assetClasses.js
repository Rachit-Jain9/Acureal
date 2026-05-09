export const ASSET_CLASS_CONFIG = [
  {
    value: 'residential_apartments',
    label: 'Residential Apartments',
    financialModelClass: 'residential_apartments',
    financialModelLabel: 'Residential Apartments',
  },
  {
    value: 'plotted_development',
    label: 'Plotted Development',
    financialModelClass: 'plotted_development',
    financialModelLabel: 'Plotted Development',
  },
  {
    value: 'villas',
    label: 'Villas',
    financialModelClass: 'villas',
    financialModelLabel: 'Villas',
  },
  {
    value: 'commercial_office',
    label: 'Commercial Office',
    financialModelClass: 'commercial_office',
    financialModelLabel: 'Commercial Office',
  },
  {
    value: 'retail',
    label: 'Retail',
    financialModelClass: 'retail',
    financialModelLabel: 'Retail',
  },
  {
    value: 'industrial_warehousing',
    label: 'Industrial / Warehousing',
    financialModelClass: 'industrial_warehousing',
    financialModelLabel: 'Industrial / Warehousing',
  },
  {
    value: 'hospitality',
    label: 'Hospitality',
    financialModelClass: 'hospitality',
    financialModelLabel: 'Hospitality',
  },
  {
    value: 'mixed_use',
    label: 'Mixed Use',
    financialModelClass: 'mixed_use',
    financialModelLabel: 'Mixed Use',
  },
  {
    value: 'redevelopment',
    label: 'Redevelopment',
    financialModelClass: 'redevelopment',
    financialModelLabel: 'Redevelopment',
  },
];

export const ASSET_CLASS_LABELS = Object.fromEntries(
  ASSET_CLASS_CONFIG.map((entry) => [entry.value, entry.label])
);

export const FINANCIAL_MODEL_CLASS_BY_ASSET_CLASS = Object.fromEntries(
  ASSET_CLASS_CONFIG.map((entry) => [entry.value, entry.financialModelClass])
);

export const FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS = Object.fromEntries(
  ASSET_CLASS_CONFIG.map((entry) => [entry.value, entry.financialModelLabel])
);

export const ASSET_CLASSES = ASSET_CLASS_CONFIG.map((entry) => entry.value);

export const LEGACY_ASSET_CLASS_ALIASES = {
  raw_land: 'plotted_development',
  land: 'plotted_development',
  land_parcel: 'plotted_development',
};

export const normalizeAssetClass = (assetClass) => {
  if (!assetClass || typeof assetClass !== 'string') return assetClass;
  return LEGACY_ASSET_CLASS_ALIASES[assetClass] || assetClass;
};

export const getAssetClassLabel = (assetClass) => {
  const canonicalAssetClass = normalizeAssetClass(assetClass);
  return ASSET_CLASS_LABELS[canonicalAssetClass] || assetClass;
};

export const resolveFinancialModelClass = (assetClass) =>
  FINANCIAL_MODEL_CLASS_BY_ASSET_CLASS[normalizeAssetClass(assetClass)] || 'residential_apartments';
