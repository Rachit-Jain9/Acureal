const {
  AREA_UNITS,
  LAND_PRICING_BASES,
  normalizeAreaUnit,
  normalizeLandPricingBasis,
} = require('../constants/domain');
const { SQFT_PER_ACRE } = require('../config/india');

const round = (value, precision = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
};

const normalizeAreaSqft = (value, unit) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  if (unit === 'acre') {
    return numericValue * SQFT_PER_ACRE;
  }

  return numericValue;
};

const normalizeAreaUnitStrict = (unit) => {
  const normalizedUnit = normalizeAreaUnit(unit);
  return AREA_UNITS.includes(normalizedUnit) ? normalizedUnit : 'sqft';
};

const normalizePricingBasis = (basis) => {
  const normalizedBasis = normalizeLandPricingBasis(basis);
  return LAND_PRICING_BASES.includes(normalizedBasis) ? normalizedBasis : 'total_cr';
};

const calculateLandPricing = ({
  pricingBasis,
  landAskPriceCr,
  landPriceRateInr,
  landExtentInputValue,
  landExtentInputUnit,
  propertyAreaSqft,
}) => {
  const normalizedBasis = normalizePricingBasis(pricingBasis);
  const normalizedAreaUnit = normalizeAreaUnitStrict(landExtentInputUnit);

  const derivedAreaSqft =
    normalizeAreaSqft(landExtentInputValue, normalizedAreaUnit) ||
    (propertyAreaSqft ? Number(propertyAreaSqft) : null);

  const totalPriceCrInput =
    landAskPriceCr === null || landAskPriceCr === undefined || landAskPriceCr === ''
      ? null
      : Number(landAskPriceCr);
  const rateInput =
    landPriceRateInr === null || landPriceRateInr === undefined || landPriceRateInr === ''
      ? null
      : Number(landPriceRateInr);

  let computedTotalPriceCr = totalPriceCrInput;
  let ratePerSqftInr = null;
  let ratePerAcreInr = null;

  if (normalizedBasis === 'per_sqft' && rateInput && derivedAreaSqft) {
    computedTotalPriceCr = (rateInput * derivedAreaSqft) / 10000000;
    ratePerSqftInr = rateInput;
    ratePerAcreInr = rateInput * SQFT_PER_ACRE;
  }

  if (normalizedBasis === 'per_acre' && rateInput && derivedAreaSqft) {
    const areaInAcres = derivedAreaSqft / SQFT_PER_ACRE;
    computedTotalPriceCr = (rateInput * areaInAcres) / 10000000;
    ratePerAcreInr = rateInput;
    ratePerSqftInr = rateInput / SQFT_PER_ACRE;
  }

  if (normalizedBasis === 'total_cr' && totalPriceCrInput && derivedAreaSqft) {
    const totalPriceInr = totalPriceCrInput * 10000000;
    ratePerSqftInr = totalPriceInr / derivedAreaSqft;
    ratePerAcreInr = ratePerSqftInr * SQFT_PER_ACRE;
  }

  return {
    landPricingBasis: normalizedBasis,
    landPriceRateInr: round(rateInput, 2),
    landExtentInputValue:
      landExtentInputValue === null || landExtentInputValue === undefined || landExtentInputValue === ''
        ? null
        : round(landExtentInputValue, 2),
    landExtentInputUnit: normalizedAreaUnit,
    computedLandAreaSqft: round(derivedAreaSqft, 2),
    computedLandAreaAcres: derivedAreaSqft ? round(derivedAreaSqft / SQFT_PER_ACRE, 4) : null,
    computedLandAskPriceCr: round(computedTotalPriceCr, 4),
    computedLandPricePerSqftInr: round(ratePerSqftInr, 2),
    computedLandPricePerAcreInr: round(ratePerAcreInr, 2),
  };
};

module.exports = {
  SQFT_PER_ACRE,
  round,
  normalizeAreaSqft,
  normalizeAreaUnit: normalizeAreaUnitStrict,
  calculateLandPricing,
};
