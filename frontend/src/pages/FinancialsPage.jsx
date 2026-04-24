import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Calculator, TrendingUp, DollarSign, BarChart3,
  Grid3X3, IndianRupee, Percent, Building2, ChevronDown,
} from 'lucide-react';
import ReferenceMenu from '../components/financials/ReferenceMenu';
import AssetClassInsightBanner from '../components/financials/AssetClassInsightBanner';
import FinancialVisualizationLayer from '../components/financials/FinancialVisualizationLayer';
import HospitalityProformaSection from '../components/financials/HospitalityProformaSection';
import QuarterlyProformaPanel from '../components/financials/QuarterlyProformaPanel';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { useFinancials, useCalculateFinancials } from '../hooks/useFinancials';
import InputForm from '../components/financials/InputForm';
import WhatIfSliders from '../components/financials/WhatIfSliders';
import SensitivityTornado from '../components/financials/SensitivityTornado';
import ScenarioComparison from '../components/financials/ScenarioComparison';
import AuditTimelineView from '../components/financials/AuditTimelineView';
import {
  JDAWaterfallPanel,
  JVWaterfallPanel,
  DebtSchedulePanel,
} from '../components/financials/CapitalStructurePanels';
import {
  INCOME_CLASSES,
  HOSPITALITY_CLASSES,
  ASSET_CLASSES,
  getModelAssetClass,
  getFinancialModelLabel,
} from '../components/financials/fieldDefs';
import { useDeal } from '../hooks/useDeals';
import { readPrefill, clearPrefill } from '../utils/programmeToInputs';
import { toast } from '../components/common/Toast';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import KPIStatCard from '../components/financials/KPIStatCard';
import { formatCrores, formatPct, formatINR, formatArea } from '../utils/format';

// ─── HELPERS ───────────────────────────────────────────────────────────────

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const hasLegacyResidentialLoadingFactor = (financials) => {
  if (!financials) return false;
  const assetClass = financials.asset_class || financials.model_params?.assetClass;
  if (assetClass !== 'residential_apartments') return false;

  const stored = financials.model_params?.inputs?.loadingFactor;
  const raw = stored ?? financials.loading_factor;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0.45;
};

