/**
 * Legacy snake_case shape adapter.
 *
 * Ports the `_legacy: { ... }` output blocks out of
 * `backend/src/engines/financial.engine.js` (lines 932, 1182, 1540, 2406)
 * into a single pure function. The values already live in the kernel
 * `KernelResult`; this adapter just renames them to the snake_case keys
 * that `backend/src/services/financial.service.js` lines 123-160 pipe
 * into the `financials` DB columns.
 *
 * Any divergence from the legacy shape causes silent DB-column
 * regressions (NULLs written where numbers existed), so every key here
 * is a faithful mirror. Rounding matches legacy: `round4()` for
 * financials (4 dp), `round2()` for areas (2 dp). See legacy engine
 * lines 284-295.
 *
 * Not every asset class emits every key. The four legacy blocks were:
 *   - Residential (32 keys — widest)
 *   - Plotted     (17 keys)
 *   - Income      (11 keys)
 *   - Hospitality (11 keys)
 *
 * We emit the intersection every class writes, plus the asset-specific
 * keys when the kernel surfaces the underlying number. Callers that
 * persist the result just need to map snake_case → DB column.
 */

import type { KernelResult, AssetClass, AssumptionSet } from '../types';
import { Decimal } from '../decimal';

const round2 = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;

const round4 = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;

