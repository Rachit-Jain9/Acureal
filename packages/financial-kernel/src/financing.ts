/**
 * Capital stack / financing computations. Pure functions only.
 *
 * Master-parity: construction-phase interest accrues on a quarterly S-curve
 * draw schedule with capitalised interest (see `debtSchedule.ts`), matching
 * `backend/src/engines/financial.engine.js` PRs #4–#7. The carry window is
 * capped at `min(constructionMonths, debtTenorMonths)` so finance costs do
 * not balloon over the full hold period.
 */

import { Decimal } from './decimal';
import { buildDrawSchedule, type DrawScheduleResult } from './debtSchedule';
import { prov } from './provenance';
import type { FinancingOutput, ProvenanceEntry } from './types';

export interface FinancingInputs {
  readonly totalCost: Decimal;
  readonly debtableBase: Decimal;
  readonly debtLTV: number;
  /** LTC covenant — informational; debt still sized via debtLTV × debtableBase. */
  readonly debtLTC?: number;
  readonly debtRatePct: number;
  readonly constructionMonths: number;
  readonly debtTenorMonths?: number;
  readonly amortizationYears?: number;
}

export interface FinancingOutputWithSchedule extends FinancingOutput {
  readonly drawSchedule: DrawScheduleResult | null;
}

/**
 * Quarterly S-curve capitalised-interest model. Debt is sized at
 * `debtLTV × debtableBase`; the principal is drawn over the carry window on
 * an S-curve and interest accrues (compounds quarterly) on the outstanding
 * balance. Mirrors master's `buildDrawSchedule` byte-for-byte.
 */
export function buildFinancing({
  totalCost,
  debtableBase,
  debtLTV,
  debtLTC,
  debtRatePct,
  constructionMonths,
  debtTenorMonths,
  amortizationYears,
}: FinancingInputs): FinancingOutputWithSchedule {
  const clampedLTV = Math.max(0, Math.min(1, debtLTV));
  const clampedLTC = debtLTC != null ? Math.max(0, Math.min(1, debtLTC)) : null;
  const rate = Math.max(0, debtRatePct);
  const months = Math.max(0, constructionMonths);
  const tenorCapMonths =
    debtTenorMonths != null && debtTenorMonths > 0 ? Math.min(months, debtTenorMonths) : months;

  const debtDrawn = debtableBase.mulNumber(clampedLTV);

  let drawSchedule: DrawScheduleResult | null = null;
  let debtInterest = Decimal.zero();
  if (clampedLTV > 0 && debtDrawn.toNumber() > 0 && tenorCapMonths > 0 && rate > 0) {
    const totalQ = Math.max(1, Math.ceil(tenorCapMonths / 3));
    drawSchedule = buildDrawSchedule({
      principalCr: debtDrawn.toNumber(),
      annualRatePct: rate,
      totalQuarters: totalQ,
      drawStartQ: 1,
      drawEndQ: totalQ,
      capitalizeInterest: true,
    });
    debtInterest = Decimal.fromNumber(drawSchedule.totalInterestCr);
  }

  const equityInvested = totalCost.sub(debtDrawn).add(debtInterest);

  const provenance: ProvenanceEntry[] = [
    prov('financing.debtDrawn', 'input.debtLTV×debtableBase', 'debtLTV × debtableBase'),
    prov(
      'financing.debtInterest',
      'derived.drawSchedule.totalInterestCr',
      'quarterly S-curve draws × (1+rate)^(1/4)−1 compounding, capitalised',
    ),
    prov(
      'financing.equityInvested',
      'derived.totalCost - debtDrawn + debtInterest',
      'totalCost − debtDrawn + debtInterest (capitalised)',
    ),
  ];

  return {
    debtLTV: clampedLTV,
    debtLTC: clampedLTC,
    debtRatePct: rate,
    debtTenorMonths: debtTenorMonths != null && debtTenorMonths > 0 ? debtTenorMonths : null,
    amortizationYears:
      amortizationYears != null && amortizationYears > 0 ? amortizationYears : null,
    debtDrawn,
    debtInterest,
    equityInvested,
    drawSchedule,
    provenance,
  };
}
