/**
 * QuarterlyProformaPanel — quarter × category sources-and-uses waterfall.
 *
 * Renders the `proforma` summary that `buildQuarterlyProforma` emits from
 * the financial kernel. Institutional underwriters read a proforma in one
 * pass:
 *
 *   1. Uses on top (negative rows) — where capital is going, quarter by
 *      quarter.
 *   2. Sources below (positive rows) — when cash comes back.
 *   3. Per-quarter net row at the bottom.
 *   4. Cumulative equity-at-risk strip, with the peak-deployment quarter
 *      highlighted. That number is what anchors the equity cheque size
 *      conversation.
 *
 * Design choices:
 *   - Sticky first column so row labels stay visible during horizontal
 *     scroll on long holds (hospitality can be 44 quarters).
 *   - Tabular-nums on every cell — misaligned rupee figures read as
 *     sloppy underwriting.
 *   - Year subtotal rows (sum of 4 consecutive quarters) collapse visual
 *     noise on projects longer than 8 quarters. Not a separate data pass —
 *     derived in-component.
 *   - `peakDeploymentQuarter` column gets a stone-amber ring so the
 *     single most-important number on the table is findable at a glance.
 *
 * Editorial palette: stone neutrals + amber for equity risk + slate for
 * row groups. No emoji in defaults; no pie charts. The reader already
 * knows what "uses" means.
 */

import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { TrendingDown, TrendingUp, AlertTriangle, Info } from 'lucide-react';

// ── Formatting helpers ──────────────────────────────────────────────────────

const fmtCr = (n, { compact = true } = {}) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const num = Number(n);
  if (Math.abs(num) < 0.005) return '0.00';
  if (compact && Math.abs(num) >= 100) return num.toFixed(1);
  return num.toFixed(2);
};

const fmtCell = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const num = Number(n);
  if (Math.abs(num) < 0.005) return '—';
  return num.toFixed(2);
};

const fmtMonthDay = (isoDate) => {
  if (!isoDate || typeof isoDate !== 'string') return '';
  // Expect YYYY-MM-DD; render as MMM YY
  const [y, m] = isoDate.split('-');
  const year = y?.slice(2);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[Number(m) - 1] || m;
  return `${monthName} '${year}`;
};

// ── Year-level aggregation (4 quarters each) ────────────────────────────────

function aggregateYears(summary) {
  if (!summary?.quarters?.length) return [];
  const years = [];
  const qCount = summary.quarters.length;
  const yearCount = Math.ceil(qCount / 4);
  for (let y = 0; y < yearCount; y++) {
    const s = y * 4;
    const e = Math.min(s + 4, qCount);
    const idx = Array.from({ length: e - s }, (_, i) => s + i);
    years.push({
      year: y + 1,
      label: `Year ${y + 1}`,
      quarterStart: s,
      quarterEnd: e - 1,
      startDate: summary.quarters[s]?.startDate,
      endDate: summary.quarters[e - 1]?.endDate,
      indices: idx,
    });
  }
  return years;
}

const sumAt = (cells, indices) =>
  indices.reduce((acc, i) => acc + (Number(cells?.[i]) || 0), 0);

// ── Main component ─────────────────────────────────────────────────────────

