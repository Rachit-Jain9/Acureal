/**
 * Adapter that bridges the TypeScript canonical financial kernel
 * (@redip/financial-kernel, compiled to packages/financial-kernel/dist)
 * into the legacy `calculateFullFinancials` call shape used by the
 * backend service layer.
 *
 * Gated by `FIN_KERNEL_V2 === 'true'`. While V2 is off, this module is
 * loaded lazily only if the flag is set, so a missing dist/ directory
 * never breaks production.
 *
 * This adapter is intentionally conservative: it overrides a small set
 * of KPI fields the kernel computes authoritatively (revenue, total
 * cost, gross profit, margin, IRR, NPV, equity multiple, residual land
 * value) while leaving the legacy engine's downstream shape intact.
 */

'use strict';

let _kernel = null;

const loadKernel = () => {
  if (_kernel) return _kernel;
  try {
    // Resolve relative to this file so the path survives any future monorepo
    // restructure (backend/src/engines/ → packages/financial-kernel/dist/).
    _kernel = require('../../../packages/financial-kernel/dist');
  } catch (err) {
    const msg = 'FIN_KERNEL_V2 is enabled but packages/financial-kernel/dist is not built. ' +
                'Run `npx tsc -p packages/financial-kernel/tsconfig.build.json` and redeploy.';
    throw new Error(`${msg} (underlying: ${err.message})`);
  }
  return _kernel;
};

const isV2Enabled = () =>
  String(process.env.FIN_KERNEL_V2 || '').toLowerCase() === 'true';

/**
 * Map the asset class name used by the service layer to the one
 * supported by the kernel's asset-class registry. Kept deliberately
 * narrow — asset classes the kernel does not yet support fall back to
 * the legacy engine.
 */
const KERNEL_SUPPORTED = new Set([
  'residential_apartments',
  'plotted_development',
  'commercial_office',
  'retail',
  'industrial_warehousing',
  'hospitality',
  'mixed_use',
  'land_parcel',
  'villas',
  'redevelopment',
]);

const mapAssetClass = (cls) => {
  if (cls === 'raw_land') return 'land_parcel';
  return cls;
};

/**
 * Run the kernel and produce a partial KPI overlay that can be merged
 * over the legacy engine output. Returns `null` when the asset class
 * is unsupported or the kernel errors — the caller should then keep
 * the legacy output untouched.
 */
const computeKernelOverlay = (inputs, assetClass) => {
  if (!isV2Enabled()) return null;
  const mapped = mapAssetClass(assetClass);
  if (!KERNEL_SUPPORTED.has(mapped)) return null;

  try {
    const { computeDeal } = loadKernel();
    const result = computeDeal({ assetClass: mapped, raw: inputs });
    const { kpis } = result;
    return {
      kpis: {
        revenue: kpis.revenue.toNumber(),
        totalCost: kpis.totalCost.toNumber(),
        grossProfit: kpis.grossProfit.toNumber(),
        grossMarginPct: kpis.grossMarginPct,
        npv: kpis.npv.toNumber(),
        irr: kpis.irr,
        equityMultiple: kpis.equityMultiple,
        residualLandValue: kpis.residualLandValue ? kpis.residualLandValue.toNumber() : null,
        ...(kpis.extras || {}),
      },
      provenance: result.provenance,
      engineVersion: 'v2',
    };
  } catch (err) {
    // Hard fail in V2 mode: if FIN_KERNEL_V2 is on and the kernel throws
    // on supported inputs, the operator needs to see it rather than
    // silently fall back and mask a regression.
    throw new Error(`kernel.adapter: computeDeal failed for ${mapped}: ${err.message}`);
  }
};

module.exports = {
  isV2Enabled,
  computeKernelOverlay,
};
