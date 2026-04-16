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
    financialModelClass: 'residential_apartments',
    financialModelLabel: 'Residential Apartments',
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
    financialModelClass: 'residential_apartments',
    financialModelLabel: 'Residential Apartments',
  },
  {
    value: 'raw_land',
    label: 'Raw Land',
    financialModelClass: 'plotted_development',
    financialModelLabel: 'Plotted Development',
  },
  {
    value: 'redevelopment',
    label: 'Redevelopment',
    financialModelClass: 'residential_apartments',
    financialModelLabel: 'Residential Apartments',
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

export const resolveFinancialModelClass = (assetClass) =>
  FINANCIAL_MODEL_CLASS_BY_ASSET_CLASS[assetClass] || 'residential_apartments';
