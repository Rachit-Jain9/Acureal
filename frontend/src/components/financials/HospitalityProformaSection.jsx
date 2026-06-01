import { useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area,
} from 'recharts';
import { clsx } from 'clsx';

// Renders the extended USALI hospitality output: 10-year P&L, Sources & Uses,
// LP/GP waterfall, revenue mix, sensitivity — only shown when the engine
// returned the extended hospitality payload.
export default function HospitalityProformaSection({ financials }) {
  if (!financials || financials.assetClass !== 'hospitality') return null;

  const pnl = financials.revenue?.usali_pnl;
  const summary = financials.revenue?.usali_summary || null;
  const waterfall = financials.capitalStack?.waterfall;
  const permanent = financials.capitalStack?.permanent;
  const construction = financials.capitalStack?.construction;
  const kpis = financials.kpis || {};
  const inputs = financials.inputs || {};

  if (!Array.isArray(pnl) || pnl.length === 0) return null;

  return (
    <div className="space-y-4">
      <HospitalityHeader inputs={inputs} kpis={kpis} />
      <UnitEconomicsStrip summary={summary} kpis={kpis} inputs={inputs} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RevenueMixCard pnl={pnl} />
        <NOIEvolutionCard pnl={pnl} />
      </div>
      <USALIProfitLossTable pnl={pnl} />
      {(construction || permanent) && (
        <CapitalStackTimelineCard
          construction={construction}
          permanent={permanent}
          kpis={kpis}
        />
      )}
      {waterfall && <WaterfallCard waterfall={waterfall} />}
    </div>
  );
}

