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
import { useFinancials, useCalculateFinancials, useDefaultsMeta } from '../hooks/useFinancials';
import DefaultFieldBadge from '../components/financials/DefaultFieldBadge';
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
  getFieldDefs,
  getDefaultValues,
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

const normalizeResidentialLoadingFactor = (value, fallback = '0.15') => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  // Legacy residential models stored loading as saleable/gross (~0.60-0.70).
  // Reset those obvious legacy ratios to the new additive input default so
  // reopening an older model does not inflate saleable area on recalculation.
  if (numeric > 0.45) return fallback;

  return String(numeric);
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthsToYears(months) {
  if (months == null) return null;
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / 12) * 100) / 100;
}

function buildInitialInputs(financials, targetClass, deal, prefill) {
  const assetClass = targetClass || financials?.asset_class || 'residential_apartments';
  const defaults = getDefaultValues(assetClass);
  const stored = financials?.model_params?.inputs || {};
  // Only overlay prefill when its recorded asset-class matches the active class —
  // avoids pushing residential unit sizes into a hospitality form, etc.
  const applyPrefill = prefill && (!prefill.__prefilledAssetClass
    || prefill.__prefilledAssetClass === assetClass);

  // Deal provides plot area / land area for pre-population when no financials yet
  const dealLandSqft = deal?.land_area_sqft ?? null;

  // Effective date defaults to stored → deal effective → today
  const effectiveDate =
    stored.effectiveDate
    ?? financials?.effective_date
    ?? deal?.effective_date
    ?? todayIso();

  // Duration: prefer years (new), fall back to converting legacy months
  const storedDurationYears =
    stored.projectDurationYears
    ?? monthsToYears(stored.projectDurationMonths)
    ?? monthsToYears(financials?.project_duration_months);

  if (assetClass === 'residential_apartments' && financials) {
    // Resolve approval cost: prefer stored per-sqft, fall back to legacy Cr field
    const approvalPerSqft = stored.approvalCostPerSqft
      || (financials.approval_cost_cr && financials.gross_area_sqft
          ? Math.round((financials.approval_cost_cr * 1e7) / financials.gross_area_sqft)
          : '') || '';
    const pre = applyPrefill ? prefill : {};
    return {
      effectiveDate,
      plotAreaSqft:            pre.plotAreaSqft ?? financials.plot_area_sqft ?? dealLandSqft ?? '',
      fsi:                     pre.fsi ?? financials.fsi ?? '',
      loadingFactor:           normalizeResidentialLoadingFactor(
        stored.loadingFactor ?? financials.loading_factor,
        defaults.loadingFactor
      ),
      avgUnitSizeSqft:         pre.avgUnitSizeSqft ?? stored.avgUnitSizeSqft ?? financials.avg_unit_size_sqft ?? '',
      constructionCostPerSqft: pre.constructionCostPerSqft ?? financials.construction_cost_per_sqft ?? '',
      sellingRatePerSqft:      financials.selling_rate_per_sqft ?? '',
      landCostCr:              financials.land_cost_cr ?? '',
      approvalCostPerSqft:     approvalPerSqft,
      gstPct:                  stored.gstPct ?? defaults.gstPct,
      marketingCostPct:        financials.marketing_cost_pct ?? defaults.marketingCostPct,
      financeCostPct:          financials.finance_cost_pct ?? defaults.financeCostPct,
      developerMarginPct:      financials.developer_margin_pct ?? defaults.developerMarginPct,
      pricingEscalationPct:    stored.pricingEscalationPct ?? defaults.pricingEscalationPct,
      projectDurationYears:    storedDurationYears ?? defaults.projectDurationYears,
      constructionStartMonths: stored.constructionStartMonths
        ?? (stored.constructionStartYears != null ? Math.round(Number(stored.constructionStartYears) * 12) : null)
        ?? defaults.constructionStartMonths,
      constructionEndMonths:   stored.constructionEndMonths
        ?? (stored.constructionEndYears != null ? Math.round(Number(stored.constructionEndYears) * 12) : null)
        ?? defaults.constructionEndMonths,
      discountRatePct:         financials.discount_rate_pct ?? defaults.discountRatePct,
    };
  }

  // For any class: merge stored inputs with defaults, blank out anything not set
  const fields = getFieldDefs(assetClass);
  const out = { effectiveDate };
  for (const f of fields) {
    // Prefill wins over stored wins over defaults. Prefill is always a string
    // from mapProgrammeToInputs, so treat any non-empty string as a value.
    const prefVal = applyPrefill && prefill[f.name] != null && prefill[f.name] !== ''
      ? prefill[f.name]
      : null;
    let val = prefVal ?? stored[f.name] ?? defaults[f.name] ?? '';
    // Legacy migration: projectDurationYears may only exist as legacy months in stored
    if (!val && f.name === 'projectDurationYears' && storedDurationYears != null) {
      val = storedDurationYears;
    }
    // Pre-populate land area from deal for plot-type fields
    if (!val && f.name === 'plotAreaSqft' && dealLandSqft) val = dealLandSqft;
    if (!val && f.name === 'totalLandSqft' && dealLandSqft) val = dealLandSqft;
    out[f.name] = val;
  }
  return out;
}

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

