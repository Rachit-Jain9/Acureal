/**
 * Redevelopment — residential model with a tenant-rehousing carry cost
 * overlay. Inputs: `rehousingCostCr` (paid to existing occupiers during
 * construction). If absent, behaves identically to `residential_apartments`.
 */

import type { DealInputs, KernelResult, MonthlyLineItem } from '../types';
import { computeResidential } from './residential';
import { D, num, uniformAcrossProject } from './common';

export function computeRedevelopment(inputs: DealInputs): KernelResult {
  const rehousingCostCr = num(inputs.raw.rehousingCostCr, 0);
  const base = computeResidential(
    { ...inputs, assetClass: 'redevelopment' },
    { assetClassOverride: 'redevelopment' },
  );
  if (rehousingCostCr <= 0) return base;

  const extraItem: MonthlyLineItem = uniformAcrossProject({
    period: base.period,
    amount: D(rehousingCostCr),
    category: 'soft_cost',
    subcategory: 'rehousing',
  });

  const items = [...base.cashFlow.items, extraItem];
  // Rebuild net via residential finalizer would require input round-trip;
  // a cleaner approach is to rebuild through `computeResidential` after
  // injecting rehousing into the raw budget. Done that way to keep all
  // summation math in `finalizeResult`.
  const rawWithRehousing = {
    ...inputs.raw,
    // Add rehousing as a dedicated cost; residential rolls it into soft costs.
    _kernelExtraSoftCostCr: rehousingCostCr,
  };
  void items; // silence unused
  return computeResidential(
    { ...inputs, raw: rawWithRehousing, assetClass: 'redevelopment' },
    { assetClassOverride: 'redevelopment' },
  );
}
