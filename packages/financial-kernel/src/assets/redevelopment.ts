/**
 * Redevelopment — residential model with a tenant-rehousing carry cost
 * overlay. Inputs: `rehousingCostCr` (paid to existing occupiers during
 * construction). If absent, behaves identically to `residential_apartments`.
 *
 * Implementation: rehousing is layered into the soft-cost bucket via the
 * residential engine's `extraSoftCostCr` adapter hook, so it flows through
 * the normal approvals schedule and gets picked up by finance-cost,
 * contingency-on-base, and the cash-flow rollup with no post-hoc patching.
 */

import type { DealInputs, KernelResult } from '../types';
import { computeResidential } from './residential';
import { num } from './common';

export function computeRedevelopment(inputs: DealInputs): KernelResult {
  const rehousingCostCr = num(inputs.raw.rehousingCostCr, 0);
  if (rehousingCostCr <= 0) {
    return computeResidential(
      { ...inputs, assetClass: 'redevelopment' },
      { assetClassOverride: 'redevelopment' },
    );
  }

  const existingExtra = num((inputs.raw as Record<string, unknown>).extraSoftCostCr, 0);
  const rawWithRehousing = {
    ...inputs.raw,
    extraSoftCostCr: existingExtra + rehousingCostCr,
  };
  return computeResidential(
    { ...inputs, raw: rawWithRehousing, assetClass: 'redevelopment' },
    { assetClassOverride: 'redevelopment' },
  );
}