function InputForm({ initialValues, assetClass, deal, onSubmit, isLoading, prefill, onPrefillConsumed }) {
  const [inputs, setInputs] = useState(() => buildInitialInputs(null, assetClass, deal, prefill));
  const [hintOpen, setHintOpen] = useState(null);
  const modelAssetClass = getModelAssetClass(assetClass);
  const { data: defaultsData } = useDefaultsMeta(modelAssetClass);
  const defaultsMeta = defaultsData?.effective || null;

  useEffect(() => {
    if (initialValues) setInputs(buildInitialInputs(initialValues, assetClass, deal, prefill));
    else setInputs(buildInitialInputs(null, assetClass, deal, prefill));
    if (prefill && typeof onPrefillConsumed === 'function') onPrefillConsumed();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues, assetClass, deal, prefill]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setInputs((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { assetClass };
    const fieldLookup = new Map(getFieldDefs(assetClass).map((field) => [field.name, field]));
    for (const [k, v] of Object.entries(inputs)) {
      if (v === '' || v == null) { data[k] = undefined; continue; }
      // effectiveDate is a date string, not a number
      if (k === 'effectiveDate') { data[k] = String(v); continue; }
      if (fieldLookup.get(k)?.type === 'select') { data[k] = String(v); continue; }
      data[k] = Number(v);
    }
    // Client-side required-field guard per asset class
    const required = {
      residential_apartments: ['plotAreaSqft', 'fsi', 'constructionCostPerSqft', 'sellingRatePerSqft'],
      plotted_development:    ['totalLandSqft', 'sellingRatePerSqft'],
      commercial_office:      ['leasableAreaSqft', 'constructionCostPerSqft', 'baseRentPerSqftMonth'],
      retail:                 ['leasableAreaSqft', 'constructionCostPerSqft', 'baseRentPerSqftMonth'],
      industrial:             ['leasableAreaSqft', 'constructionCostPerSqft', 'baseRentPerSqftMonth'],
      hospitality:            ['keys', 'adr', 'stabilizedOccPct'],
    };
    const missing = (required[getModelAssetClass(assetClass)] || []).filter((f) => !(data[f] > 0));
    if (missing.length) {
      const labels = missing.map((f) => {
        const def = getFieldDefs(assetClass).find((d) => d.name === f);
        return def ? def.label : f;
      });
      toast.error(`Required: ${labels.join(', ')}`);
      return;
    }
    onSubmit(data);
  };

  const fields = getFieldDefs(assetClass).filter(
    (field) => !field.visibleWhen || field.visibleWhen(inputs, assetClass)
  );

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Calculator size={18} className="text-primary-600" />
        Model Inputs
      </h2>
      {modelAssetClass !== assetClass && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          This asset class currently underwrites on the {getFinancialModelLabel(assetClass)} model family.
        </div>
      )}
      <div className="mb-4 bg-primary-50 border border-primary-100 rounded-lg p-3">
        <label htmlFor="effectiveDate" className="text-sm font-medium text-primary-900 block mb-1">
          Effective Date
        </label>
        <input
          id="effectiveDate"
          name="effectiveDate"
          type="date"
          value={inputs.effectiveDate ?? ''}
          onChange={handleChange}
          className="input w-full sm:w-auto"
        />
        <p className="text-xs text-primary-700 mt-1">
          Cash flows, construction milestones, and hold period all anchor on this date.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fields.map((field) => (
          <div key={field.name}>
            <div className="flex items-center justify-between mb-1 gap-1">
              <label htmlFor={field.name} className="text-sm font-medium text-gray-700 flex items-center gap-1.5 min-w-0">
                <span className="truncate">{field.label}</span>
                {defaultsMeta?.[field.name] && (
                  <DefaultFieldBadge
                    meta={defaultsMeta[field.name]}
                    currentValue={inputs[field.name]}
                    size="xs"
                  />
                )}
              </label>
              {field.hint && (
                <button
                  type="button"
                  onClick={() => setHintOpen(hintOpen === field.name ? null : field.name)}
                  className="text-xs text-gray-400 hover:text-primary-600 shrink-0"
                >
                  ?
                </button>
              )}
            </div>
            {hintOpen === field.name && field.hint && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">
                {field.hint}
              </p>
            )}
            {field.type === 'select' ? (
              <select
                id={field.name}
                name={field.name}
                value={inputs[field.name] ?? ''}
                onChange={handleChange}
                className="input w-full"
              >
                {(field.options || []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={field.name}
                name={field.name}
                type={field.type}
                step={field.step}
                min={field.min}
                max={field.max}
                placeholder={field.placeholder}
                value={inputs[field.name] ?? ''}
                onChange={handleChange}
                onWheel={(e) => e.target.blur()}
                className="input w-full"
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <button type="submit" disabled={isLoading} className="btn btn-primary">
          {isLoading ? 'Calculating...' : 'Calculate'}
        </button>
      </div>
    </form>
  );
}

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