const toNum = (v: Decimal | number | null | undefined): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Decimal) return v.toNumber();
  // Decimal-like duck typing (postprocess can receive frozen Decimal)
  if (typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    const n = (v as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const pick = <K extends string>(obj: unknown, key: K): number | null => {
  if (!obj || typeof obj !== 'object') return null;
  const v = (obj as Record<string, unknown>)[key];
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return null;
};

export type LegacyShape = Readonly<Record<string, number | null>>;

export interface BuildLegacyShapeArgs {
  /** The raw merged assumption set (what the kernel saw as input). */
  readonly raw: AssumptionSet;
  /** Top-level kernel result. */
  readonly result: KernelResult;
  /** Asset class used for the compute (controls which keys are emitted). */
  readonly assetClass: AssetClass;
}

/**
 * Build the `_legacy.*` snake_case block the backend service persists.
 *
 * Returns a plain object (not frozen) so the caller can merge it into
 * its DB-insert parameter array without an intermediate copy.
 */
export function buildLegacyShape(args: BuildLegacyShapeArgs): LegacyShape {
  const { raw, result, assetClass } = args;
  const { kpis, areas, costs, revenue } = result;

  // ── Common core — every asset class emits these ─────────────────────
  const core: Record<string, number | null> = {
    land_cost_cr:            round4(pick(raw, 'landCostCr')),
    total_cost_cr:           round4(toNum(costs.totalCr)),
    total_revenue_cr:        round4(toNum(revenue.totalRevenueCr)),
    gross_profit_cr:         round4(toNum(revenue.grossProfitCr)),
    gross_margin_pct:        round4(kpis.grossMarginPct),
    npv_cr:                  round4(toNum(kpis.npv)),
    irr_pct:                 round4(kpis.irr),
    equity_multiple:         round4(kpis.equityMultiple),
    project_duration_months: pick(raw, 'projectDurationMonths'),
    discount_rate_pct:       round4(pick(raw, 'discountRatePct')),
  };

  // ── Residential-specific (widest block) ─────────────────────────────
  if (assetClass === 'residential_apartments' || assetClass === 'villas' || assetClass === 'redevelopment') {
    const developerMarginPct = pick(raw, 'developerMarginPct');
    const totalRevenueCr = toNum(revenue.totalRevenueCr);
    const developerProfitCr =
      totalRevenueCr != null && developerMarginPct != null
        ? (totalRevenueCr * developerMarginPct) / 100
        : null;

    return Object.freeze({
      ...core,
      construction_cost_per_sqft: pick(raw, 'constructionCostPerSqft'),
      selling_rate_per_sqft:      pick(raw, 'sellingRatePerSqft'),
      approval_cost_cr:           round4(pick(raw, 'approvalCostCr')),
      marketing_cost_pct:         pick(raw, 'marketingCostPct'),
      finance_cost_pct:           pick(raw, 'financeCostPct'),
      developer_margin_pct:       developerMarginPct,
      developer_profit_cr:        round4(developerProfitCr),
      gross_area_sqft:            round2(areas.grossBuiltUpSqft),
      saleable_area_sqft:         round2(areas.saleableSqft),
      carpet_area_sqft:           round2(areas.carpetSqft),
      super_builtup_area_sqft:    round2(areas.superBuiltUpSqft),
      total_construction_cost_cr: round4(toNum(costs.constructionCr)),
      gst_cost_cr:                round4(toNum(costs.gstCr)),
      stamp_duty_cr:              round4(toNum(costs.stampDutyCr)),
      marketing_cost_cr:          round4(toNum(costs.marketingCr)),
      finance_cost_cr:            round4(toNum(costs.financeCr)),
      residual_land_value_cr:     round4(toNum(kpis.residualLandValue)),
      avg_unit_size_sqft:         round2(pick(areas.extras ?? null, 'avgUnitSizeSqft')),
      number_of_units:            pick(areas.extras ?? null, 'numberOfUnits'),
      plot_area_sqft:             pick(raw, 'plotAreaSqft'),
      fsi:                        pick(raw, 'fsi'),
      loading_factor:             pick(raw, 'loadingFactor'),
    });
  }

  // ── Plotted development ─────────────────────────────────────────────
  if (assetClass === 'plotted_development') {
    return Object.freeze({
      ...core,
      plot_area_sqft:           pick(raw, 'totalLandSqft'),
      fsi:                      1,  // layouts carry no vertical build; loading=0
      loading_factor:           0,
      selling_rate_per_sqft:    pick(raw, 'sellingRatePerSqft'),
      approval_cost_cr:         round4(pick(raw, 'approvalCostCr')),
      marketing_cost_pct:       pick(raw, 'marketingCostPct'),
      finance_cost_pct:         pick(raw, 'financeCostPct'),
      total_construction_cost_cr: round4(toNum(costs.constructionCr)),
      gst_cost_cr:                round4(toNum(costs.gstCr)),
      stamp_duty_cr:              round4(toNum(costs.stampDutyCr)),
      residual_land_value_cr:   round4(toNum(kpis.residualLandValue)),
    });
  }

  // ── Land parcel ─────────────────────────────────────────────────────
  if (assetClass === 'land_parcel') {
    return Object.freeze({
      ...core,
      plot_area_sqft:       pick(raw, 'totalLandSqft'),
      stamp_duty_cr:        round4(toNum(costs.stampDutyCr)),
      residual_land_value_cr: round4(toNum(kpis.residualLandValue)),
    });
  }

  // ── Income (office/retail/industrial) ───────────────────────────────
  if (
    assetClass === 'commercial_office'
    || assetClass === 'retail'
    || assetClass === 'industrial_warehousing'
    || assetClass === 'mixed_use'
  ) {
    return Object.freeze({
      ...core,
      construction_cost_per_sqft: pick(raw, 'constructionCostPerSqft'),
      total_construction_cost_cr: round4(toNum(costs.constructionCr)),
      gst_cost_cr:                round4(toNum(costs.gstCr)),
      stamp_duty_cr:              round4(toNum(costs.stampDutyCr)),
    });
  }

  // ── Hospitality ─────────────────────────────────────────────────────
  if (assetClass === 'hospitality') {
    // Legacy hospitality reports gross_margin_pct as EBITDA margin.
    const ebitdaMarginPct = pick(kpis.extras ?? null, 'ebitdaMarginPct');
    return Object.freeze({
      ...core,
      gross_margin_pct:           round4(ebitdaMarginPct ?? kpis.grossMarginPct),
      total_construction_cost_cr: round4(toNum(costs.constructionCr)),
      gst_cost_cr:                round4(toNum(costs.gstCr)),
      stamp_duty_cr:              round4(toNum(costs.stampDutyCr)),
    });
  }

  return Object.freeze(core);
}
