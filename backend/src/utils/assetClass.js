'use strict';

const normalizeToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const ASSET_CLASS_ALIASES = {
  residential: 'residential_apartments',
  residential_apartment: 'residential_apartments',
  residential_apartments: 'residential_apartments',
  apartment: 'residential_apartments',
  apartments: 'residential_apartments',
  flat: 'residential_apartments',
  flats: 'residential_apartments',
  plotted: 'plotted_development',
  plot: 'plotted_development',
  plotted_development: 'plotted_development',
  villa: 'villas',
  villas: 'villas',
  office: 'commercial_office',
  commercial_office: 'commercial_office',
  retail: 'retail',
  commercial_retail: 'retail',
  mall: 'retail',
  shopping: 'retail',
  highstreet: 'retail',
  high_street: 'retail',
  industrial: 'industrial_warehousing',
  warehouse: 'industrial_warehousing',
  warehousing: 'industrial_warehousing',
  logistics: 'industrial_warehousing',
  logistics_park: 'industrial_warehousing',
  hospitality: 'hospitality',
  hotel: 'hospitality',
  mixed_use: 'mixed_use',
  mixeduse: 'mixed_use',
  mixed: 'mixed_use',
  raw_land: 'raw_land',
  land: 'raw_land',
  land_parcel: 'raw_land',
  redevelopment: 'redevelopment',
};

const resolveAssetClass = (value) => {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  if (ASSET_CLASS_ALIASES[normalized]) return ASSET_CLASS_ALIASES[normalized];
  if (normalized.includes('retail') || normalized.includes('mall') || normalized.includes('shopping')) return 'retail';
  if (normalized.includes('office') || normalized.includes('workspace') || normalized.includes('business_park')) return 'commercial_office';
  if (normalized.includes('warehouse') || normalized.includes('warehousing') || normalized.includes('logistics') || normalized.includes('industrial')) return 'industrial_warehousing';
  if (normalized.includes('hotel') || normalized.includes('hospitality')) return 'hospitality';
  if (normalized.includes('villa')) return 'villas';
  if (normalized.includes('plot')) return 'plotted_development';
  if (normalized.includes('mixed')) return 'mixed_use';
  if (normalized.includes('redevelop')) return 'redevelopment';
  if (normalized.includes('land')) return 'raw_land';
  if (normalized.includes('residential') || normalized.includes('apartment')) return 'residential_apartments';
  return null;
};

const hasOperatingSignals = ({ deal = {}, inputs = {} } = {}) =>
  [
    inputs.baseRentPerSqftMonth,
    inputs.exitCapRate,
    inputs.vacancyPct,
    deal.noi_cr,
    deal.stabilized_noi_cr,
    deal.exit_value_cr,
    deal.entry_value_cr,
    deal.yield_on_cost_pct,
    deal.dscr,
  ].some((value) => value !== null && value !== undefined && value !== '');

const inferAssetClass = ({ deal = {}, inputs = {} } = {}) => {
  // Resolve from the most-curated text first (deal name) AND the
  // explicit dropdown field. If the name yields a confident non-
  // residential class, trust the name — operators name deals
  // descriptively but sometimes leave the asset_class dropdown at
  // its default ("residential_apartments"), so a deal named
  // "Commercial Retail" with asset_class still on default would
  // otherwise render the entire deck as residential. Catches the
  // 2026-05-10 operator-reported "Commercial Retail" mismatch.
  const fromName = resolveAssetClass(deal.name);
  const fromExplicit = [deal.asset_class, deal.financial_asset_class]
    .map((value) => resolveAssetClass(value))
    .find(Boolean);

  if (fromName && fromName !== 'residential_apartments') return fromName;
  if (fromExplicit) return fromExplicit;

  // Other textual cues from the rest of the record.
  const otherTextual = [
    deal.property_name,
    deal.investment_thesis,
    deal.property_notes,
  ].map((value) => resolveAssetClass(value)).find(Boolean);
  if (otherTextual) return otherTextual;

  // Name match that resolved to residential — apply only after other
  // textual fields have had a chance to override.
  if (fromName) return fromName;

  if (hasOperatingSignals({ deal, inputs })) {
    const operatingHint = [deal.property_type, deal.zoning]
      .map((value) => resolveAssetClass(value))
      .find((value) => ['retail', 'commercial_office', 'industrial_warehousing', 'hospitality'].includes(value));
    if (operatingHint) return operatingHint;
  }

  const propertyDriven = [deal.property_type, deal.zoning]
    .map((value) => resolveAssetClass(value))
    .find(Boolean);
  if (propertyDriven) return propertyDriven;

  return 'residential_apartments';
};

module.exports = {
  resolveAssetClass,
  inferAssetClass,
};
