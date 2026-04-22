import { useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area,
} from 'recharts';
import {
  Hotel, TrendingUp, IndianRupee, Layers, PieChart as PieIcon,
  Wallet, Users, BarChart3, Receipt, Sparkles, Percent, Info,
} from 'lucide-react';
import { clsx } from 'clsx';

// Renders the extended USALI hospitality output: 10-year P&L, Sources & Uses,
// LP/GP waterfall, revenue mix, sensitivity — only shown when the engine
// returned the extended hospitality payload.
export default function HospitalityProformaSection({ financials }) {
  if (!financials || financials.assetClass !== 'hospitality') return null;

  const pnl = financials.revenue?.usali_pnl;
  const sourcesUses = financials.costs?.sources_uses
    || financials.costsRaw?.sources_uses
    || financials.sourcesUses;
  const waterfall = financials.capitalStack?.waterfall;
  const permanent = financials.capitalStack?.permanent;
  const construction = financials.capitalStack?.construction;
  const kpis = financials.kpis || {};
  const inputs = financials.inputs || {};

  if (!Array.isArray(pnl) || pnl.length === 0) return null;

  return (
    <div className="space-y-4">
      <HospitalityHeader inputs={inputs} kpis={kpis} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RevenueMixCard pnl={pnl} />
        <NOIEvolutionCard pnl={pnl} />
      </div>
      <USALIProfitLossTable pnl={pnl} />
      {sourcesUses && <SourcesUsesCard sourcesUses={sourcesUses} />}
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

// ─── Header KPI strip ───────────────────────────────────────────────────────
function HospitalityHeader({ inputs, kpis }) {
  const stats = [
    { label: 'Keys',            value: fmtNum(inputs.keys, 0),                              unit: '' },
    { label: 'Stabilized ADR',  value: fmtInr(kpis.stabilizedADR),                          unit: '/night' },
    { label: 'Stabilized Occ',  value: kpis.stabilizedOccupancy != null ? `${Number(kpis.stabilizedOccupancy).toFixed(1)}%` : '—', unit: '' },
    { label: 'RevPAR',          value: fmtInr(kpis.revPAR),                                 unit: '/night' },
    { label: 'GOP Margin',      value: kpis.gopMarginPct != null ? `${kpis.gopMarginPct.toFixed(1)}%` : '—', unit: '' },
    { label: 'Yield on Cost',   value: kpis.yieldOnCost != null ? `${kpis.yieldOnCost.toFixed(2)}%` : '—', unit: '' },
    { label: 'Levered IRR',     value: kpis.leveredIrr != null ? `${kpis.leveredIrr.toFixed(2)}%` : '—', unit: '' },
    { label: 'Dev / Key',       value: fmtInrLakh(kpis.devCostPerKey),                      unit: '' },
  ];
  return (
    <div className="card-editorial p-0 overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-rose-500 via-pink-500 to-orange-500 text-white flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
          <Hotel size={18} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/80">
            USALI-compliant hotel proforma
          </div>
          <div className="text-lg font-semibold leading-tight">
            Hospitality financial engine — India / Bengaluru
          </div>
          <div className="text-[11px] text-white/80 mt-0.5">
            10-year annual P&L • Sources & Uses • Construction \u2192 Permanent refi • LP/GP waterfall
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-gray-100 border-b border-gray-100">
        {stats.map((s, i) => (
          <div key={i} className="bg-white px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.1em] font-medium text-gray-500">{s.label}</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-sm font-bold text-gray-900">{s.value}</span>
              {s.unit && <span className="text-[10px] text-gray-400">{s.unit}</span>}
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
    <div className="card-editorial p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-pink-500 text-white flex items-center justify-center">
          <PieIcon size={14} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-gray-500">Revenue mix (stabilized)</div>
          <div className="text-sm font-semibold text-gray-800">Year {stab.year} — ₹{total.toFixed(1)} Cr total revenue</div>
        </div>
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
              <span className="flex-1 text-gray-700">{d.name}</span>
              <span className="font-semibold text-gray-900">₹{d.value.toFixed(2)} Cr</span>
              <span className="text-gray-400 w-10 text-right">{((d.value / total) * 100).toFixed(1)}%</span>
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
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white flex items-center justify-center">
          <TrendingUp size={14} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-gray-500">Operating evolution</div>
          <div className="text-sm font-semibold text-gray-800">Revenue \u2192 GOP \u2192 EBITDA \u2192 NOI — 10 years</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#6b7280' }} />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => `₹${v}`} />
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
    <div className="card-editorial p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center gap-2">
        <BarChart3 size={14} className="text-gray-600" />
        <div className="text-sm font-semibold text-gray-800">USALI 10-year profit & loss (₹ Cr)</div>
        <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-gray-400">Uniform System of Accounts, 11e</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-[0.08em] text-gray-500">
            <tr>
              <th className="text-left px-4 py-2 font-medium sticky left-0 bg-gray-50 z-10">Line item</th>
              {years.map((y) => (
                <th key={y} className="text-right px-2.5 py-2 font-medium">Y{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r === null) return <tr key={`sep-${idx}`}><td colSpan={years.length + 1} className="border-b border-gray-100 h-1" /></tr>;
              const highlight = r.highlight === 'emerald' ? 'bg-emerald-50/60' : r.highlight === 'indigo' ? 'bg-indigo-50/60' : '';
              return (
                <tr key={r.key} className={clsx('border-b border-gray-50', highlight)}>
                  <td className={clsx(
                    'px-4 py-1.5 sticky left-0 z-10',
                    highlight || 'bg-white',
                    r.bold ? 'font-bold text-gray-900' : 'text-gray-700',
                  )} style={r.indent ? { paddingLeft: 24 + r.indent * 12 } : {}}>
                    {r.key}
                  </td>
                  {pnl.map((y) => (
                    <td key={y.year} className={clsx('px-2.5 py-1.5 text-right tabular-nums', r.bold ? 'font-semibold text-gray-900' : 'text-gray-700')}>
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

// ─── Sources & Uses ─────────────────────────────────────────────────────────
function SourcesUsesCard({ sourcesUses }) {
  const { uses, sources, usesTotalCr, sourcesTotalCr, refinance } = sourcesUses;
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#64748b'];
  const stackData = [{ name: 'Uses' }];
  uses.forEach((u, i) => { stackData[0][u.category] = u.subtotalCr; });
  const usesCategories = uses.map((u) => u.category);

  return (
    <div className="card-editorial p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-amber-50 via-white to-rose-50 flex items-center gap-2">
        <Receipt size={14} className="text-amber-600" />
        <div className="text-sm font-semibold text-gray-800">Sources & Uses</div>
        <span className="ml-auto text-[10px] text-gray-500">Total ₹{usesTotalCr?.toFixed(1)} Cr</span>
      </div>
      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Uses breakdown */}
        <div className="lg:col-span-2">
          <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-gray-500 mb-2">Uses of funds</div>
          <div className="space-y-2">
            {uses.map((u, i) => (
              <div key={u.category} className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: colors[i % colors.length] }} />
                    <span className="text-xs font-semibold text-gray-800">{u.category}</span>
                  </div>
                  <div className="text-xs font-bold text-gray-900">
                    ₹{u.subtotalCr?.toFixed(2)} Cr
                    <span className="ml-2 text-[10px] font-medium text-gray-400">
                      {usesTotalCr > 0 ? ((u.subtotalCr / usesTotalCr) * 100).toFixed(1) : '0'}%
                    </span>
                  </div>
                </div>
                {u.items?.map((it, j) => (
                  <div key={j} className="flex items-center justify-between text-[11px] pl-4">
                    <span className="text-gray-600">{it.label}</span>
                    <span className="text-gray-700 tabular-nums">₹{it.valueCr?.toFixed(2)} Cr</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Sources + refi */}
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-gray-500 mb-2">Sources of funds</div>
          <div className="space-y-2">
            {sources.map((s, i) => (
              <div key={i} className={clsx(
                'rounded-lg border p-3',
                s.category === 'debt'   ? 'bg-rose-50/60 border-rose-100' : 'bg-emerald-50/60 border-emerald-100',
              )}>
                <div className="text-[11px] text-gray-600">{s.label}</div>
                <div className="mt-0.5 flex items-baseline justify-between">
                  <span className={clsx('text-lg font-bold', s.category === 'debt' ? 'text-rose-900' : 'text-emerald-900')}>
                    ₹{s.valueCr?.toFixed(2)} Cr
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {sourcesTotalCr > 0 ? ((s.valueCr / sourcesTotalCr) * 100).toFixed(1) : '0'}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          {refinance && (
            <div className="mt-3 rounded-lg border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-3">
              <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-indigo-700 mb-1 flex items-center gap-1.5">
                <Sparkles size={10} /> Permanent refinance (at stabilization)
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <RefiRow label="Year"            value={`Y${refinance.refiYear}`} />
                <RefiRow label="Stabilized value" value={`₹${refinance.stabilizedValueForRefiCr?.toFixed(1)} Cr`} />
                <RefiRow label="Going-in cap"    value={`${refinance.refiCapRatePct}%`} />
                <RefiRow label="LTV"             value={`${refinance.refiLTVPct}%`} />
                <RefiRow label="Principal"       value={`₹${refinance.refiPrincipalCr?.toFixed(1)} Cr`} />
                <RefiRow label="Rate"            value={`${refinance.refiInterestRatePct}%`} />
                <RefiRow label="IO period"       value={`${refinance.refiIOYears} yrs`} />
                <RefiRow label="Amort"           value={`${refinance.refiAmortYears} yrs`} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RefiRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-800 tabular-nums">{value}</span>
    </div>
  );
}

// ─── Capital stack timeline (construction → refi → exit) ────────────────────
function CapitalStackTimelineCard({ construction, permanent, kpis }) {
  return (
    <div className="card-editorial p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center">
          <Layers size={14} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-gray-500">Capital structure timeline</div>
          <div className="text-sm font-semibold text-gray-800">Construction loan \u2192 Permanent refi</div>
        </div>
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
    rose:   'bg-gradient-to-br from-rose-50 to-white border-rose-100',
    indigo: 'bg-gradient-to-br from-indigo-50 to-white border-indigo-100',
  };
  return (
    <div className={clsx('rounded-xl border p-4', tones[tone] || tones.rose)}>
      <div className="text-sm font-semibold text-gray-800">{title}</div>
      <div className="text-[11px] text-gray-500 mb-2">{subtitle}</div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-xs border-b border-gray-100 last:border-0 py-1">
            <span className="text-gray-500">{r.label}</span>
            <span className="font-semibold text-gray-800 tabular-nums">{r.value}</span>
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
    <div className="card-editorial p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-violet-50 via-white to-indigo-50 flex items-center gap-2">
        <Users size={14} className="text-violet-600" />
        <div className="text-sm font-semibold text-gray-800">LP / GP Waterfall</div>
        <span className="ml-auto text-[10px] text-gray-500">
          Total distributions ₹{totalDistributionsCr?.toFixed(1)} Cr • Equity ₹{totalEquityCr?.toFixed(1)} Cr
        </span>
      </div>
      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 90 }}>
              <CartesianGrid stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => `₹${v}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={90} />
              <Tooltip formatter={(v) => `₹${Number(v).toFixed(2)} Cr`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="LP" fill="#6366f1" stackId="a" />
              <Bar dataKey="GP" fill="#f43f5e" stackId="a" />
            </BarChart>
          </ResponsiveContainer>

          <table className="w-full text-xs mt-3">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-[0.08em] text-gray-500">
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
                <tr key={i} className="border-b border-gray-50">
                  <td className="px-3 py-1.5 text-gray-800 font-medium">{t.name}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{t.hurdlePct ? `${t.hurdlePct}% IRR` : '—'}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{t.lpSharePct}%</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{t.gpSharePct}%</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-indigo-700 tabular-nums">₹{t.lpCr?.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-rose-700 tabular-nums">₹{t.gpCr?.toFixed(2)}</td>
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
  const tones = {
    indigo: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
    rose:   'bg-gradient-to-br from-rose-500 to-pink-600 text-white',
  };
  return (
    <div className={clsx('rounded-xl p-4', tones[tone] || tones.indigo)}>
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
