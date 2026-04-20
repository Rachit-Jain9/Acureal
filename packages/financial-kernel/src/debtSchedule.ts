/**
 * Master-parity debt schedule primitives.
 *
 * Ported verbatim from `backend/src/engines/financial.engine.js` (master PRs
 * #4–#7) so the kernel emits the same quarterly S-curve construction-draw
 * schedule and amortizing operating-phase schedule as the legacy engine.
 * Kept as pure `number` arithmetic (not Decimal) — master uses floats, and
 * matching it byte-for-byte is the whole point of this module.
 *
 * Upstream shape and variable names are preserved so future master bugfixes
 * can be ported across without semantic drift.
 */

/** S-curve weights summing to 1 across `n` quarters. */
export function sCurveWeights(n: number): number[] {
  const weights = Array.from({ length: n }, (_, q) => {
    const p = (q + 1) / n;
    return Math.max(0.01, Math.sin(p * Math.PI) * 1.5);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

export interface DrawScheduleInputs {
  readonly principalCr: number;
  readonly annualRatePct: number;
  readonly totalQuarters: number;
  readonly drawStartQ: number;
  readonly drawEndQ: number;
  readonly repaymentQ?: number;
  readonly capitalizeInterest?: boolean;
}

export interface DrawScheduleResult {
  readonly draws: number[];
  readonly balances: number[];
  readonly interest: number[];
  readonly totalInterestCr: number;
  readonly totalPrincipalCr: number;
  readonly repaymentQ: number;
}

/**
 * Quarterly debt-draw schedule with capitalised interest. S-curve draws
 * across `[drawStartQ, drawEndQ]`; interest accrues on the outstanding
 * balance each quarter and is optionally rolled into the balance.
 */
export function buildDrawSchedule({
  principalCr,
  annualRatePct,
  totalQuarters,
  drawStartQ,
  drawEndQ,
  repaymentQ,
  capitalizeInterest = true,
}: DrawScheduleInputs): DrawScheduleResult {
  const draws = new Array(totalQuarters + 1).fill(0);
  const balances = new Array(totalQuarters + 1).fill(0);
  const interest = new Array(totalQuarters + 1).fill(0);

  if (!(principalCr > 0) || !(annualRatePct >= 0) || !(totalQuarters >= 1)) {
    return {
      draws,
      balances,
      interest,
      totalInterestCr: 0,
      totalPrincipalCr: 0,
      repaymentQ: repaymentQ ?? totalQuarters,
    };
  }

  const qRate = Math.pow(1 + annualRatePct / 100, 0.25) - 1;
  const startQ = Math.max(1, Math.floor(drawStartQ));
  const endQ = Math.max(startQ, Math.min(totalQuarters, Math.ceil(drawEndQ)));
  const durationQ = Math.max(1, endQ - startQ + 1);
  const weights = sCurveWeights(durationQ);
  for (let i = 0; i < durationQ; i++) {
    const q = startQ + i;
    if (q <= totalQuarters) draws[q] = principalCr * weights[i];
  }

  let balance = 0;
  let totalInterest = 0;
  for (let q = 0; q <= totalQuarters; q++) {
    balance += draws[q];
    const accr = balance * qRate;
    interest[q] = accr;
    totalInterest += accr;
    balance += capitalizeInterest ? accr : 0;
    balances[q] = balance;
  }

  return {
    draws,
    balances,
    interest,
    totalInterestCr: totalInterest,
    totalPrincipalCr: principalCr,
    repaymentQ: repaymentQ ?? totalQuarters,
  };
}

export interface AmortizingScheduleInputs {
  readonly principalCr: number;
  readonly annualRatePct: number;
  readonly amortizationYears: number;
  readonly drawQ: number;
  readonly operatingStartQ: number;
  readonly exitQ: number;
  readonly totalQuarters: number;
}

export interface AmortizingScheduleResult {
  readonly draws: number[];
  readonly interestPayments: number[];
  readonly principalPayments: number[];
  readonly debtService: number[];
  readonly balances: number[];
  readonly balloonRepaymentCr: number;
  readonly totalInterestCr: number;
  readonly quarterlyPayment: number;
}

/**
 * Amortizing (annuity) schedule for income-asset operating phases. Quarterly
 * P&I during operations, residual principal balloons at `exitQ`.
 */
export function buildAmortizingSchedule({
  principalCr,
  annualRatePct,
  amortizationYears,
  drawQ,
  operatingStartQ,
  exitQ,
  totalQuarters,
}: AmortizingScheduleInputs): AmortizingScheduleResult {
  const draws = new Array(totalQuarters + 1).fill(0);
  const interestPayments = new Array(totalQuarters + 1).fill(0);
  const principalPayments = new Array(totalQuarters + 1).fill(0);
  const debtService = new Array(totalQuarters + 1).fill(0);
  const balances = new Array(totalQuarters + 1).fill(0);

  if (!(principalCr > 0) || !(annualRatePct > 0)) {
    return {
      draws,
      interestPayments,
      principalPayments,
      debtService,
      balances,
      balloonRepaymentCr: 0,
      totalInterestCr: 0,
      quarterlyPayment: 0,
    };
  }

  const qRate = Math.pow(1 + annualRatePct / 100, 0.25) - 1;
  const nQ = Math.max(4, Math.round(amortizationYears * 4));
  const quarterlyPayment =
    qRate > 0
      ? (principalCr * (qRate * Math.pow(1 + qRate, nQ))) / (Math.pow(1 + qRate, nQ) - 1)
      : principalCr / nQ;

  const fundQ = Math.max(1, Math.floor(drawQ));
  const opStart = Math.max(fundQ, Math.floor(operatingStartQ));
  const opEnd = Math.min(totalQuarters, Math.floor(exitQ));
  draws[fundQ] = principalCr;

  let balance = 0;
  let totalInterest = 0;
  for (let q = 0; q <= totalQuarters; q++) {
    balance += draws[q];

    if (q >= opStart && q <= opEnd && balance > 0) {
      const interest = balance * qRate;
      const principal = Math.max(0, Math.min(balance, quarterlyPayment - interest));
      interestPayments[q] = interest;
      principalPayments[q] = principal;
      debtService[q] = interest + principal;
      balance -= principal;
      totalInterest += interest;
    }

    balances[q] = balance;
  }

  const balloonRepaymentCr = balances[opEnd] || 0;
  if (opEnd >= 0 && opEnd <= totalQuarters) {
    principalPayments[opEnd] += balloonRepaymentCr;
    debtService[opEnd] += balloonRepaymentCr;
    balances[opEnd] = 0;
    for (let q = opEnd + 1; q <= totalQuarters; q++) balances[q] = 0;
  }

  return {
    draws,
    interestPayments,
    principalPayments,
    debtService,
    balances,
    balloonRepaymentCr,
    totalInterestCr: totalInterest,
    quarterlyPayment,
  };
}
