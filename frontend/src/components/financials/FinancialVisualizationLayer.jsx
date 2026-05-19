import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, ReferenceLine, ReferenceDot,
} from 'recharts';
import {
  TrendingUp, DollarSign, Layers, Target, Activity,
  GitBranch, Gauge, LineChart as LineIcon, BarChart3,
} from 'lucide-react';
import { formatCrores, formatPct, formatINR } from '../../utils/format';

// ─── DESIGN TOKENS (Precision Analysis) ───────────────────────────────────
// Mirrors --chart-* CSS vars + data-signal palette. Kept as hex so Recharts
// SVG fills stay predictable; if the theme toggle shifts hues significantly
// the charts still read correctly because we chose hues that hold up in
// both modes.

const PHASE_COLORS = {
  construction:  '#EF4444',   // data-negative  (cost phase)
  operating:     '#22C55E',   // data-positive  (income phase)
  debt:          '#F5B800',   // premium amber  (capital structure)
  terminal:      '#A78BFA',   // chart-5 violet (exit event)
  noi:           '#60A5FA',   // chart-1 blue   (NOI)
  equity:        '#3B82F6',   // brand accent   (equity CFs)
  value:         '#14B8A6',   // data-highlight (valuation)
  sensitivityHi: '#22C55E',
  sensitivityMid:'#F5B800',
  sensitivityLo: '#EF4444',
};

const METHOD_LABELS = {
  exit_cap_rate:     'Exit Cap Rate',
  exit_multiple:     'Exit Multiple',
  perpetuity_growth: 'Perpetuity Growth',
  forward_purchase:  'Forward Purchase',
};

// ─── HELPERS ───────────────────────────────────────────────────────────────

const safeNumber = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// Recharts tick props — `fontVariantNumeric: 'tabular-nums'` keeps axis
// labels column-aligned per FRONTEND_GUIDELINES §7. Hoisted to module scope
// so identity is stable and Recharts doesn't redraw on every render.
// PR-NX71 (2026-05-19): `fill` pinned to var(--color-text-muted) so axis
// labels flip correctly across light/dark themes (was inheriting recharts
// default which was invisible in dark theme).
const AXIS_TICK = { fontSize: 11, fontVariantNumeric: 'tabular-nums', fill: 'var(--color-text-muted)' };
const AXIS_TICK_SMALL = { fontSize: 10, fontVariantNumeric: 'tabular-nums', fill: 'var(--color-text-muted)' };

// PR-NX71 (2026-05-19): shared chart-chrome constants. Replaces 6 hardcoded
// hex literals (#e5e7eb grid, #64748b reference line) scattered across the
// 5 chart components in this file. CSS vars flip correctly across themes
// and match the dashboard + Cash Flows chart conventions (PR-NX65).
const GRID_STROKE = 'var(--color-border-primary)';
const REFERENCE_LINE_STROKE = 'var(--color-border-strong)';
const NEUTRAL_BAR_FILL = 'var(--color-text-disabled)'; // used for inactive bar variants
const ACCENT_HIGHLIGHT_STROKE = 'var(--color-brand-accent)';

const tooltipStyle = {
  backgroundColor: 'var(--color-bg-elevated)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-primary)',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '12px',
  boxShadow: 'var(--shadow-elevated)',
};

