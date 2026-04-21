import { SQFT_PER_ACRE } from '../config/india';

export { SQFT_PER_ACRE };

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const round = (value, decimals = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
};

export const normalizeAreaSqft = (value, unit = 'sqft') => {
  const num = toNumber(value);
  if (!num || num <= 0) {
    return null;
  }

  return unit === 'acre' ? num * SQFT_PER_ACRE : num;
};

export const buildLandPricingPreview = ({
  pricingBasis = 'total_cr',
  totalPriceCr,
  rateInr,
  extentValue,
  extentUnit = 'sqft',
  fallbackAreaSqft,
}) => {
  const totalInputCr = toNumber(totalPriceCr);
  const rateInputInr = toNumber(rateInr);
  const areaSqft = normalizeAreaSqft(extentValue, extentUnit) || toNumber(fallbackAreaSqft);

  let computedTotalCr = totalInputCr;
  let perSqftInr = null;
  let perAcreInr = null;

  if (pricingBasis === 'per_sqft' && rateInputInr && areaSqft) {
    computedTotalCr = (rateInputInr * areaSqft) / 10000000;
    perSqftInr = rateInputInr;
    perAcreInr = rateInputInr * SQFT_PER_ACRE;
  }

  if (pricingBasis === 'per_acre' && rateInputInr && areaSqft) {
    const areaAcres = areaSqft / SQFT_PER_ACRE;
    computedTotalCr = (rateInputInr * areaAcres) / 10000000;
    perAcreInr = rateInputInr;
    perSqftInr = rateInputInr / SQFT_PER_ACRE;
  }

  if (pricingBasis === 'total_cr' && totalInputCr && areaSqft) {
    perSqftInr = (totalInputCr * 10000000) / areaSqft;
    perAcreInr = perSqftInr * SQFT_PER_ACRE;
  }

  return {
    areaSqft: round(areaSqft, 2),
    areaAcres: areaSqft ? round(areaSqft / SQFT_PER_ACRE, 4) : null,
    totalPriceCr: round(computedTotalCr, 4),
    ratePerSqftInr: round(perSqftInr, 2),
    ratePerAcreInr: round(perAcreInr, 2),
  };
};
