/**
 * Quarterly proforma post-processor — sources-and-uses waterfall.
 *
 * Shapes the kernel's per-month `MonthlyLineItem` series into a
 * quarter × category matrix that reads like an institutional proforma:
 * outflows on top (Uses), inflows below (Sources), signed cells, per-
 * quarter net, running cumulative equity deployment, peak-deployment
 * marker. Row totals reconcile against `result.costs.*` / `result.revenue.*`
 * within rounding tolerance; that reconciliation is what keeps this view
 * honest.
 *
 * Quarter windows cover exactly three calendar months from the effective
 * date:
 *
 *     Q1: effectiveDate ............... eff + 3mo − 1 day
 *     Q2: eff + 3mo ................... eff + 6mo − 1 day
 *     ...
 *     QN (last): eff + (N−1)·3mo ...... eff + totalMonths − 1 day
 *
 * Last quarter may be partial (1–3 months) when `totalMonths` is not a
 * multiple of three; the end date is capped at the project horizon rather
 * than bleeding past it. This mirrors investor-facing proforma convention
 * (calendar-anchored, no off-by-one construction row) and is *intentionally
 * distinct* from the off-by-one quarter layout of `buildCashFlows` — a
 * proforma line item has to land in the quarter where the cash actually
 * moves.
 *
 * Cell sign convention:
 *   - Outflows: negative (investor convention — capital leaving the deal).
 *   - Inflows: positive.
 *   - Per-quarter `net` = sum of all signed cells.
 *   - `cumulative[q]` is the running net after quarter q+1. The minimum
 *     is `peakDeployment` (most-negative equity-at-risk), and the quarter
 *     it occurs in is `peakDeploymentQuarter` (1-indexed, null if no
 *     deployment).
 *
 * Rows collapse identical `(category, subcategory, sign)` triples — some
 * adapters emit approvals as two items (`upfront` + `remaining`); those
 * render as two rows because their subcategories differ. That keeps the
 * table legible without requiring the caller to know which asset class
 * produced the line items.
 */

import type { Decimal } from '../decimal';
import type { FlowSign, KernelResult, MonthlyLineItem } from '../types';
import { addUtcDays, addUtcMonths, normalizeEffectiveDate } from './cashFlows';

// ── Helpers ────────────────────────────────────────────────────────────────

const round4 = (n: number): number =>
  Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;

const toNum = (d: Decimal): number => {
  const n = d.toNumber();
  return Number.isFinite(n) ? n : 0;
};

// ── Shape types ─────────────────────────────────────────────────────────────

export interface ProformaQuarterCell {
  readonly quarter: number; // 1-indexed
  readonly label: string; // "Q1", "Q2", …
  readonly startDate: string;
  readonly endDate: string;
  readonly period: string; // "YYYY-MM-DD to YYYY-MM-DD"
}

export interface ProformaRow {
  readonly category: string;
  readonly subcategory: string | null;
  readonly sign: FlowSign;
  readonly label: string; // display label
  readonly cells: readonly number[]; // length === quarters.length; signed
  readonly total: number; // sum of cells
}

export interface ProformaSection {
  readonly key: 'inflows' | 'outflows';
  readonly label: string;
  readonly rows: readonly ProformaRow[];
  readonly subtotals: readonly number[]; // length === quarters.length
  readonly total: number;
}

export interface ProformaSummary {
  readonly quarters: readonly ProformaQuarterCell[];
  readonly inflows: ProformaSection;
  readonly outflows: ProformaSection;
  readonly net: readonly number[]; // per-quarter inflows + outflows (signed)
  readonly cumulative: readonly number[]; // running sum of net
  readonly peakDeployment: number; // min(cumulative); 0 if never negative
  readonly peakDeploymentQuarter: number | null; // 1-indexed
}

// ── Label tables ────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  land: 'Land acquisition',
  approvals: 'Approvals',
  hard_cost: 'Hard costs',
  soft_cost: 'Soft costs',
  finance_cost: 'Finance cost',
  revenue: 'Revenue',
});

const SUBCATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'land+stamp': 'Land + stamp duty',
  upfront: 'Approvals (upfront)',
  remaining: 'Approvals (remaining)',
  'construction+gst+contingency': 'Construction + GST + contingency',
  ffe_ose_1: 'FF&E + OS&E (phase 1)',
  ffe_ose_2: 'FF&E + OS&E (phase 2)',
  'architect+pmc': 'Architecture + PMC',
  marketing: 'Marketing',
  finance: 'Finance drag',
  'TI+LC': 'Tenant improvements + leasing',
  holding_cost: 'Holding cost',
  pre_opening_wc: 'Pre-opening + working capital',
  idc: 'Interest during construction',
  sales: 'Unit sales',
  exit: 'Exit sale',
  land_sale: 'Land sale',
});

function buildRowLabel(category: string, subcategory: string | null): string {
  if (subcategory && SUBCATEGORY_LABELS[subcategory]) {
    return SUBCATEGORY_LABELS[subcategory];
  }
  if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
  if (subcategory) return `${category} — ${subcategory}`;
  return category;
}

// Stable ordering of rows within each section.
const OUTFLOW_CATEGORY_ORDER: readonly string[] = Object.freeze([
  'land',
  'approvals',
  'hard_cost',
  'soft_cost',
  'finance_cost',
]);

const INFLOW_CATEGORY_ORDER: readonly string[] = Object.freeze(['revenue']);

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build a quarterly proforma from a `KernelResult`. Pure — no I/O, no
 * provider calls, no randomness. Runs in O(items × months); the proforma
 * view is intended to be rendered on every deal refresh.
 *
 * Kernel convention: monthly arrays have `totalMonths + 1` slots (month 0
 * = effective date, month `totalMonths` = project end / exit). We map all
 * slots into quarters of three — the final quarter may be partial when
 * `totalMonths + 1` is not divisible by three; rather than creating a
 * stub one-month Q-N+1, we fold the last overflow slot into the final
 * full quarter so every cash-flow touch point is represented without
 * introducing a cosmetically awkward partial-quarter column.
 */
