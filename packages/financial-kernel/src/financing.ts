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
  readonly debtRatePct: number;
  readonly constructionMonths: number;
}

/**
 * Simple capitalised-interest model: debt is drawn against `debtableBase`
 * at `debtLTV`; interest accrues on the drawn balance over
 * `constructionMonths` at `debtRatePct` annual.
 */
export function buildFinancing({
  totalCost,
  debtableBase,
  debtLTV,
  debtRatePct,
  constructionMonths,
}: FinancingInputs): FinancingOutput {
  const clampedLTV = Math.max(0, Math.min(1, debtLTV));
  const rate = Math.max(0, debtRatePct);
  const months = Math.max(0, constructionMonths);

  const debtDrawn = debtableBase.mulNumber(clampedLTV);
  const debtInterest =
    clampedLTV > 0
      ? debtDrawn.mulNumber(rate / 100).mulNumber(months / 12)
      : Decimal.zero();
  const equityInvested = totalCost.sub(debtDrawn).add(debtInterest);

  const provenance: ProvenanceEntry[] = [
    prov('financing.debtDrawn', 'input.debtLTV×debtableBase', 'debtLTV × debtableBase'),
    prov('financing.debtInterest', 'derived.debtDrawn×rate×tenor', 'debtDrawn × (debtRatePct/100) × (constructionMonths/12)'),
    prov(
      'financing.equityInvested',
      'derived.totalCost - debtDrawn + debtInterest',
      'totalCost − debtDrawn + debtInterest (capitalised)',
    ),
  ];

  return {
    debtLTV: clampedLTV,
    debtRatePct: rate,
    debtDrawn,
    debtInterest,
    equityInvested,
    provenance,
  };
}