function Tip({ active, payload, label, valueFormatter = (v) => `₹${Number(v).toFixed(2)} Cr` }) {
  if (!active || !payload?.length) return null;
  return (
    // tooltipStyle stays inline — Recharts renders its own tooltip wrapper that
    // doesn't accept className, and several of these properties (boxShadow,
    // padding, fontSize) need to be applied at this exact node.
    <div style={tooltipStyle}>
      <div className="mb-1 text-[11px] uppercase tracking-[0.06em] text-content-muted">
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-xs">
          {/* Per-series color comes from the chart palette — must stay inline. */}
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: p.color }}
          />
          <span className="text-content-secondary">{p.name}:</span>
          <span className="font-semibold tabular-nums text-content-primary">
            {valueFormatter(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── TERMINAL VALUE PANEL ─────────────────────────────────────────────────

export function TerminalValuePanel({ kpis, revenue, inputs }) {
  const method = kpis?.terminalValueMethod || revenue?.terminalValueMethod;
  if (!method) return null;
  const tv = safeNumber(kpis?.terminalValue ?? revenue?.terminalValue, 0);
  const tvPv = safeNumber(kpis?.terminalValuePV ?? revenue?.terminalValuePV, 0);
  const noiStab = safeNumber(kpis?.noi ?? revenue?.stabilizedNOI, 0);
  const noiExit = safeNumber(kpis?.noiAtExit ?? revenue?.noiAtExit, 0);
  const discountPct = safeNumber(inputs?.discountRatePct, 0);
  const capPct = safeNumber(kpis?.exitCapRate ?? inputs?.exitCapRate, 0);
  const hold = safeNumber(inputs?.holdPeriodYears, 0);
  const exitMultipleInput = safeNumber(inputs?.exitMultiple, 0);
  const gPct = safeNumber(inputs?.perpetuityGrowthPct, 0);
  const fwdCr = safeNumber(inputs?.forwardPurchasePriceCr, 0);
  const capBenchmark = safeNumber(kpis?.capRateValuationCr ?? revenue?.capRateValuationCr, 0);

  // Compute all four methods client-side for comparison
  const comparison = useMemo(() => {
    const rows = [];
    if (capPct > 0 && noiExit > 0) {
      rows.push({
        method: 'exit_cap_rate',
        label: METHOD_LABELS.exit_cap_rate,
        value: noiExit / (capPct / 100),
        active: method === 'exit_cap_rate',
      });
    }
    if (exitMultipleInput > 0 && noiStab > 0) {
      rows.push({
        method: 'exit_multiple',
        label: METHOD_LABELS.exit_multiple,
        value: noiStab * exitMultipleInput,
        active: method === 'exit_multiple',
      });
    }
    if (discountPct > gPct && noiExit > 0) {
      const spread = (discountPct - gPct) / 100;
      if (spread > 0) {
        rows.push({
          method: 'perpetuity_growth',
          label: METHOD_LABELS.perpetuity_growth,
          value: (noiExit * (1 + gPct / 100)) / spread,
          active: method === 'perpetuity_growth',
        });
      }
    }
    if (fwdCr > 0) {
      rows.push({
        method: 'forward_purchase',
        label: METHOD_LABELS.forward_purchase,
        value: fwdCr,
        active: method === 'forward_purchase',
      });
    }
    return rows.sort((a, b) => b.value - a.value);
  }, [capPct, noiExit, noiStab, discountPct, gPct, exitMultipleInput, fwdCr, method]);

  const formulaMap = {
    exit_cap_rate:     `NOI_exit ÷ Exit Cap = ₹${noiExit.toFixed(2)}Cr ÷ ${capPct.toFixed(2)}%`,
    exit_multiple:     `NOI_stabilized × Multiple = ₹${noiStab.toFixed(2)}Cr × ${exitMultipleInput.toFixed(1)}×`,
    perpetuity_growth: `NOI_exit × (1+g) ÷ (r−g) = ₹${noiExit.toFixed(2)}Cr × ${(1 + gPct / 100).toFixed(3)} ÷ ${(discountPct - gPct).toFixed(2)}%`,
    forward_purchase:  `Contractual price = ₹${fwdCr.toFixed(2)} Cr`,
  };

  return (
    <div className="bg-gradient-to-br from-violet-50 via-white to-violet-50 rounded-xl shadow-sm border border-violet-200 overflow-hidden">
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3 flex items-center gap-2">
        <Target className="w-4 h-4 text-white" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">Terminal Value</h3>
        <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider bg-white/20 text-white px-2 py-0.5 rounded-full">
          {METHOD_LABELS[method] || method}
        </span>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-violet-100 p-4">
          <div className="text-[11px] font-semibold uppercase text-violet-700 tracking-wide">Terminal Value</div>
          <div className="mt-1 text-2xl font-bold text-content-primary">{formatCrores(tv)}</div>
          <div className="mt-1 text-[11px] text-content-secondary">At end of hold (Y{Math.round(hold)})</div>
        </div>

        <div className="bg-white rounded-lg border border-violet-100 p-4">
          <div className="text-[11px] font-semibold uppercase text-violet-700 tracking-wide">PV of Terminal Value</div>
          <div className="mt-1 text-2xl font-bold text-content-primary">{formatCrores(tvPv)}</div>
          <div className="mt-1 text-[11px] text-content-secondary">Discounted at {discountPct.toFixed(1)}% to t=0</div>
        </div>

        <div className="bg-white rounded-lg border border-violet-100 p-4">
          <div className="text-[11px] font-semibold uppercase text-violet-700 tracking-wide">% of NPV from TV</div>
          <div className="mt-1 text-2xl font-bold text-content-primary">
            {kpis?.npv && tvPv ? `${((tvPv / (Number(kpis.npv) + tvPv)) * 100).toFixed(1)}%` : '-'}
          </div>
          <div className="mt-1 text-[11px] text-content-secondary">Dependency on exit assumption</div>
        </div>
      </div>

      <div className="px-5 pb-3">
        <div className="rounded-lg bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-100 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-violet-800 mb-1">Formula in use</div>
          <div className="font-mono text-[13px] text-content-primary">{formulaMap[method] || '—'}</div>
        </div>
      </div>

      {comparison.length > 1 && (
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">Method Comparison</div>
            {capBenchmark > 0 && (
              <div className="text-[11px] text-content-secondary">
                Cap-rate benchmark: <span className="font-semibold text-content-primary">{formatCrores(capBenchmark)}</span>
              </div>
            )}
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparison} layout="vertical" margin={{ left: 20, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `${Number(v).toFixed(0)}`} tick={AXIS_TICK} />
                <YAxis dataKey="label" type="category" tick={AXIS_TICK} width={140} />
                <Tooltip content={<Tip />} />
                <Bar dataKey="value" name="Terminal Value (₹ Cr)" radius={[0, 4, 4, 0]}>
                  {comparison.map((entry) => (
                    <Cell
                      key={entry.method}
                      fill={entry.active ? PHASE_COLORS.terminal : NEUTRAL_BAR_FILL}
                      stroke={entry.active ? ACCENT_HIGHLIGHT_STROKE : undefined}
                      strokeWidth={entry.active ? 2 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NOI PROGRESSION CHART ─────────────────────────────────────────────────

export function NOIProgressionChart({ kpis, inputs, revenue }) {
  const stabilizedNOI = safeNumber(kpis?.noi ?? revenue?.stabilizedNOI, 0);
  const hold = Math.max(1, Math.round(safeNumber(inputs?.holdPeriodYears, 5)));
  const escPct = safeNumber(inputs?.rentEscalationPct ?? inputs?.adrGrowthPct, 5);
  const exitCapPct = safeNumber(kpis?.exitCapRate ?? inputs?.exitCapRate, 8);

  if (stabilizedNOI <= 0) return null;

  const data = Array.from({ length: hold + 1 }, (_, i) => {
    const noi = stabilizedNOI * Math.pow(1 + escPct / 100, i);
    const implied = exitCapPct > 0 ? noi / (exitCapPct / 100) : 0;
    return {
      year: `Y${i}`,
      noi: Number(noi.toFixed(2)),
      impliedValue: Number(implied.toFixed(2)),
    };
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-sky-500 px-5 py-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-white" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">NOI Progression</h3>
        <span className="ml-auto text-[10px] font-semibold text-white/90">
          {escPct.toFixed(1)}% pa growth
        </span>
      </div>
      <div className="p-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <defs>
              <linearGradient id="noiGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PHASE_COLORS.noi} stopOpacity={0.4} />
                <stop offset="100%" stopColor={PHASE_COLORS.noi} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="year" tick={AXIS_TICK} />
            <YAxis
              yAxisId="left"
              tick={AXIS_TICK}
              tickFormatter={(v) => `₹${Number(v).toFixed(0)}`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={AXIS_TICK}
              tickFormatter={(v) => `₹${Number(v).toFixed(0)}`}
            />
            <Tooltip content={<Tip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="noi"
              name="NOI (₹ Cr)"
              stroke={PHASE_COLORS.noi}
              strokeWidth={2.5}
              fill="url(#noiGradient)"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="impliedValue"
              name="Implied Value @ exit cap (₹ Cr)"
              stroke={PHASE_COLORS.value}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── VALUE vs CAP RATE CURVE ───────────────────────────────────────────────

export function ValueVsCapRateCurve({ kpis, inputs, revenue }) {
  const noiAtExit = safeNumber(kpis?.noiAtExit ?? revenue?.noiAtExit, 0);
  const currentCap = safeNumber(kpis?.exitCapRate ?? inputs?.exitCapRate, 0);
  if (noiAtExit <= 0 || currentCap <= 0) return null;

  const points = [];
  for (let bps = -200; bps <= 200; bps += 25) {
    const cap = currentCap + bps / 100;
    if (cap > 0) {
      points.push({
        cap: Number(cap.toFixed(2)),
        bps,
        value: Number((noiAtExit / (cap / 100)).toFixed(2)),
      });
    }
  }

  const currentValue = noiAtExit / (currentCap / 100);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-3 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-white" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">Terminal Value Sensitivity</h3>
        <span className="ml-auto text-[10px] font-semibold text-white/90">
          Current: {currentCap.toFixed(2)}%  →  {formatCrores(currentValue)}
        </span>
      </div>
      <div className="p-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 10, right: 20 }}>
            <defs>
              <linearGradient id="valueGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={PHASE_COLORS.sensitivityHi} />
                <stop offset="50%" stopColor={PHASE_COLORS.sensitivityMid} />
                <stop offset="100%" stopColor={PHASE_COLORS.sensitivityLo} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis
              dataKey="cap"
              tick={AXIS_TICK}
              label={{ value: 'Exit Cap Rate (%)', position: 'insideBottom', offset: -2, fontSize: 11 }}
            />
            <YAxis
              tick={AXIS_TICK}
              tickFormatter={(v) => `₹${Number(v).toFixed(0)}`}
            />
            <Tooltip content={<Tip />} />
            <Line
              type="monotone"
              dataKey="value"
              name="Terminal Value (₹ Cr)"
              stroke="url(#valueGrad)"
              strokeWidth={3}
              dot={false}
            />
            <ReferenceLine
              x={Number(currentCap.toFixed(2))}
              stroke="var(--color-text-primary)"
              strokeDasharray="4 4"
              label={{ value: 'Current', fontSize: 10, position: 'top', fill: 'var(--color-text-primary)' }}
            />
            <ReferenceDot
              x={Number(currentCap.toFixed(2))}
              y={Number(currentValue.toFixed(2))}
              r={6}
              fill={PHASE_COLORS.terminal}
              stroke="#fff"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── CASH FLOW WATERFALL ───────────────────────────────────────────────────

export function CashFlowWaterfall({ cashFlows, kpis, revenue, inputs }) {
  if (!Array.isArray(cashFlows) || cashFlows.length === 0) return null;
  const terminalValue = safeNumber(kpis?.terminalValue ?? revenue?.terminalValue, 0);
  const hold = Math.max(1, Math.round(safeNumber(inputs?.holdPeriodYears, 5)));
  const constructionQuarters = Math.max(1, cashFlows.length - hold * 4);

  // Annotate each quarter with a phase tag
  const data = cashFlows.map((cf, i) => {
    const phase =
      i < constructionQuarters ? 'construction' :
      i === cashFlows.length - 1 ? 'terminal' :
      'operating';
    const value = safeNumber(cf.value, 0);
    // Extract terminal component from last quarter if present
    const operatingPart =
      phase === 'terminal' && terminalValue > 0 ? value - terminalValue : value;
    return {
      quarter: `Q${i}`,
      value,
      construction: phase === 'construction' ? value : 0,
      operating:    phase === 'operating' ? value : (phase === 'terminal' ? operatingPart : 0),
      terminal:     phase === 'terminal' ? Math.min(terminalValue, value) : 0,
    };
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong overflow-hidden">
      <div className="bg-gradient-to-r from-slate-800 to-gray-900 px-5 py-3 flex items-center gap-2">
        <Layers className="w-4 h-4 text-white" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">Cash Flow Composition</h3>
        <div className="ml-auto flex items-center gap-3 text-[10px] font-semibold text-white/90">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: PHASE_COLORS.construction }} />Construction
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: PHASE_COLORS.operating }} />Operating
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: PHASE_COLORS.terminal }} />Terminal
          </span>
        </div>
      </div>
      <div className="p-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} stackOffset="sign">
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="quarter" tick={AXIS_TICK_SMALL} />
            <YAxis tick={AXIS_TICK} tickFormatter={(v) => `₹${Number(v).toFixed(0)}`} />
            <Tooltip content={<Tip />} />
            <ReferenceLine y={0} stroke={REFERENCE_LINE_STROKE} strokeWidth={1} />
            <Bar dataKey="construction" name="Construction" stackId="a" fill={PHASE_COLORS.construction} />
            <Bar dataKey="operating"    name="Operating"    stackId="a" fill={PHASE_COLORS.operating} />
            <Bar dataKey="terminal"     name="Terminal"     stackId="a" fill={PHASE_COLORS.terminal} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── IRR / RETURN PROGRESSION ──────────────────────────────────────────────

export function ReturnProgressionChart({ cashFlows, kpis }) {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2) return null;
  let running = 0;
  const data = cashFlows.map((cf, i) => {
    running += safeNumber(cf.value, 0);
    return {
      quarter: `Q${i}`,
      cumulative: Number(running.toFixed(2)),
    };
  });
  const breakEvenIdx = data.findIndex((d) => d.cumulative >= 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong overflow-hidden">
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-white" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">Cumulative Return Trajectory</h3>
        <span className="ml-auto text-[10px] font-semibold text-white/90">
          IRR: {kpis?.irr != null ? formatPct(kpis.irr) : '-'}
        </span>
      </div>
      <div className="p-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <defs>
              <linearGradient id="returnPos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PHASE_COLORS.operating} stopOpacity={0.35} />
                <stop offset="100%" stopColor={PHASE_COLORS.operating} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="returnNeg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PHASE_COLORS.construction} stopOpacity={0} />
                <stop offset="100%" stopColor={PHASE_COLORS.construction} stopOpacity={0.35} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="quarter" tick={AXIS_TICK_SMALL} />
            <YAxis tick={AXIS_TICK} tickFormatter={(v) => `₹${Number(v).toFixed(0)}`} />
            <Tooltip content={<Tip />} />
            <ReferenceLine y={0} stroke={REFERENCE_LINE_STROKE} strokeWidth={1} />
            {breakEvenIdx > 0 && (
              <ReferenceLine
                x={`Q${breakEvenIdx}`}
                stroke="var(--color-data-positive)"
                strokeDasharray="4 4"
                label={{ value: 'Break-even', fontSize: 10, fill: 'var(--color-data-positive)', position: 'top' }}
              />
            )}
            <Area
              type="monotone"
              dataKey="cumulative"
              name="Cumulative Cash (₹ Cr)"
              stroke={PHASE_COLORS.value}
              strokeWidth={2.5}
              fill="url(#returnPos)"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── KPI SUMMARY DASHBOARD ─────────────────────────────────────────────────

export function KPIDashboard({ kpis, assetClass, revenue, costs }) {
  const entries = useMemo(() => {
    const rows = [];
    if (kpis?.irr != null) rows.push({ label: 'IRR', value: formatPct(kpis.irr), tone: 'good', icon: TrendingUp });
    if (kpis?.npv != null) rows.push({ label: 'NPV', value: formatCrores(kpis.npv), tone: kpis.npv >= 0 ? 'good' : 'bad', icon: DollarSign });
    if (kpis?.equityMultiple != null) rows.push({ label: 'Equity Multiple', value: `${Number(kpis.equityMultiple).toFixed(2)}×`, tone: 'neutral', icon: Layers });
    if (kpis?.yieldOnCost != null) rows.push({ label: 'Yield on Cost', value: `${Number(kpis.yieldOnCost).toFixed(2)}%`, tone: 'good', icon: Gauge });
    if (kpis?.dscr != null) rows.push({ label: 'DSCR', value: `${Number(kpis.dscr).toFixed(2)}×`, tone: kpis.dscr >= 1.25 ? 'good' : 'warn', icon: Activity });
    if (kpis?.noi != null) rows.push({ label: 'Stabilized NOI', value: formatCrores(kpis.noi), tone: 'neutral', icon: LineIcon });
    if (kpis?.terminalValue != null) rows.push({ label: 'Terminal Value', value: formatCrores(kpis.terminalValue), tone: 'neutral', icon: Target });
    if (kpis?.rlv != null) rows.push({ label: 'Residual Land Value', value: formatCrores(kpis.rlv), tone: 'neutral', icon: GitBranch });
    return rows;
  }, [kpis]);

  if (entries.length === 0) return null;

  const toneClass = {
    good:    'from-emerald-50 to-teal-50 border-emerald-200 text-emerald-900',
    bad:     'from-rose-50 to-red-50 border-rose-200 text-rose-900',
    warn:    'from-amber-50 to-orange-50 border-amber-200 text-amber-900',
    neutral: 'from-slate-50 to-gray-50 border-hairline-strong text-content-primary',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-white" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">Investor KPI Dashboard</h3>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {entries.map(({ label, value, tone, icon: Icon }) => (
          <div
            key={label}
            className={`bg-gradient-to-br rounded-lg border p-3 ${toneClass[tone]}`}
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider opacity-80">
              <Icon className="w-3 h-3" />
              {label}
            </div>
            <div className="mt-1 text-xl font-bold">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── COST COMPOSITION DONUT (bar style) ────────────────────────────────────

export function CostCompositionChart({ costs }) {
  if (!costs) return null;
  const items = [
    { name: 'Land',           value: safeNumber(costs.land),           color: '#1e40af' },
    { name: 'Stamp Duty',     value: safeNumber(costs.stampDuty),      color: '#1d4ed8' },
    { name: 'Construction',   value: safeNumber(costs.construction),   color: '#3b82f6' },
    { name: 'GST',            value: safeNumber(costs.gst),            color: '#60a5fa' },
    { name: 'Contingency',    value: safeNumber(costs.contingency),    color: '#93c5fd' },
    { name: 'Approvals',      value: safeNumber(costs.approval),       color: '#fbbf24' },
    { name: 'Architect',      value: safeNumber(costs.architecture),   color: '#f59e0b' },
    { name: 'PMC',            value: safeNumber(costs.pmc),            color: '#d97706' },
    { name: 'Marketing',      value: safeNumber(costs.marketing),      color: '#ef4444' },
    { name: 'Finance',        value: safeNumber(costs.finance),        color: '#b91c1c' },
    { name: 'TI',             value: safeNumber(costs.tenantImprovements), color: '#a855f7' },
    { name: 'Leasing Comm.',  value: safeNumber(costs.leasingCommissions), color: '#9333ea' },
    { name: 'Pre-Opening',    value: safeNumber(costs.preOpening),     color: '#db2777' },
  ].filter((x) => x.value > 0);
  if (items.length === 0) return null;
  const total = items.reduce((s, x) => s + x.value, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong overflow-hidden">
      <div className="bg-gradient-to-r from-blue-900 to-blue-700 px-5 py-3 flex items-center gap-2">
        <Layers className="w-4 h-4 text-white" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">Cost Composition</h3>
        <span className="ml-auto text-[10px] font-semibold text-white/90">Total: {formatCrores(total)}</span>
      </div>
      <div className="p-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} layout="vertical" margin={{ left: 30, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
            <XAxis
              type="number"
              tick={AXIS_TICK_SMALL}
              tickFormatter={(v) => `₹${Number(v).toFixed(0)}`}
            />
            <YAxis dataKey="name" type="category" tick={AXIS_TICK} width={110} />
            <Tooltip content={<Tip />} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {items.map((e) => (
                <Cell key={e.name} fill={e.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── WRAPPER LAYER ─────────────────────────────────────────────────────────

export default function FinancialVisualizationLayer({ financials, inputs }) {
  const [tab, setTab] = useState('overview');
  if (!financials) return null;
  const { kpis, revenue, costs, cashFlows, assetClass } = financials;
  const isIncomeLike = assetClass && /commercial_office|retail|industrial|hospitality/.test(assetClass);

  const tabs = [
    { id: 'overview',   label: 'Overview' },
    ...(isIncomeLike ? [{ id: 'terminal',   label: 'Terminal Value' }] : []),
    { id: 'cashflow',   label: 'Cash Flow' },
    ...(isIncomeLike ? [{ id: 'progression', label: 'NOI Progression' }] : []),
    { id: 'costs',      label: 'Cost Stack' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              tab === t.id
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <KPIDashboard kpis={kpis} assetClass={assetClass} revenue={revenue} costs={costs} />
          {isIncomeLike && <TerminalValuePanel kpis={kpis} revenue={revenue} inputs={inputs} />}
        </>
      )}

      {tab === 'terminal' && isIncomeLike && (
        <>
          <TerminalValuePanel kpis={kpis} revenue={revenue} inputs={inputs} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ValueVsCapRateCurve kpis={kpis} inputs={inputs} revenue={revenue} />
            <NOIProgressionChart kpis={kpis} inputs={inputs} revenue={revenue} />
          </div>
        </>
      )}

      {tab === 'cashflow' && (
        <>
          <CashFlowWaterfall cashFlows={cashFlows} kpis={kpis} revenue={revenue} inputs={inputs} />
          <ReturnProgressionChart cashFlows={cashFlows} kpis={kpis} />
        </>
      )}

      {tab === 'progression' && isIncomeLike && (
        <>
          <NOIProgressionChart kpis={kpis} inputs={inputs} revenue={revenue} />
          <ValueVsCapRateCurve kpis={kpis} inputs={inputs} revenue={revenue} />
        </>
      )}

      {tab === 'costs' && <CostCompositionChart costs={costs} />}
    </div>
  );
}
