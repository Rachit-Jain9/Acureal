/**
 * Capital stack / financing computations. Pure functions only.
 */

import { Decimal } from './decimal';
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
  /**
   * Loan term (months). When > 0 and < constructionMonths, caps the
   * capitalised-interest carry window at loan maturity. Mirrors master's
   * PR #7 "cap finance carry at loan term" behaviour.
   */
  readonly debtTenorMonths?: number;
  /** Amortization years — pass-through; not used by the simple accrual model. */
  readonly amortizationYears?: number;
}

/**
 * Simple capitalised-interest model: debt is drawn against `debtableBase`
 * at `debtLTV`; interest accrues on the drawn balance over the carry
 * window at `debtRatePct` annual. The carry window is `constructionMonths`
 * unless `debtTenorMonths` is smaller, in which case it is capped at the
 * loan term.
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
}: FinancingInputs): FinancingOutput {
  const clampedLTV = Math.max(0, Math.min(1, debtLTV));
  const clampedLTC = debtLTC != null ? Math.max(0, Math.min(1, debtLTC)) : null;
  const rate = Math.max(0, debtRatePct);
  const months = Math.max(0, constructionMonths);
  const tenorCap = debtTenorMonths != null && debtTenorMonths > 0
    ? Math.min(months, debtTenorMonths)
    : months;

  const debtDrawn = debtableBase.mulNumber(clampedLTV);
  const debtInterest =
    clampedLTV > 0
      ? debtDrawn.mulNumber(rate / 100).mulNumber(tenorCap / 12)
      : Decimal.zero();
  const equityInvested = totalCost.sub(debtDrawn).add(debtInterest);

  const provenance: ProvenanceEntry[] = [
    prov('financing.debtDrawn', 'input.debtLTV×debtableBase', 'debtLTV × debtableBase'),
    prov(
      'financing.debtInterest',
      'derived.debtDrawn×rate×carryMonths',
      'debtDrawn × (debtRatePct/100) × (min(constructionMonths, debtTenorMonths)/12)',
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
    provenance,
  };
}