function normalizeFinancials(financials) {
  if (!financials) return null;
  const mp = financials.model_params || {};
  const kpis = mp.kpis || {};
  const areas = mp.areas || {};
  const costs = mp.costs || {};
  const revenue = mp.revenue || {};
  const assetClass = financials.asset_class || 'residential_apartments';

  const cashFlowSeries = financials.cash_flows?.quarterly || [];
  const sm = financials.sensitivity_matrix || {};
  const inputsRaw = mp.inputs || {};

  return {
    assetClass,
    kpis: {
      irr: toNumber(kpis.irr ?? financials.irr_pct),
      npv: toNumber(kpis.npv ?? financials.npv_cr),
      equityMultiple: toNumber(kpis.equityMultiple ?? financials.equity_multiple),
      rlv: toNumber(kpis.rlv ?? financials.residual_land_value_cr),
      grossMarginPct: toNumber(kpis.grossMarginPct ?? financials.gross_margin_pct),
      noi: toNumber(kpis.noi ?? financials.noi_cr),
      noiAtExit: toNumber(kpis.noiAtExit),
      yieldOnCost: toNumber(kpis.yieldOnCost ?? financials.yield_on_cost_pct),
      dscr: toNumber(kpis.dscr ?? financials.dscr),
      exitValue: toNumber(kpis.exitValue ?? financials.exit_value_cr),
      entryValue: toNumber(kpis.entryValue ?? financials.entry_value_cr),
      exitCapRate: toNumber(kpis.exitCapRate ?? inputsRaw.exitCapRate),
      terminalValue: toNumber(kpis.terminalValue ?? kpis.exitValue),
      terminalValuePV: toNumber(kpis.terminalValuePV),
      terminalValueMethod: kpis.terminalValueMethod || inputsRaw.terminalValueMethod || null,
      terminalValueFormula: kpis.terminalValueFormula || null,
      capRateValuationCr: toNumber(kpis.capRateValuationCr),
      revPAR: toNumber(kpis.revPAR),
      gopMargin: toNumber(kpis.gopMargin),
    },
    inputs: inputsRaw,
    areas: {
      grossBuiltUp: toNumber(areas.grossBuiltUp ?? financials.gross_area_sqft),
      saleable: toNumber(areas.saleable ?? financials.saleable_area_sqft),
      carpet: toNumber(areas.carpet ?? financials.carpet_area_sqft),
      superBuiltUp: toNumber(areas.superBuiltUp ?? financials.super_builtup_area_sqft),
      leasable: toNumber(areas.leasable),
      keys: areas.keys,
      totalPlots: areas.totalPlots,
      avgPlotSizeSqft: toNumber(areas.avgPlotSizeSqft),
      numberOfUnits: toNumber(areas.numberOfUnits),
      residentialAvgUnitSize: toNumber(areas.avgUnitSizeSqft),
    },
    costs: {
      land: toNumber(costs.land ?? financials.land_cost_cr),
      construction: toNumber(costs.construction ?? financials.total_construction_cost_cr),
      gst: toNumber(costs.gst ?? financials.gst_cost_cr),
      stampDuty: toNumber(costs.stampDuty ?? financials.stamp_duty_cr),
      approval: toNumber(costs.approval ?? financials.approval_cost_cr),
      contingency: toNumber(costs.contingency),
      architecture: toNumber(costs.architecture),
      pmc: toNumber(costs.pmc),
      preOpening: toNumber(costs.preOpening),
      marketing: toNumber(costs.marketing ?? financials.marketing_cost_cr),
      finance: toNumber(costs.finance ?? financials.finance_cost_cr),
      tenantImprovements: toNumber(costs.tenantImprovements),
      leasingCommissions: toNumber(costs.leasingCommissions),
      total: toNumber(costs.total ?? financials.total_cost_cr),
    },
    revenue: {
      totalRevenue: toNumber(revenue.totalRevenueCr ?? financials.total_revenue_cr),
      profit: toNumber(revenue.grossProfitCr ?? financials.gross_profit_cr),
      margin: toNumber(revenue.grossMarginPct ?? financials.gross_margin_pct),
      annualNOI: toNumber(revenue.annualNOI ?? financials.noi_cr),
      stabilizedNOI: toNumber(revenue.stabilizedNOI ?? financials.stabilized_noi_cr),
      noiAtExit: toNumber(revenue.noiAtExit),
      exitValue: toNumber(revenue.exitValue ?? financials.exit_value_cr),
      terminalValue: toNumber(revenue.terminalValue ?? revenue.exitValue),
      terminalValuePV: toNumber(revenue.terminalValuePV),
      terminalValueMethod: revenue.terminalValueMethod || null,
      terminalValueFormula: revenue.terminalValueFormula || null,
      capRateValuationCr: toNumber(revenue.capRateValuationCr),
      roomsRevenue: toNumber(revenue.roomsRevenue),
      fbRevenue: toNumber(revenue.fbRevenue),
      gop: toNumber(revenue.gop),
      ebitda: toNumber(revenue.ebitda),
      usali_pnl: revenue.usali_pnl || null,
      usali_summary: revenue.usali_summary || null,
    },
    // Preserve extended hospitality payloads
    costsRaw: costs,
    capitalStack: mp.capitalStack || null,
    sourcesUses: costs.sources_uses || null,
    cashFlows: cashFlowSeries.map((cf, i) => ({ quarter: cf.quarter ?? i, value: toNumber(cf.net) ?? 0 })),
    yearlyCashFlows: (financials.cash_flows?.yearly || []).map((cf) => ({ year: cf.year, label: cf.label, value: toNumber(cf.net) ?? 0 })),
    // Quarterly proforma waterfall — persisted on every save via
    // kernel.service.js → financial.service.js model_params. Shape from
    // packages/financial-kernel/src/postprocess/proforma.ts.
    proforma: mp.proforma || null,
    sensitivity: {
      sellingRates: sm.sellingRates || [],
      constructionCosts: sm.constructionCosts || [],
      grid: sm.irrGrid || [],
      axis: sm.axis || ['Constr. Cost', 'Selling Rate'],
    },
  };
}

// ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

function KPICards({ kpis, assetClass, inputs }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const isIncome = INCOME_CLASSES.has(modelAssetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(modelAssetClass);
  const commonProps = { assetClass, inputs };

  if (isHospitality) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIStatCard kpiKey="revPAR"    {...commonProps} title="RevPAR"         value={kpis.revPAR != null ? formatINR(kpis.revPAR, 0) : '-'} subtitle="₹/key/night (stabilized)"    icon={IndianRupee} />
        <KPIStatCard kpiKey="noi"       {...commonProps} title="Stabilized NOI" value={formatCrores(kpis.noi)}                                subtitle="All keys · ₹ Cr / year"       icon={TrendingUp} />
        <KPIStatCard kpiKey="irr"       {...commonProps} title="IRR"            value={formatPct(kpis.irr)}                                  subtitle="Unlevered, through exit"      icon={Percent} />
        <KPIStatCard kpiKey="exitValue" {...commonProps} title="Exit Value"     value={formatCrores(kpis.exitValue)}                         subtitle="NOI / exit cap rate"          icon={DollarSign} />
      </div>
    );
  }

  if (isIncome) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIStatCard kpiKey="noi"          {...commonProps} title="Stabilized NOI" value={formatCrores(kpis.noi)}                                                      subtitle="Net Operating Income / yr" icon={IndianRupee} />
        <KPIStatCard kpiKey="yieldOnCost"  {...commonProps} title="Yield on Cost"  value={kpis.yieldOnCost != null ? `${kpis.yieldOnCost.toFixed(2)}%` : '-'}           subtitle="NOI / Total Dev. Cost"     icon={Percent} />
        <KPIStatCard kpiKey="irr"          {...commonProps} title="IRR"            value={formatPct(kpis.irr)}                                                         subtitle="Unlevered, through exit"   icon={TrendingUp} />
        <KPIStatCard kpiKey="exitValue"    {...commonProps} title="Exit Value"     value={formatCrores(kpis.exitValue)}                                                subtitle="At exit cap rate"          icon={DollarSign} />
      </div>
    );
  }

  const hasDscr = kpis.dscr != null;
  return (
    <div className={`grid grid-cols-2 ${hasDscr ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
      <KPIStatCard kpiKey="irr"            {...commonProps} title="IRR"             value={formatPct(kpis.irr)}                                                subtitle="Internal Rate of Return"     icon={TrendingUp} />
      <KPIStatCard kpiKey="npv"            {...commonProps} title="NPV"             value={formatCrores(kpis.npv)}                                             subtitle="Net Present Value"           icon={IndianRupee} />
      <KPIStatCard kpiKey="equityMultiple" {...commonProps} title="Equity Multiple" value={kpis.equityMultiple != null ? `${kpis.equityMultiple.toFixed(2)}x` : '-'} subtitle="Return on equity invested" icon={DollarSign} />
      <KPIStatCard kpiKey="rlv"            {...commonProps} title="RLV"             value={formatCrores(kpis.rlv)}                                             subtitle="Residual Land Value"         icon={Percent} />
      {hasDscr && (
        <KPIStatCard kpiKey="dscr"         {...commonProps} title="DSCR"            value={`${kpis.dscr.toFixed(2)}x`}                                         subtitle="Revenue / total debt service" icon={Percent} />
      )}
    </div>
  );
}

function AreaBreakdown({ areas, assetClass }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const rows = [];
  if (modelAssetClass === 'plotted_development') {
    rows.push({ label: 'Total Land Area', value: formatArea(areas.grossBuiltUp) });
    rows.push({ label: 'Saleable Land', value: formatArea(areas.saleable) });
    if (areas.totalPlots) rows.push({ label: 'Total Plots', value: areas.totalPlots.toLocaleString('en-IN') });
    if (areas.avgPlotSizeSqft) rows.push({ label: 'Avg Plot Size', value: formatArea(areas.avgPlotSizeSqft) });
  } else if (HOSPITALITY_CLASSES.has(modelAssetClass)) {
    if (areas.keys) rows.push({ label: 'Keys (rooms)', value: areas.keys.toLocaleString('en-IN') });
    if (areas.grossBuiltUp) rows.push({ label: 'Est. GFA (incl. common areas)', value: formatArea(areas.grossBuiltUp) });
  } else if (INCOME_CLASSES.has(modelAssetClass)) {
    rows.push({ label: 'Leasable Area', value: formatArea(areas.leasable) });
    rows.push({ label: 'Gross Built-Up (est.)', value: formatArea(areas.grossBuiltUp) });
  } else {
    rows.push({ label: 'Gross Built-Up Area', value: formatArea(areas.grossBuiltUp) });
    rows.push({ label: 'Saleable Area', value: formatArea(areas.saleable) });
    rows.push({ label: 'Carpet Area', value: formatArea(areas.carpet) });
    rows.push({ label: 'Super Built-Up Area', value: formatArea(areas.superBuiltUp) });
    if (areas.numberOfUnits) {
      rows.push({
        label: 'Number of Units',
        value: `${areas.numberOfUnits.toLocaleString('en-IN')}${areas.residentialAvgUnitSize ? ` @ ${formatArea(areas.residentialAvgUnitSize)}` : ''}`,
      });
    }
  }
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Area Breakdown</h3>
      <div className="space-y-2">
        {rows.filter((r) => r.value && r.value !== '-').map((row) => (
          <div key={row.label} className="flex justify-between text-sm">
            <span className="text-gray-500">{row.label}</span>
            <span className="font-medium text-gray-900">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostBreakdown({ costs, assetClass }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const rows = [
    { label: 'Land Cost',              value: costs.land },
    { label: modelAssetClass === 'plotted_development' ? 'Development Cost' : 'Construction Cost', value: costs.construction },
    { label: 'GST',                    value: costs.gst },
    { label: 'Contingency',            value: costs.contingency },
    { label: 'Stamp Duty',             value: costs.stampDuty },
    { label: 'Approval Cost',          value: costs.approval },
    { label: 'Architecture Fees',      value: costs.architecture },
    { label: 'PMC Fees',               value: costs.pmc },
    { label: 'Pre-Opening Costs',      value: costs.preOpening },
    { label: 'Marketing Cost',         value: costs.marketing },
    { label: 'Finance Cost',           value: costs.finance },
    { label: 'Tenant Improvements',    value: costs.tenantImprovements },
    { label: 'Leasing Commissions',    value: costs.leasingCommissions },
  ].filter((r) => r.value != null && r.value > 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Cost Breakdown</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between text-sm">
            <span className="text-gray-500">{row.label}</span>
            <span className="font-medium text-gray-900">{formatCrores(row.value)}</span>
          </div>
        ))}
        <div className="border-t pt-2 flex justify-between text-sm font-semibold">
          <span className="text-gray-700">Total Cost</span>
          <span className="text-gray-900">{formatCrores(costs.total)}</span>
        </div>
      </div>
    </div>
  );
}

function RevenuePanel({ revenue, kpis, assetClass }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const isIncome = INCOME_CLASSES.has(modelAssetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(modelAssetClass);

  let rows, panelTitle;
  if (isHospitality) {
    panelTitle = 'Hotel P&L (Stabilized Year)';
    rows = [
      { label: 'Rooms Revenue',   value: formatCrores(revenue.roomsRevenue) },
      { label: 'F&B Revenue',     value: formatCrores(revenue.fbRevenue) },
      { label: 'Total Revenue',   value: formatCrores(revenue.totalRevenue) },
      { label: 'GOP',             value: formatCrores(revenue.gop) },
      { label: 'EBITDA',          value: formatCrores(revenue.ebitda) },
      ...(kpis.dscr != null ? [{ label: 'DSCR', value: `${kpis.dscr.toFixed(2)}x` }] : []),
    ];
  } else if (isIncome) {
    panelTitle = 'Operating Summary';
    rows = [
      { label: 'Annual NOI (Stabilized)', value: formatCrores(revenue.annualNOI) },
      { label: 'Entry Value',              value: formatCrores(kpis.entryValue) },
      { label: 'Exit Value',               value: formatCrores(kpis.exitValue) },
      ...(kpis.dscr != null ? [{ label: 'DSCR', value: `${kpis.dscr.toFixed(2)}x` }] : []),
    ];
  } else {
    panelTitle = 'Revenue & Profit';
    rows = [
      { label: 'Revenue',  value: formatCrores(revenue.totalRevenue) },
      { label: 'Profit',   value: formatCrores(revenue.profit) },
      { label: 'Margin',   value: formatPct(revenue.margin) },
      ...(kpis.dscr != null ? [{ label: 'DSCR', value: `${kpis.dscr.toFixed(2)}x` }] : []),
    ];
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        {panelTitle}
      </h3>
      <div className="space-y-2">
        {rows.filter((r) => r.value && r.value !== '-').map((row) => (
          <div key={row.label} className="flex justify-between text-sm">
            <span className="text-gray-500">{row.label}</span>
            <span className="font-medium text-gray-900">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CashFlowChart({ cashFlows, yearlyCashFlows, assetClass }) {
  const [view, setView] = useState('quarterly');
  if (!cashFlows || cashFlows.length === 0) return null;
  const isIncome = INCOME_CLASSES.has(getModelAssetClass(assetClass));

  const quarterlyData = cashFlows.map((cf) => ({ name: `Q${cf.quarter}`, value: cf.value }));
  const yearlyData    = (yearlyCashFlows || []).map((cf) => ({ name: cf.label, value: cf.value }));
  const data          = view === 'yearly' ? yearlyData : quarterlyData;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <BarChart3 size={16} className="text-primary-600" />
          Cash Flows
        </h3>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
          <button
            type="button"
            onClick={() => setView('quarterly')}
            className={`px-3 py-1.5 transition-colors ${view === 'quarterly' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Quarterly
          </button>
          <button
            type="button"
            onClick={() => setView('yearly')}
            className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${view === 'yearly' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Yearly
          </button>
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={view === 'quarterly' && !isIncome ? 1 : 0} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)} Cr`} />
            <Tooltip formatter={(v) => [formatCrores(v), 'Net Cash Flow']} contentStyle={{ borderRadius: '8px', fontSize: '13px' }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {data.map((entry, i) => <Cell key={i} fill={entry.value >= 0 ? '#22c55e' : '#ef4444'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {view === 'yearly' && yearlyData.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500 border-t pt-3">
          {yearlyData.map((y) => (
            <span key={y.name} className={`font-medium ${y.value >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {y.name}: {formatCrores(y.value)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function getIRRColor(irr) {
  if (irr == null) return 'bg-gray-50 text-gray-400';
  if (irr >= 25)  return 'bg-emerald-100 text-emerald-800';
  if (irr >= 18)  return 'bg-green-50 text-green-700';
  if (irr >= 12)  return 'bg-yellow-50 text-yellow-700';
  if (irr >= 5)   return 'bg-orange-50 text-orange-700';
  return 'bg-red-100 text-red-800';
}

function SensitivityTable({ sensitivity, assetClass }) {
  if (!sensitivity?.grid?.length) return null;
  const { sellingRates, constructionCosts, grid, axis } = sensitivity;
  const modelAssetClass = getModelAssetClass(assetClass);
  const isIncome      = INCOME_CLASSES.has(modelAssetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(modelAssetClass);
  const rowLabel  = axis?.[0] || (isIncome ? 'Exit Cap Rate (%)' : 'Constr. Cost/sqft');
  const colHeader = axis?.[1] || (isIncome ? 'Base Rent/sqft/mo' : 'Selling Rate/sqft');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <Grid3X3 size={16} className="text-primary-600" />
        Sensitivity Analysis — IRR (%)
      </h3>
      <p className="text-xs text-gray-500 mb-3">Rows: {rowLabel} | Columns: {colHeader}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-gray-500 border-b whitespace-nowrap">↓ {rowLabel.split(' ')[0]} \ {colHeader.split(' ')[0]} →</th>
              {sellingRates.map((r) => (
                <th key={r} className="px-2 py-1.5 text-center font-medium text-gray-500 border-b whitespace-nowrap">
                  {isHospitality ? formatINR(r, 0) : isIncome ? r : formatINR(r, 0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {constructionCosts.map((cost, ri) => (
              <tr key={cost}>
                <td className="px-2 py-1.5 font-medium text-gray-700 border-b whitespace-nowrap">
                  {isHospitality ? `${cost}%` : isIncome ? `${cost}%` : formatINR(cost, 0)}
                </td>
                {grid[ri]?.map((irr, ci) => (
                  <td key={ci} className={`px-2 py-1.5 text-center font-medium border-b ${getIRRColor(irr)}`}>
                    {irr != null ? `${irr.toFixed(1)}%` : '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─── MAIN PAGE ─────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const { dealId } = useParams();
  const { data: financials, isLoading, error } = useFinancials(dealId);
  const { data: deal } = useDeal(dealId);
  const calculateMutation = useCalculateFinancials();

  const existingClass = financials?.asset_class || 'residential_apartments';
  const [selectedClass, setSelectedClass] = useState(null); // null = use stored
  const activeClass = selectedClass || existingClass;

  const inputsRef = useRef(null);
  const scrollToInputs = () => {
    inputsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Prefill staged on the Zoning tab via "Apply to underwriting" lives in
  // sessionStorage until consumed. Read once; clear on first consumption so a
  // page refresh doesn't keep re-applying it over user edits.
  const [prefill, setPrefill] = useState(() => readPrefill(dealId));
  useEffect(() => {
    // If the user lands here from another deal, re-read the prefill.
    setPrefill(readPrefill(dealId));
  }, [dealId]);
  useEffect(() => {
    if (prefill) {
      toast.success('Underwriting inputs pre-filled from buildability programme. Review and hit Calculate.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);
  const handlePrefillConsumed = () => {
    if (prefill) {
      clearPrefill(dealId);
      setPrefill(null);
    }
  };

  const normalizedFinancials = useMemo(() => normalizeFinancials(financials), [financials]);
  const hasResults = !!normalizedFinancials;
  const activeFinancialModelLabel = getFinancialModelLabel(activeClass);
  const showLegacyResidentialNotice = useMemo(
    () => hasLegacyResidentialLoadingFactor(financials),
    [financials]
  );

  const handleCalculate = (data) => {
    calculateMutation.mutate({ dealId, data });
  };

  const handleClassChange = (cls) => {
    setSelectedClass(cls);
  };

  if (isLoading) return <div className="py-20"><LoadingSpinner size="lg" /></div>;

  const shouldShowError = error && error?.response?.status !== 404;

  return (
    <div className="space-y-6">
      <PageHeader
        title="DCF Underwriting"
        description="Multi-asset-class financial modeling"
        actions={
          <div className="flex items-center gap-2">
            <ReferenceMenu assetClass={activeClass} />
            <Link to={`/dashboard/deals/${dealId}`} className="btn btn-secondary flex items-center gap-1.5">
              <ArrowLeft size={16} /> Back to Deal
            </Link>
          </div>
        }
      />

      <AssetClassInsightBanner assetClass={activeClass} />

      {/* Asset Class Selector */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Building2 size={16} className="text-primary-600" />
            Asset Class
          </div>
          <div className="relative">
            <select
              value={activeClass}
              onChange={(e) => handleClassChange(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              {ASSET_CLASSES.map((ac) => (
                <option key={ac.value} value={ac.value}>{ac.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <span className="text-xs text-gray-500">
            Underwriting model: {activeFinancialModelLabel}
          </span>
          {hasResults && normalizedFinancials.assetClass !== activeClass && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
              Switching class — current results shown above are for {ASSET_CLASSES.find((a) => a.value === normalizedFinancials.assetClass)?.label}
            </span>
          )}
        </div>
      </div>

      {showLegacyResidentialNotice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This residential model was saved under the legacy loading-factor logic. The recalculate form below now normalizes the loading factor to the corrected additive format, but the KPI cards above remain the previously saved output until you click `Calculate`.
        </div>
      )}

      {/* Results for existing financials */}
      {hasResults && (
        <>
          <KPICards kpis={normalizedFinancials.kpis} assetClass={normalizedFinancials.assetClass} inputs={normalizedFinancials.inputs} />

          <WhatIfSliders
            assetClass={normalizedFinancials.assetClass}
            baseInputs={normalizedFinancials.inputs}
            baseKpis={normalizedFinancials.kpis}
            onEditInputs={scrollToInputs}
          />

          <SensitivityTornado
            assetClass={normalizedFinancials.assetClass}
            baseInputs={normalizedFinancials.inputs}
            baseKpis={normalizedFinancials.kpis}
            onEditInputs={scrollToInputs}
          />

          <ScenarioComparison
            assetClass={normalizedFinancials.assetClass}
            baseInputs={normalizedFinancials.inputs}
            baseKpis={normalizedFinancials.kpis}
            onEditInputs={scrollToInputs}
          />

          <FinancialVisualizationLayer
            financials={normalizedFinancials}
            inputs={normalizedFinancials.inputs}
          />

          {normalizedFinancials.assetClass === 'hospitality' && (
            <HospitalityProformaSection financials={normalizedFinancials} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <AreaBreakdown areas={normalizedFinancials.areas} assetClass={normalizedFinancials.assetClass} />
            <CostBreakdown costs={normalizedFinancials.costs} assetClass={normalizedFinancials.assetClass} />
            <RevenuePanel revenue={normalizedFinancials.revenue} kpis={normalizedFinancials.kpis} assetClass={normalizedFinancials.assetClass} />
          </div>

          <CashFlowChart cashFlows={normalizedFinancials.cashFlows} yearlyCashFlows={normalizedFinancials.yearlyCashFlows} assetClass={normalizedFinancials.assetClass} />
          <QuarterlyProformaPanel proforma={normalizedFinancials.proforma} />
          <SensitivityTable sensitivity={normalizedFinancials.sensitivity} assetClass={normalizedFinancials.assetClass} />

          {/* Structure waterfall panels */}
          <JDAWaterfallPanel financials={normalizedFinancials} deal={deal} />
          <JVWaterfallPanel financials={normalizedFinancials} deal={deal} />
          <DebtSchedulePanel financials={financials} normalizedFinancials={normalizedFinancials} />

          {/* Signed audit trail — HMAC-SHA256 log of every kernel run with
              verify + kernel-replay primitives. Proves reproducibility of
              the numbers above from first principles. */}
          <AuditTimelineView dealId={dealId} />

          <div className="border-t pt-6" ref={inputsRef}>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Recalculate</h3>
            <InputForm
              initialValues={financials}
              assetClass={activeClass}
              deal={deal}
              onSubmit={handleCalculate}
              isLoading={calculateMutation.isPending}
              prefill={prefill}
              onPrefillConsumed={handlePrefillConsumed}
            />
          </div>
        </>
      )}

      {/* First-time form */}
      {!hasResults && !shouldShowError && (
        <>
          <InputForm
            initialValues={null}
            assetClass={activeClass}
            deal={deal}
            onSubmit={handleCalculate}
            isLoading={calculateMutation.isPending}
            prefill={prefill}
            onPrefillConsumed={handlePrefillConsumed}
          />
          {/* Waterfall panels available even before DCF is run */}
          <JDAWaterfallPanel financials={null} deal={deal} />
          <JVWaterfallPanel financials={null} deal={deal} />
        </>
      )}

      {shouldShowError && !hasResults && (
        <EmptyState
          title="Could not load financials"
          description={error?.message || 'Something went wrong. Please try again.'}
          icon={Calculator}
        />
      )}
    </div>
  );
}