export default function QuarterlyProformaPanel({ proforma }) {
  const [view, setView] = useState('quarterly'); // 'quarterly' | 'yearly'

  if (!proforma || !proforma.quarters?.length) return null;

  const years = useMemo(() => aggregateYears(proforma), [proforma]);
  const isYearly = view === 'yearly';

  const headers = isYearly
    ? years.map((y) => ({
        key: `y${y.year}`,
        label: y.label,
        sub: y.startDate && y.endDate
          ? `${fmtMonthDay(y.startDate)} – ${fmtMonthDay(y.endDate)}`
          : '',
      }))
    : proforma.quarters.map((q) => ({
        key: `q${q.quarter}`,
        label: q.label,
        sub: q.startDate ? fmtMonthDay(q.startDate) : '',
      }));

  const computeRowCells = (row) => {
    if (!isYearly) return row.cells;
    return years.map((y) => sumAt(row.cells, y.indices));
  };

  const subtotalsFor = (series) => {
    if (!isYearly) return series;
    return years.map((y) => sumAt(series, y.indices));
  };

  const netSeries = subtotalsFor(proforma.net);
  const cumulativeSeries = isYearly
    ? years.map((y) =>
        Number(proforma.cumulative?.[Math.min(y.quarterEnd, proforma.cumulative.length - 1)]) || 0,
      )
    : proforma.cumulative;

  const outflowSubtotals = subtotalsFor(proforma.outflows.subtotals);
  const inflowSubtotals = subtotalsFor(proforma.inflows.subtotals);

  const peakQ = proforma.peakDeploymentQuarter;
  const peakIndex = isYearly
    ? years.findIndex((y) => peakQ != null && peakQ - 1 >= y.quarterStart && peakQ - 1 <= y.quarterEnd)
    : peakQ != null
      ? peakQ - 1
      : -1;

  const colSpanTotal = headers.length;
  const peakColLabel = peakQ != null ? (isYearly ? `Year ${Math.floor((peakQ - 1) / 4) + 1}` : `Q${peakQ}`) : '—';
  const totalInflow = Number(proforma.inflows?.total) || 0;
  const totalOutflow = Number(proforma.outflows?.total) || 0;
  const netOverLife = totalInflow + totalOutflow;

  return (
    <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
      {/* ── Header strip ───────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-stone-200 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
            Quarterly proforma
          </div>
          <div className="font-serif text-base font-semibold text-stone-900 leading-tight">
            Sources &amp; uses · quarter by quarter
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => setView('quarterly')}
            className={clsx(
              'px-3 py-1 uppercase tracking-[0.14em] border transition-colors',
              view === 'quarterly'
                ? 'border-stone-900 text-stone-900 bg-stone-100'
                : 'border-stone-200 text-stone-500 hover:text-stone-900',
            )}
          >
            Quarterly
          </button>
          <button
            type="button"
            onClick={() => setView('yearly')}
            className={clsx(
              'px-3 py-1 uppercase tracking-[0.14em] border transition-colors',
              view === 'yearly'
                ? 'border-stone-900 text-stone-900 bg-stone-100'
                : 'border-stone-200 text-stone-500 hover:text-stone-900',
            )}
          >
            Yearly
          </button>
        </div>
      </div>

      {/* ── Summary strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-stone-100 border-b border-stone-200">
        <SummaryCell
          icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-700" />}
          label="Sources"
          value={`₹${fmtCr(totalInflow)} Cr`}
          sub={`${proforma.inflows.rows.length} row${proforma.inflows.rows.length === 1 ? '' : 's'}`}
        />
        <SummaryCell
          icon={<TrendingDown className="w-3.5 h-3.5 text-rose-700" />}
          label="Uses"
          value={`₹${fmtCr(Math.abs(totalOutflow))} Cr`}
          sub={`${proforma.outflows.rows.length} row${proforma.outflows.rows.length === 1 ? '' : 's'}`}
        />
        <SummaryCell
          label="Net over life"
          value={`${netOverLife >= 0 ? '+' : ''}₹${fmtCr(netOverLife)} Cr`}
          sub="Sources − Uses"
          valueClass={netOverLife >= 0 ? 'text-emerald-800' : 'text-rose-800'}
        />
        <SummaryCell
          icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-700" />}
          label="Peak equity"
          value={`₹${fmtCr(Math.abs(proforma.peakDeployment || 0))} Cr`}
          sub={`at ${peakColLabel}`}
          valueClass="text-amber-900"
        />
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="bg-stone-50 text-stone-500">
              <th className="sticky left-0 z-10 bg-stone-50 text-left px-4 py-2 border-b border-r border-stone-200 uppercase tracking-[0.12em] text-[10px] font-semibold min-w-[220px]">
                Line item
              </th>
              {headers.map((h, i) => (
                <th
                  key={h.key}
                  className={clsx(
                    'px-3 py-2 border-b border-stone-200 text-right uppercase tracking-[0.1em] text-[10px] font-semibold whitespace-nowrap',
                    i === peakIndex && 'ring-1 ring-amber-400 bg-amber-50/60',
                  )}
                >
                  <div className="text-stone-900 text-[11px] font-semibold">{h.label}</div>
                  {h.sub && <div className="text-stone-400 text-[9px] font-normal">{h.sub}</div>}
                </th>
              ))}
              <th className="px-3 py-2 border-b border-l border-stone-200 text-right uppercase tracking-[0.1em] text-[10px] font-semibold text-stone-700 bg-stone-100 min-w-[90px]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {/* ── Uses ─────────────────────────────────────────────── */}
            <SectionHeader
              label="Uses of capital (outflows)"
              colSpan={colSpanTotal + 2}
              tone="rose"
            />
            {proforma.outflows.rows.map((row) => (
              <DataRow
                key={`${row.category}|${row.subcategory ?? ''}`}
                label={row.label}
                subLabel={row.subcategory || row.category}
                cells={computeRowCells(row)}
                total={row.cells.reduce((a, b) => a + b, 0)}
                peakIndex={peakIndex}
                tone="rose"
                signed
              />
            ))}
            <SubtotalRow
              label="Total uses"
              cells={outflowSubtotals}
              total={totalOutflow}
              peakIndex={peakIndex}
              tone="rose"
              signed
            />

            {/* ── Sources ──────────────────────────────────────────── */}
            <SectionHeader
              label="Sources / revenue (inflows)"
              colSpan={colSpanTotal + 2}
              tone="emerald"
            />
            {proforma.inflows.rows.map((row) => (
              <DataRow
                key={`${row.category}|${row.subcategory ?? ''}`}
                label={row.label}
                subLabel={row.subcategory || row.category}
                cells={computeRowCells(row)}
                total={row.cells.reduce((a, b) => a + b, 0)}
                peakIndex={peakIndex}
                tone="emerald"
                signed
              />
            ))}
            <SubtotalRow
              label="Total sources"
              cells={inflowSubtotals}
              total={totalInflow}
              peakIndex={peakIndex}
              tone="emerald"
              signed
            />

            {/* ── Net + cumulative ─────────────────────────────────── */}
            <tr className="border-t-2 border-stone-900/70">
              <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-stone-200 font-semibold text-stone-900 uppercase tracking-[0.1em] text-[10px]">
                Net cash flow
              </td>
              {netSeries.map((n, i) => (
                <td
                  key={i}
                  className={clsx(
                    'px-3 py-2 text-right font-semibold',
                    i === peakIndex && 'bg-amber-50/60 ring-1 ring-amber-400',
                    n >= 0 ? 'text-emerald-800' : 'text-rose-800',
                  )}
                >
                  {n >= 0 ? '' : '('}{fmtCell(Math.abs(n))}{n >= 0 ? '' : ')'}
                </td>
              ))}
              <td
                className={clsx(
                  'px-3 py-2 text-right font-bold border-l border-stone-200 bg-stone-50',
                  netOverLife >= 0 ? 'text-emerald-900' : 'text-rose-900',
                )}
              >
                {netOverLife >= 0 ? '' : '('}{fmtCell(Math.abs(netOverLife))}{netOverLife >= 0 ? '' : ')'}
              </td>
            </tr>
            <tr>
              <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-stone-200 text-stone-600 uppercase tracking-[0.1em] text-[10px]">
                Cumulative (equity-at-risk)
              </td>
              {cumulativeSeries.map((n, i) => {
                const val = Number(n) || 0;
                return (
                  <td
                    key={i}
                    className={clsx(
                      'px-3 py-2 text-right',
                      i === peakIndex && 'bg-amber-100 ring-1 ring-amber-500 font-semibold text-amber-950',
                      val < 0 ? 'text-amber-900' : 'text-stone-700',
                    )}
                  >
                    {val >= 0 ? '' : '('}{fmtCell(Math.abs(val))}{val >= 0 ? '' : ')'}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right border-l border-stone-200 text-stone-400">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Footer note ───────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-t border-stone-200 bg-stone-50/60 flex items-start gap-2 text-[11px] text-stone-600">
        <Info className="w-3.5 h-3.5 text-stone-400 mt-0.5 flex-shrink-0" />
        <div>
          Values in ₹ Crore. Parentheses indicate outflows or negative balances.
          Cells reconcile to <span className="font-semibold">costs</span> and{' '}
          <span className="font-semibold">revenue</span> totals on this page
          within rounding. Peak equity-at-risk is the most-negative cumulative
          balance — the equity cheque needed to carry the deal through construction.
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SummaryCell({ icon, label, value, sub, valueClass }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-stone-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className={clsx('font-serif text-base font-semibold mt-1 tabular-nums', valueClass || 'text-stone-900')}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function SectionHeader({ label, colSpan, tone }) {
  const toneClass =
    tone === 'rose' ? 'text-rose-900 bg-rose-50/50 border-rose-100'
    : tone === 'emerald' ? 'text-emerald-900 bg-emerald-50/50 border-emerald-100'
    : 'text-stone-900 bg-stone-50';
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={clsx(
          'px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold border-t border-b',
          toneClass,
        )}
      >
        {label}
      </td>
    </tr>
  );
}

function DataRow({ label, subLabel, cells, total, peakIndex, tone, signed }) {
  const toneClass = tone === 'rose'
    ? 'text-rose-800'
    : tone === 'emerald'
      ? 'text-emerald-800'
      : 'text-stone-800';

  return (
    <tr className="border-b border-stone-100 hover:bg-stone-50/60">
      <td className="sticky left-0 z-10 bg-white px-4 py-1.5 border-r border-stone-200">
        <div className="text-stone-900 font-medium">{label}</div>
        {subLabel && subLabel !== label && (
          <div className="text-[10px] text-stone-400 uppercase tracking-[0.1em]">{subLabel}</div>
        )}
      </td>
      {cells.map((c, i) => {
        const val = Number(c) || 0;
        const show = Math.abs(val) > 0.005;
        return (
          <td
            key={i}
            className={clsx(
              'px-3 py-1.5 text-right',
              i === peakIndex && 'bg-amber-50/60',
              show ? toneClass : 'text-stone-300',
            )}
          >
            {show
              ? signed && val < 0
                ? `(${fmtCell(Math.abs(val))})`
                : fmtCell(val)
              : '—'}
          </td>
        );
      })}
      <td className={clsx('px-3 py-1.5 text-right font-semibold border-l border-stone-200 bg-stone-50/60', toneClass)}>
        {signed && total < 0 ? `(${fmtCell(Math.abs(total))})` : fmtCell(total)}
      </td>
    </tr>
  );
}

function SubtotalRow({ label, cells, total, peakIndex, tone, signed }) {
  const textClass = tone === 'rose'
    ? 'text-rose-900'
    : tone === 'emerald'
      ? 'text-emerald-900'
      : 'text-stone-900';

  // Solid backgrounds — the sticky label cell must fully occlude scrolling
  // numeric cells behind it. Using /40 alpha lets numbers bleed through.
  const solidBg = tone === 'rose'
    ? 'bg-rose-50'
    : tone === 'emerald'
      ? 'bg-emerald-50'
      : 'bg-stone-50';

  return (
    <tr className={clsx('border-b border-stone-200 font-semibold', textClass, solidBg)}>
      <td className={clsx('sticky left-0 z-20 px-4 py-1.5 border-r border-stone-200 uppercase tracking-[0.1em] text-[10px]', solidBg)}>
        {label}
      </td>
      {cells.map((c, i) => {
        const val = Number(c) || 0;
        return (
          <td
            key={i}
            className={clsx(
              'px-3 py-1.5 text-right',
              i === peakIndex && 'ring-1 ring-amber-300',
            )}
          >
            {signed && val < 0 ? `(${fmtCell(Math.abs(val))})` : fmtCell(val)}
          </td>
        );
      })}
      <td className={clsx('px-3 py-1.5 text-right border-l border-stone-200', solidBg)}>
        {signed && total < 0 ? `(${fmtCell(Math.abs(total))})` : fmtCell(total)}
      </td>
    </tr>
  );
}
