/**
 * Client-side reactive what-if compute.
 *
 * Imports the canonical kernel directly into the Vite bundle and mirrors
 * the server `/financials/quick-compute` route's response shape, so the
 * reactive slider path can skip the HTTP round-trip entirely. Same code
 * on both sides (the kernel is a workspace package), so client and
 * server results are byte-for-byte identical by construction.
 *
 * The server route still exists and remains authoritative for anything
 * that needs server-side bookkeeping (audit log, scenario persistence,
 * HMAC-signed events). This helper is intentionally narrow: input → KPIs
 * for the live slider UX.
 */

import {
  computeDeal,
  isSupportedAssetClass,
  DealInputError,
} from '@redip/kernel-browser';

// Matches the server route's `toNum` helper — Decimals have `.toNumber()`;
// primitives pass through. The kernel keeps high-precision decimals
// internally but the UI only needs display numbers.
const toNum = (d) => (d && typeof d.toNumber === 'function' ? d.toNumber() : d);

/**
 * Run a quick-compute pass entirely in-browser.
 *
 * @param {object} raw  The asset-class raw inputs (same shape the server
 *                      route accepts — assetClass + whatever fields the
 *                      model needs).
 * @returns {{ success: true, data: object } | { success: false, status: number, message: string }}
 *                      Same envelope the API wrapper returns so callers
 *                      don't need a separate code path.
 */
export function clientQuickCompute(raw) {
  const assetClass = raw?.assetClass || 'residential_apartments';

  if (!isSupportedAssetClass(assetClass)) {
    return {
      success: false,
      status: 422,
      message: `Asset class "${assetClass}" is not supported by the kernel.`,
    };
  }

  try {
    const result = computeDeal({ assetClass, raw });
    const { kpis, costs, revenue, areas } = result;

    return {
      success: true,
      data: {
        assetClass,
        engineVersion: 'v2-client',
        kpis: {
          revenue: toNum(kpis.revenue),
          totalCost: toNum(kpis.totalCost),
          grossProfit: toNum(kpis.grossProfit),
          grossMarginPct: kpis.grossMarginPct,
          npv: toNum(kpis.npv),
          irr: kpis.irr,
          equityMultiple: kpis.equityMultiple,
          residualLandValue: kpis.residualLandValue
            ? toNum(kpis.residualLandValue)
            : null,
          ...(kpis.extras || {}),
        },
        costs: costs
          ? Object.fromEntries(
              Object.entries(costs).map(([k, v]) => [k, toNum(v)]),
            )
          : null,
        revenue: revenue
          ? Object.fromEntries(
              Object.entries(revenue).map(([k, v]) => [k, toNum(v)]),
            )
          : null,
        areas: areas || null,
      },
    };
  } catch (err) {
    // DealInputError → 422 (same policy as the server route). Everything
    // else surfaces as a generic 500 so the slider panel can render an
    // inline error without assuming network failure.
    if (err && (err.name === 'DealInputError' || err instanceof DealInputError)) {
      return { success: false, status: 422, message: err.message };
    }
    return {
      success: false,
      status: 500,
      message: `quick-compute failed: ${err?.message || 'unknown error'}`,
    };
  }
}

/**
 * Feature flag — `VITE_CLIENT_KERNEL=0` at build time forces the server
 * path. Default is client-side because the UX gain (no HTTP round-trip)
 * is material for slider scrubbing, and parity is structural not tested.
 */
export function useClientKernel() {
  const flag = import.meta.env?.VITE_CLIENT_KERNEL;
  return flag !== '0' && flag !== 'false';
}
