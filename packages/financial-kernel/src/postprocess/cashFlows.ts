/**
 * Cash-flow post-processor.
 *
 * Ports `structureCashFlows` out of `backend/src/engines/financial.engine.js`
 * (lines 536-599). Shapes a flat quarterly net cash-flow array into the
 * `{quarterly, yearly, summary}` bundle the UI/exports consume.
 *
 * Output shape (mirrors legacy exactly):
 *
 *   {
 *     quarterly: [{ quarter, label, startDate, endDate, period, net }],
 *     yearly:    [{ year,    label, startDate, endDate, period, net }],
 *     summary:   { totalInflow, totalOutflow }
 *   }
 *
 * Key conventions:
 *   - `quarter === 0` is the "Effective Date" row — startDate/endDate/period
 *     all collapse to the effective date string; it's the initial outflow
 *     point, not a real quarter.
 *   - Quarter N > 0 spans months [effective + (N-1)*3, effective + N*3 − 1 day].
 *   - `period` is `"${startDate} to ${endDate}"` (string, not a date range
 *     object). The UI renders this verbatim in tooltips and export rows.
 *   - `yearly[0]` only exists when `cfs[0] !== 0` (synthetic "Year 0" row
 *     for the construction outflow). Years 1..ceil((len−1)/4) sum quarters
 *     [y*4+1 .. y*4+4], bounded by array length.
 *   - `net` is NOT rounded in `quarterly` entries (passed through from the
 *     kernel), IS rounded to 2dp in `yearly` and `summary`.
 *   - `summary.totalOutflow` is the ABSOLUTE VALUE of the negative sum — so
 *     both totals are positive numbers for direct rendering.
 *
 * Date handling uses UTC-anchored `YYYY-MM-DD` strings to avoid timezone
 * drift across server / client / export consumers. Month arithmetic uses
 * `Date.setUTCMonth` which handles month-end edge cases (e.g. Jan 31 +
 * 1 month = Feb 28/29) the way the legacy engine does.
 *
 * Downstream consumers (from docs/LEGACY_SHAPE_AUDIT.md):
 *   - `FinancialsPage.jsx:402` — `financials.cash_flows?.quarterly || []`
 *   - `FinancialVisualizationLayer.jsx` — CashFlowWaterfall, ReturnProgressionChart
 *   - `dealExport.service.js:summarizeCashFlows` — synthesizes peakDeployment,
 *     net, firstPositiveLabel downstream from this bundle
 *   - `financial.service.js` — persists the bundle as a `cash_flows` JSON column
 */

// ── Rounding helper — byte-compatible with financial.engine.js:294 ──────────

const round2 = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;

// ── Date utilities — byte-compatible with financial.engine.js:422-445 ───────

/**
 * Normalize an arbitrary effective-date value to a UTC `YYYY-MM-DD` string.
 * Falls back to today (UTC) for missing/invalid inputs, matching legacy.
 */
export function normalizeEffectiveDate(value: unknown): string {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  const candidate = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(candidate.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return candidate.toISOString().slice(0, 10);
}

/** Add N days to a `YYYY-MM-DD` string, returning the same format. */
export function addUtcDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Add N months to a `YYYY-MM-DD` string. Uses `setUTCMonth`, which maps
 * month-end overflow to the last valid day of the target month (Jan 31
 * + 1 month → Feb 28/29), matching legacy.
 */
export function addUtcMonths(dateStr: string, months: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

// ── Shape types ─────────────────────────────────────────────────────────────

export interface QuarterlyCashFlowEntry {
  quarter: number;
  label: string;
  startDate: string;
  endDate: string;
  period: string;
  net: number;
}

export interface YearlyCashFlowEntry {
  year: number;
  label: string;
  startDate: string;
  endDate: string;
  period: string;
  net: number;
}

export interface CashFlowSummary {
  totalInflow: number;
  totalOutflow: number;
}

export interface CashFlowBundle {
  quarterly: QuarterlyCashFlowEntry[];
  yearly: YearlyCashFlowEntry[];
  summary: CashFlowSummary;
}

export interface BuildCashFlowsTimeline {
  effectiveDate?: string | Date | number | null;
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Shape a quarterly net cash-flow array into the `{quarterly, yearly, summary}`
 * bundle legacy emits. Mirrors `structureCashFlows` byte-for-byte.
 *
 * @param cfs Quarterly net cash flows. Index 0 is the effective-date
 *            outflow; index 1..N are the quarter-end nets.
 * @param timeline Optional timeline hint; only `effectiveDate` is read.
 */
export function buildCashFlows(
  cfs: ReadonlyArray<number>,
  timeline: BuildCashFlowsTimeline = {},
): CashFlowBundle {
  const effectiveDate = normalizeEffectiveDate(timeline.effectiveDate ?? null);

  const quarterly: QuarterlyCashFlowEntry[] = cfs.map((net, quarter) => {
    if (quarter === 0) {
      return {
        quarter,
        label: 'Effective Date',
        startDate: effectiveDate,
        endDate: effectiveDate,
        period: effectiveDate,
        net,
      };
    }

    const startDate = addUtcMonths(effectiveDate, (quarter - 1) * 3);
    const endDate = addUtcDays(addUtcMonths(effectiveDate, quarter * 3), -1);

    return {
      quarter,
      label: `Q${quarter}`,
      startDate,
      endDate,
      period: `${startDate} to ${endDate}`,
      net,
    };
  });

  const yearly: YearlyCashFlowEntry[] = [];

  // Synthetic Year 0 row for the effective-date outflow when non-zero.
  if (cfs.length > 0 && cfs[0] !== 0) {
    yearly.push({
      year: 0,
      label: 'Effective Date',
      startDate: effectiveDate,
      endDate: effectiveDate,
      period: effectiveDate,
      net: round2(cfs[0]) as number,
    });
  }

  // Bucket quarters 1..N into year-groups of 4. Last year may be partial.
  const yearCount = Math.ceil((cfs.length - 1) / 4);
  for (let y = 0; y < yearCount; y++) {
    const s = y * 4 + 1;
    const e = Math.min(s + 3, cfs.length - 1);
    const sliceSum = cfs.slice(s, e + 1).reduce((a, b) => a + b, 0);
    const net = round2(sliceSum) as number;

    const startDate = quarterly[s]?.startDate ?? effectiveDate;
    const endDate = quarterly[e]?.endDate ?? effectiveDate;
    const period =
      quarterly[s]?.startDate && quarterly[e]?.endDate
        ? `${quarterly[s].startDate} to ${quarterly[e].endDate}`
        : effectiveDate;

    yearly.push({
      year: y + 1,
      label: `Year ${y + 1}`,
      startDate,
      endDate,
      period,
      net,
    });
  }

  const totalInflow =
    round2(cfs.filter((c) => c > 0).reduce((a, b) => a + b, 0)) as number;
  const totalOutflow =
    round2(Math.abs(cfs.filter((c) => c < 0).reduce((a, b) => a + b, 0))) as number;

  return {
    quarterly,
    yearly,
    summary: {
      totalInflow,
      totalOutflow,
    },
  };
}