export function buildQuarterlyProforma(result: KernelResult): ProformaSummary {
  const effectiveDate = normalizeEffectiveDate(result.period.effectiveDate);
  const totalMonths = Math.max(0, result.period.totalMonths | 0);
  // Cash-flow arrays are indexed 0..totalMonths inclusive.
  const slotCount = totalMonths + 1;
  // Number of whole quarters that cover months 0..totalMonths. For a
  // 36-month project (37 slots), that's 12 quarters; slot 36 folds into Q12.
  const quarterCount = Math.max(1, Math.ceil(totalMonths / 3));

  // Map a monthly slot index into a quarter index [0, quarterCount-1].
  // Slots beyond the last whole quarter collapse into the final quarter so
  // exit-month entries (often placed at month === totalMonths) reconcile
  // into Q-last rather than disappearing or spawning a partial QN+1.
  const quarterForSlot = (m: number): number => {
    const q = Math.floor(m / 3);
    return q >= quarterCount ? quarterCount - 1 : q;
  };

  // ── 1. Quarter headers ────────────────────────────────────────────────────
  const quarters: ProformaQuarterCell[] = [];
  for (let q = 1; q <= quarterCount; q++) {
    const startDate = addUtcMonths(effectiveDate, (q - 1) * 3);
    // Last quarter's end is pinned at the project horizon (effectiveDate +
    // totalMonths); earlier quarters end at start + 3 months − 1 day.
    const endMonthsOffset = q === quarterCount ? totalMonths : q * 3;
    const endDate = addUtcDays(addUtcMonths(effectiveDate, endMonthsOffset), -1);
    quarters.push({
      quarter: q,
      label: `Q${q}`,
      startDate,
      endDate,
      period: `${startDate} to ${endDate}`,
    });
  }
  void slotCount; // kept for readers; quarterForSlot handles the mapping

  // ── 2. Accumulate items into (cat, sub, sign) rows ────────────────────────
  type AccRow = {
    category: string;
    subcategory: string | null;
    sign: FlowSign;
    cells: number[];
  };
  const rowMap = new Map<string, AccRow>();
  const keyFor = (cat: string, sub: string | null, sign: FlowSign) =>
    `${sign}|${cat}|${sub ?? ''}`;

  const items: readonly MonthlyLineItem[] = result.cashFlow.items;
  for (const item of items) {
    const sub = item.subcategory ?? null;
    const key = keyFor(item.category, sub, item.sign);
    let row = rowMap.get(key);
    if (!row) {
      row = {
        category: item.category,
        subcategory: sub,
        sign: item.sign,
        cells: new Array(quarterCount).fill(0),
      };
      rowMap.set(key, row);
    }
    const signMul = item.sign === 'outflow' ? -1 : 1;
    for (let m = 0; m < item.values.length; m++) {
      const q = quarterForSlot(m);
      if (q < 0 || q >= quarterCount) continue;
      row.cells[q] += toNum(item.values[m]) * signMul;
    }
  }

  // ── 3. Shape each section ─────────────────────────────────────────────────
  const buildSection = (
    sign: FlowSign,
    label: string,
    key: 'inflows' | 'outflows',
    order: readonly string[],
  ): ProformaSection => {
    const sortedKeys = [...rowMap.keys()]
      .filter((k) => k.startsWith(`${sign}|`))
      .sort((a, b) => {
        const ra = rowMap.get(a) as AccRow;
        const rb = rowMap.get(b) as AccRow;
        const ia = order.indexOf(ra.category);
        const ib = order.indexOf(rb.category);
        const idxA = ia === -1 ? order.length : ia;
        const idxB = ib === -1 ? order.length : ib;
        if (idxA !== idxB) return idxA - idxB;
        if (ra.category !== rb.category) return ra.category.localeCompare(rb.category);
        return (ra.subcategory ?? '').localeCompare(rb.subcategory ?? '');
      });

    const rows: ProformaRow[] = sortedKeys.map((k) => {
      const r = rowMap.get(k) as AccRow;
      const cells = r.cells.map(round4);
      const total = round4(cells.reduce((a, b) => a + b, 0));
      return {
        category: r.category,
        subcategory: r.subcategory,
        sign: r.sign,
        label: buildRowLabel(r.category, r.subcategory),
        cells,
        total,
      };
    });

    const subtotals = new Array(quarterCount).fill(0);
    for (const r of rows) {
      for (let q = 0; q < quarterCount; q++) {
        subtotals[q] += r.cells[q];
      }
    }
    const roundedSubtotals = subtotals.map(round4);
    const total = round4(roundedSubtotals.reduce((a, b) => a + b, 0));

    return { key, label, rows, subtotals: roundedSubtotals, total };
  };

  const outflows = buildSection(
    'outflow',
    'Uses of capital',
    'outflows',
    OUTFLOW_CATEGORY_ORDER,
  );
  const inflows = buildSection(
    'inflow',
    'Sources / revenue',
    'inflows',
    INFLOW_CATEGORY_ORDER,
  );

  // ── 4. Net + cumulative + peak-deployment ─────────────────────────────────
  const net = new Array(quarterCount).fill(0).map((_, q) =>
    round4((inflows.subtotals[q] ?? 0) + (outflows.subtotals[q] ?? 0)),
  );

  const cumulative: number[] = [];
  let running = 0;
  for (const n of net) {
    running += n;
    cumulative.push(round4(running));
  }

  let peakDeployment = 0;
  let peakDeploymentQuarter: number | null = null;
  for (let q = 0; q < cumulative.length; q++) {
    if (cumulative[q] < peakDeployment) {
      peakDeployment = cumulative[q];
      peakDeploymentQuarter = q + 1;
    }
  }

  return {
    quarters,
    inflows,
    outflows,
    net,
    cumulative,
    peakDeployment,
    peakDeploymentQuarter,
  };
}
