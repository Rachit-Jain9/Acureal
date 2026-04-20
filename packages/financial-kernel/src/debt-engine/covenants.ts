/**
 * Covenant outputs: DSCR, LTC, LTV, minimum cash. Deterministic and
 * provenance-tagged. Inputs are monthly series; outputs are per-month
 * covenant results (one per test tick).
 */

import { Decimal } from '../decimal';
import { prov } from '../provenance';
import type { ProvenanceEntry } from '../types';
import type { CovenantResult, CovenantSpec, DebtScheduleAggregate } from './types';

export interface CovenantInputs {
  readonly cfadsMonthly: readonly Decimal[];
  /** Total projected project cost (₹ Cr). Used for LTC. */
  readonly projectCostCr: Decimal;
  /** Appraised / exit asset value by month (₹ Cr). Used for LTV. */
  readonly assetValueByMonth?: readonly Decimal[];
  /** Cash balance by month (₹ Cr). Used for minCash. */
  readonly cashByMonth?: readonly Decimal[];
  readonly spec?: CovenantSpec;
}

export function computeCovenants(
  debt: DebtScheduleAggregate,
  inputs: CovenantInputs,
): {
  readonly monthly: readonly CovenantResult[];
  readonly minDSCR: number | null;
  readonly maxLTC: number | null;
  readonly maxLTV: number | null;
  readonly minCash: number | null;
  readonly breaches: readonly string[];
  readonly provenance: readonly ProvenanceEntry[];
} {
  const n = debt.totalMonths;
  const freq = inputs.spec?.testFrequencyMonths ?? 1;
  const monthly: CovenantResult[] = [];
  const breaches: string[] = [];

  let minDSCR: number | null = null;
  let maxLTC: number | null = null;
  let maxLTV: number | null = null;
  let minCash: number | null = null;

  for (let m = 0; m < n; m++) {
    if (m % freq !== 0) continue;
    const ds = debt.monthlyDebtService[m];
    const cfads = at(inputs.cfadsMonthly, m);
    const dscr = ds.isZero() ? null : toNumberSafe(cfads) / toNumberSafe(ds);
    const outstanding = debt.closingBalanceByMonth[m];

    const costCr = toNumberSafe(inputs.projectCostCr);
    const ltc = costCr > 0 ? toNumberSafe(outstanding) / costCr : null;
    const assetVal = inputs.assetValueByMonth ? at(inputs.assetValueByMonth, m) : null;
    const ltv = assetVal && assetVal.isPositive()
      ? toNumberSafe(outstanding) / toNumberSafe(assetVal)
      : null;
    const cash = inputs.cashByMonth ? toNumberSafe(at(inputs.cashByMonth, m)) : null;

    const monthBreaches: string[] = [];
    const s = inputs.spec ?? {};
    if (s.minDSCR != null && dscr != null && dscr < s.minDSCR) {
      monthBreaches.push(`DSCR ${dscr.toFixed(3)} < ${s.minDSCR} @ m${m}`);
    }
    if (s.maxLTC != null && ltc != null && ltc > s.maxLTC) {
      monthBreaches.push(`LTC ${ltc.toFixed(3)} > ${s.maxLTC} @ m${m}`);
    }
    if (s.maxLTV != null && ltv != null && ltv > s.maxLTV) {
      monthBreaches.push(`LTV ${ltv.toFixed(3)} > ${s.maxLTV} @ m${m}`);
    }
    if (s.minCashCr != null && cash != null && cash < s.minCashCr) {
      monthBreaches.push(`cash ${cash.toFixed(3)} < ${s.minCashCr} @ m${m}`);
    }
    breaches.push(...monthBreaches);

    monthly.push({ month: m, dscr, ltc, ltv, minCash: cash, breaches: monthBreaches });

    if (dscr != null) minDSCR = minDSCR == null ? dscr : Math.min(minDSCR, dscr);
    if (ltc != null) maxLTC = maxLTC == null ? ltc : Math.max(maxLTC, ltc);
    if (ltv != null) maxLTV = maxLTV == null ? ltv : Math.max(maxLTV, ltv);
    if (cash != null) minCash = minCash == null ? cash : Math.min(minCash, cash);
  }

  return {
    monthly,
    minDSCR,
    maxLTC,
    maxLTV,
    minCash,
    breaches,
    provenance: [prov('debt.covenants', 'kernel.debtEngine.covenants', 'dscr/ltc/ltv/minCash per test tick')],
  };
}

function at(series: readonly Decimal[], i: number): Decimal {
  return i >= 0 && i < series.length ? series[i] : Decimal.zero();
}

function toNumberSafe(d: Decimal): number {
  try {
    return d.toNumber();
  } catch {
    return 0;
  }
}