// ─── Unit-economics strip — CPOR, break-even occ/RevPAR, flow-through, labour
function UnitEconomicsStrip({ summary, kpis, inputs }) {
  const cpor = kpis.costPerOccupiedRoom ?? summary?.stabilisedCPOR ?? null;
  const beOcc = kpis.breakEvenOccPct ?? summary?.breakEvenOccPct ?? null;
  const beRevPAR = kpis.breakEvenRevPAR ?? summary?.breakEvenRevPAR ?? null;
  const flowThrough = kpis.flowThroughPct ?? summary?.avgFlowThroughPct ?? null;
  const gopMargin = kpis.stabilizedGOPMarginPct ?? summary?.stabilisedGOPMarginPct ?? null;
  const ebitdaMargin = kpis.stabilizedEBITDAMarginPct ?? summary?.stabilisedEBITDAMarginPct ?? null;
  const noiMargin = kpis.stabilizedNOIMarginPct ?? summary?.stabilisedNOIMarginPct ?? null;
  const labourPerKey = kpis.labourCostPerKey ?? null;
  const staffPerKey = kpis.staffPerKey ?? inputs.staffPerKey ?? null;

  const hasAny = [cpor, beOcc, beRevPAR, flowThrough, gopMargin, ebitdaMargin, noiMargin, labourPerKey].some((v) => v != null);
  if (!hasAny) return null;

  const cells = [
    { label: 'CPOR',          value: cpor != null ? `₹${Math.round(cpor).toLocaleString('en-IN')}` : '—', sub: 'per occupied room' },
    { label: 'Break-even Occ', value: beOcc != null ? `${Number(beOcc).toFixed(1)}%` : '—', sub: 'cash break-even' },
    { label: 'Break-even RevPAR', value: beRevPAR != null ? `₹${Math.round(beRevPAR).toLocaleString('en-IN')}` : '—', sub: 'per available room' },
    { label: 'Flow-through',  value: flowThrough != null ? `${Number(flowThrough).toFixed(0)}%` : '—', sub: 'ΔGOP / ΔRev' },
    { label: 'GOP margin',    value: gopMargin != null ? `${Number(gopMargin).toFixed(1)}%` : '—', sub: 'stabilized' },
    { label: 'EBITDA margin', value: ebitdaMargin != null ? `${Number(ebitdaMargin).toFixed(1)}%` : '—', sub: 'stabilized' },
    { label: 'NOI margin',    value: noiMargin != null ? `${Number(noiMargin).toFixed(1)}%` : '—', sub: 'after FF&E' },
    { label: 'Labour / key',  value: labourPerKey != null
        ? `₹${(Number(labourPerKey) / 1e5).toFixed(1)} L`
        : (staffPerKey != null ? `${Number(staffPerKey).toFixed(2)} staff` : '—'),
      sub: 'annualised' },
  ];

  return (
    <div className="bg-bg-elevated border border-hairline rounded-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-hairline flex items-baseline gap-3">
        <div className="font-serif text-sm font-semibold text-content-primary">Unit economics <span className="text-content-muted">·</span> Indian hospitality benchmarks</div>
        <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-content-muted">USALI 11e · $/POR methodology</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-surface">
        {cells.map((c, i) => (
          <div key={i} className="bg-bg-elevated px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-content-secondary">{c.label}</div>
            <div className="mt-1 font-serif text-base font-semibold text-content-primary tabular-nums">{c.value}</div>
            <div className="text-[10px] text-content-muted mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Header KPI strip ───────────────────────────────────────────────────────
function HospitalityHeader({ inputs, kpis }) {
  // NOI per key — derived from total NOI (cumulative across all keys) ÷ keys.
  // The kernel emits `kpis.noi` as total ₹Cr; per-key comes from dividing by
  // `inputs.keys`. Surfaced as lakh because institutional hospitality quotes
  // per-key NOI in lakh/Cr, not raw rupees.
  const noiPerKeyLakh = (kpis.noi != null && inputs.keys > 0)
    ? (Number(kpis.noi) * 100) / Number(inputs.keys)
    : null;

  const stats = [
    { label: 'Keys',            value: fmtNum(inputs.keys, 0),                              unit: '' },
    { label: 'Stabilized ADR',  value: fmtInr(kpis.stabilizedADR),                          unit: '/night' },
    { label: 'Stabilized Occ',  value: kpis.stabilizedOccupancy != null ? `${Number(kpis.stabilizedOccupancy).toFixed(1)}%` : '—', unit: '' },
    { label: 'RevPAR',          value: fmtInr(kpis.revPAR),                                 unit: '/night' },
    { label: 'NOI / Key',       value: noiPerKeyLakh != null ? `₹${noiPerKeyLakh.toFixed(1)} L` : '—', unit: '/yr' },
    { label: 'Yield on Cost',   value: kpis.yieldOnCost != null ? `${kpis.yieldOnCost.toFixed(2)}%` : '—', unit: '' },
    { label: 'Levered IRR',     value: kpis.leveredIrr != null ? `${kpis.leveredIrr.toFixed(2)}%` : '—', unit: '' },
    { label: 'Dev / Key',       value: fmtInrLakh(kpis.devCostPerKey),                      unit: '' },
  ];
  return (
    <div className="bg-bg-elevated border border-hairline rounded-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-hairline">
        <div className="text-[11px] uppercase tracking-[0.18em] text-content-secondary">
          USALI-compliant hotel proforma
        </div>
        <div className="font-serif text-xl font-semibold text-content-primary leading-tight mt-0.5">
          Hospitality financial engine <span className="text-content-muted">·</span> India / Bengaluru
        </div>
        <div className="text-xs text-content-secondary mt-1">
          10-year annual P&amp;L • Sources &amp; Uses • Construction → Permanent refi • LP/GP waterfall
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-surface">
        {stats.map((s, i) => (
          <div key={i} className="bg-bg-elevated px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-content-secondary">{s.label}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-serif text-base font-semibold text-content-primary tabular-nums">{s.value}</span>
              {s.unit && <span className="text-[10px] text-content-muted">{s.unit}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Revenue mix pie (stabilized) ───────────────────────────────────────────
function RevenueMixCard({ pnl }) {
  const stab = pnl.find((y) => y.year === 4) || pnl[pnl.length - 1];
  const data = [
    { name: 'Rooms',            value: stab.roomsRevenueCr || 0, color: '#6366f1' },
    { name: 'F&B Restaurant',   value: stab.fbRestaurantCr || 0, color: '#f43f5e' },
    { name: 'F&B Banquet',      value: stab.fbBanquetCr   || 0, color: '#ec4899' },
    { name: 'Other Operated',   value: stab.otherOperatedCr || 0, color: '#f59e0b' },
    { name: 'Parking',          value: stab.parkingCr || 0, color: '#10b981' },
    { name: 'Lease Income',     value: stab.leaseIncomeCr || 0, color: '#06b6d4' },
  ].filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="bg-bg-elevated border border-hairline rounded-sm p-5">
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-content-secondary">Revenue mix (stabilized)</div>
        <div className="font-serif text-base font-semibold text-content-primary mt-0.5">Year {stab.year} <span className="text-content-muted">·</span> ₹{total.toFixed(1)} Cr total revenue</div>
      </div>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width="55%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v) => `₹${Number(v).toFixed(2)} Cr`} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-1.5">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
              <span className="flex-1 text-content-secondary">{d.name}</span>
              <span className="font-semibold text-content-primary">₹{d.value.toFixed(2)} Cr</span>
              <span className="text-content-muted w-10 text-right">{((d.value / total) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── NOI / EBITDA evolution line chart ──────────────────────────────────────
function NOIEvolutionCard({ pnl }) {
  const data = pnl.map((y) => ({
    year: `Y${y.year}`,
    Revenue: y.totalRevenueCr,
    GOP: y.gopCr,
    EBITDA: y.ebitdaCr,
    NOI: y.noiCr,
  }));

  return (
    <div className="card-editorial p-5">
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-content-secondary">Operating evolution</div>
        <div className="font-serif text-base font-semibold text-content-primary mt-0.5">Revenue → GOP → EBITDA → NOI <span className="text-content-muted">·</span> 10 years</div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border-primary)" strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={(v) => `₹${v}`} />
          <Tooltip formatter={(v) => `₹${Number(v).toFixed(2)} Cr`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="Revenue" fill="#c7d2fe" stroke="#6366f1" fillOpacity={0.25} />
          <Line type="monotone" dataKey="GOP"    stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2 }} />
          <Line type="monotone" dataKey="EBITDA" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
          <Line type="monotone" dataKey="NOI"    stroke="#f43f5e" strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Full USALI P&L table ───────────────────────────────────────────────────
function USALIProfitLossTable({ pnl }) {
  const years = pnl.map((y) => y.year);
  const rows = [
    { key: 'Occupancy %',    field: 'occupancy', fmt: (v) => v != null ? `${Number(v).toFixed(1)}%` : '—', bold: false },
    { key: 'ADR (blended)',  field: 'adr', fmt: fmtInr },
    { key: 'RevPAR',         field: 'revPAR', fmt: fmtInr },
    { key: 'TRevPAR',        field: 'trevPAR', fmt: fmtInr },
    null,
    { key: 'Rooms revenue',       field: 'roomsRevenueCr', fmt: fmtCr, group: 'revenue' },
    { key: 'F&B — Restaurant', field: 'fbRestaurantCr', fmt: fmtCr, group: 'revenue', indent: 1 },
    { key: 'F&B — Banquet',    field: 'fbBanquetCr', fmt: fmtCr, group: 'revenue', indent: 1 },
    { key: 'Other operated',      field: 'otherOperatedCr', fmt: fmtCr, group: 'revenue', indent: 1 },
    { key: 'Parking',             field: 'parkingCr', fmt: fmtCr, group: 'revenue', indent: 1 },
    { key: 'Lease income',        field: 'leaseIncomeCr', fmt: fmtCr, group: 'revenue', indent: 1 },
    { key: 'Total revenue',       field: 'totalRevenueCr', fmt: fmtCr, group: 'revenue', bold: true },
    null,
    { key: 'Rooms dept expense',  field: 'roomsDeptExpCr', fmt: fmtCrNeg, group: 'dept', indent: 1 },
    { key: 'F&B dept expense',    field: 'fbDeptExpCr',    fmt: fmtCrNeg, group: 'dept', indent: 1 },
    { key: 'Other dept expense',  field: 'otherDeptExpCr', fmt: fmtCrNeg, group: 'dept', indent: 1 },
    { key: 'Departmental profit', field: 'deptProfitCr', fmt: fmtCr, group: 'dept', bold: true },
    null,
    { key: 'Admin & General',  field: 'aAndGCr', fmt: fmtCrNeg, group: 'undist', indent: 1 },
    { key: 'IT / Systems',     field: 'itCr',    fmt: fmtCrNeg, group: 'undist', indent: 1 },
    { key: 'Sales & Marketing',field: 'smCr',    fmt: fmtCrNeg, group: 'undist', indent: 1 },
    { key: 'POM',              field: 'pomCr',   fmt: fmtCrNeg, group: 'undist', indent: 1 },
    { key: 'Utilities',        field: 'utilitiesCr', fmt: fmtCrNeg, group: 'undist', indent: 1 },
    null,
    { key: 'Brand royalty',       field: 'brandRoyaltyCr',   fmt: fmtCrNeg, group: 'brand', indent: 1 },
    { key: 'Brand mkt + reservation', field: 'brandMktReservCr', fmt: fmtCrNeg, group: 'brand', indent: 1 },
    null,
    { key: 'GOP', field: 'gopCr', fmt: fmtCr, group: 'gop', bold: true },
    { key: 'GOP margin %', field: 'gopMarginPct', fmt: (v) => v != null ? `${v.toFixed(1)}%` : '—', group: 'gop' },
    null,
    { key: 'Management fee — base',      field: 'mgmtBaseCr',      fmt: fmtCrNeg, group: 'mgmt', indent: 1 },
    { key: 'Management fee — incentive', field: 'mgmtIncentiveCr', fmt: fmtCrNeg, group: 'mgmt', indent: 1 },
    { key: 'IBFC', field: 'ibfcCr', fmt: fmtCr, group: 'mgmt', bold: true },
    null,
    { key: 'Property tax (BBMP)', field: 'propTaxCr',    fmt: fmtCrNeg, group: 'fixed', indent: 1 },
    { key: 'Insurance',           field: 'insuranceCr',  fmt: fmtCrNeg, group: 'fixed', indent: 1 },
    { key: 'Ground lease',        field: 'groundLeaseCr',fmt: fmtCrNeg, group: 'fixed', indent: 1 },
    null,
    { key: 'EBITDA', field: 'ebitdaCr', fmt: fmtCr, group: 'ebitda', bold: true, highlight: 'emerald' },
    { key: 'EBITDA margin %', field: 'ebitdaMarginPct', fmt: (v) => v != null ? `${v.toFixed(1)}%` : '—', group: 'ebitda' },
    null,
    { key: 'FF&E reserve', field: 'ffeReserveCr', fmt: fmtCrNeg, group: 'noi', indent: 1 },
    { key: 'NOI', field: 'noiCr', fmt: fmtCr, group: 'noi', bold: true, highlight: 'indigo' },
    { key: 'NOI margin %', field: 'noiMarginPct', fmt: (v) => v != null ? `${v.toFixed(1)}%` : '—', group: 'noi' },
  ];

  return (
    <div className="bg-bg-elevated border border-hairline rounded-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-hairline flex items-baseline gap-3">
        <div className="font-serif text-sm font-semibold text-content-primary">USALI 10-year profit &amp; loss <span className="text-content-muted">(₹ Cr)</span></div>
        <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-content-muted">Uniform System of Accounts, 11e</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-bg-secondary text-[10px] uppercase tracking-[0.08em] text-content-secondary">
            <tr>
              <th className="text-left px-4 py-2 font-medium sticky left-0 bg-bg-secondary z-10">Line item</th>
              {years.map((y) => (
                <th key={y} className="text-right px-2.5 py-2 font-medium">Y{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r === null) return <tr key={`sep-${idx}`}><td colSpan={years.length + 1} className="border-b border-hairline h-1" /></tr>;
              const highlight = r.highlight === 'emerald' ? 'bg-pos-soft' : r.highlight === 'indigo' ? 'bg-accent-soft' : '';
              return (
                <tr key={r.key} className={clsx('border-b border-hairline', highlight)}>
                  <td className={clsx(
                    'px-4 py-1.5 sticky left-0 z-10 bg-bg-elevated',
                    r.bold ? 'font-bold text-content-primary' : 'text-content-secondary',
                  )} style={r.indent ? { paddingLeft: 24 + r.indent * 12 } : {}}>
                    {r.key}
                  </td>
                  {pnl.map((y) => (
                    <td key={y.year} className={clsx('px-2.5 py-1.5 text-right tabular-nums', r.bold ? 'font-semibold text-content-primary' : 'text-content-secondary')}>
                      {r.fmt(y[r.field])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Capital stack timeline (construction → refi → exit) ────────────────────
function CapitalStackTimelineCard({ construction, permanent, kpis }) {
  return (
    <div className="bg-bg-elevated border border-hairline rounded-sm p-5">
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-content-secondary">Capital structure timeline</div>
        <div className="font-serif text-base font-semibold text-content-primary mt-0.5">Construction loan → Permanent refi</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {construction && (
          <StackColumn
            title="Construction loan"
            subtitle={`LTC ${construction.ltcPct}% • ${construction.ratePct}% interest`}
            tone="rose"
            rows={[
              { label: 'Principal',     value: `₹${construction.principalCr?.toFixed(2)} Cr` },
              { label: 'IDC + fees',    value: `₹${construction.idcCr?.toFixed(2)} Cr` },
              { label: 'Term',          value: `${construction.termYears} yrs` },
              { label: 'Loan fees',     value: `${construction.feesPct}%` },
            ]}
          />
        )}
        {permanent && (
          <StackColumn
            title="Permanent loan (post-refi)"
            subtitle={`LTV ${permanent.ltvPct}% on stab. value @ ${permanent.sizingCapRate}% cap`}
            tone="indigo"
            rows={[
              { label: 'Principal',        value: `₹${permanent.principalCr?.toFixed(2)} Cr` },
              { label: 'Rate',             value: `${permanent.ratePct}%` },
              { label: 'IO / Amort',       value: `${permanent.ioYears}y IO + ${permanent.amortYears}y amort` },
              { label: 'Annual DS',        value: `₹${permanent.annualDebtServiceCr?.toFixed(2)} Cr` },
              { label: 'DSCR',             value: kpis.dscr != null ? kpis.dscr.toFixed(2) : '—' },
              { label: 'Debt yield',       value: kpis.debtYieldPct != null ? `${kpis.debtYieldPct.toFixed(2)}%` : '—' },
              { label: 'Min DSCR',         value: kpis.minDSCR != null ? kpis.minDSCR.toFixed(2) : '—' },
              { label: 'Balloon at exit',  value: `₹${permanent.balloonRepaymentCr?.toFixed(2)} Cr` },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function StackColumn({ title, subtitle, tone, rows }) {
  const tones = {
    rose:   'bg-neg-soft border-hairline',
    indigo: 'bg-accent-soft border-hairline',
  };
  return (
    <div className={clsx('rounded-xl border p-4', tones[tone] || tones.rose)}>
      <div className="text-sm font-semibold text-content-primary">{title}</div>
      <div className="text-[11px] text-content-secondary mb-2">{subtitle}</div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-xs border-b border-hairline last:border-0 py-1">
            <span className="text-content-secondary">{r.label}</span>
            <span className="font-semibold text-content-primary tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Waterfall ──────────────────────────────────────────────────────────────
function WaterfallCard({ waterfall }) {
  const { tiers, totalLPCr, totalGPCr, lpEquityMultiple, gpEquityMultiple, totalEquityCr, lpCapitalCr, gpCapitalCr, totalDistributionsCr } = waterfall;
  const chartData = tiers.map((t) => ({ name: t.name.split('—')[0].trim(), LP: t.lpCr, GP: t.gpCr }));

  return (
    <div className="bg-bg-elevated border border-hairline rounded-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-hairline flex items-baseline gap-3">
        <div className="font-serif text-sm font-semibold text-content-primary">LP / GP Waterfall</div>
        <span className="ml-auto text-[11px] text-content-secondary tabular-nums">
          Total distributions ₹{totalDistributionsCr?.toFixed(1)} Cr <span className="text-content-muted">·</span> Equity ₹{totalEquityCr?.toFixed(1)} Cr
        </span>
      </div>
      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 90 }}>
              <CartesianGrid stroke="var(--color-border-primary)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={(v) => `₹${v}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={90} />
              <Tooltip formatter={(v) => `₹${Number(v).toFixed(2)} Cr`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="LP" fill="#6366f1" stackId="a" />
              <Bar dataKey="GP" fill="#f43f5e" stackId="a" />
            </BarChart>
          </ResponsiveContainer>

          <table className="w-full text-xs mt-3">
            <thead className="bg-bg-secondary text-[10px] uppercase tracking-[0.08em] text-content-secondary">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Tier</th>
                <th className="text-right px-3 py-2 font-medium">Hurdle</th>
                <th className="text-right px-3 py-2 font-medium">LP split</th>
                <th className="text-right px-3 py-2 font-medium">GP split</th>
                <th className="text-right px-3 py-2 font-medium">LP ₹ Cr</th>
                <th className="text-right px-3 py-2 font-medium">GP ₹ Cr</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={i} className="border-b border-hairline">
                  <td className="px-3 py-1.5 text-content-primary font-medium">{t.name}</td>
                  <td className="px-3 py-1.5 text-right text-content-secondary">{t.hurdlePct ? `${t.hurdlePct}% IRR` : '—'}</td>
                  <td className="px-3 py-1.5 text-right text-content-secondary">{t.lpSharePct}%</td>
                  <td className="px-3 py-1.5 text-right text-content-secondary">{t.gpSharePct}%</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-accent tabular-nums">₹{t.lpCr?.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-data-negative tabular-nums">₹{t.gpCr?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          <SummaryCard
            label="LP"
            tone="indigo"
            capital={lpCapitalCr}
            total={totalLPCr}
            multiple={lpEquityMultiple}
          />
          <SummaryCard
            label="GP / Sponsor"
            tone="rose"
            capital={gpCapitalCr}
            total={totalGPCr}
            multiple={gpEquityMultiple}
          />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, tone, capital, total, multiple }) {
  // Flat, theme-safe tile with a semantic left-accent stripe (no gradient).
  const stripe = {
    indigo: 'border-l-accent',
    rose:   'border-l-rose-500',
  };
  return (
    <div className={clsx('rounded-xl p-4 bg-bg-secondary border border-hairline border-l-2 text-content-primary', stripe[tone] || stripe.indigo)}>
      <div className="text-[10px] uppercase tracking-[0.12em] opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{multiple != null ? `${multiple.toFixed(2)}\u00d7` : '—'}</div>
      <div className="text-[11px] opacity-80">equity multiple</div>
      <div className="mt-3 space-y-0.5 text-[11px]">
        <div className="flex justify-between"><span className="opacity-80">Contributed</span><span className="font-semibold tabular-nums">₹{capital?.toFixed(2)} Cr</span></div>
        <div className="flex justify-between"><span className="opacity-80">Distributed</span><span className="font-semibold tabular-nums">₹{total?.toFixed(2)} Cr</span></div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtNum(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits === 0 ? 0 : 0 });
}
function fmtInr(n) {
  if (n == null || isNaN(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
function fmtInrLakh(n) {
  if (n == null || isNaN(n)) return '—';
  const lakh = n / 1e5;
  return lakh >= 100 ? `₹${(lakh / 100).toFixed(2)} Cr` : `₹${lakh.toFixed(1)} L`;
}
function fmtCr(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(2);
}
function fmtCrNeg(n) {
  if (n == null || isNaN(n)) return '—';
  return `(${Math.abs(Number(n)).toFixed(2)})`;
}
