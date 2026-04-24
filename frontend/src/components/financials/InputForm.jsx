// Financials input form — the primary authoring surface for an underwriting
// model. Extracted from FinancialsPage.jsx so form behaviour (required-field
// guards, prefill merging, per-class helpers, default badges) lives in one
// place and can be tested without mounting the whole page.
//
// `buildInitialInputs` and its small helpers (`todayIso`, `monthsToYears`,
// `normalizeResidentialLoadingFactor`) only have one consumer (this form), so
// they ship in the same file. `hasLegacyResidentialLoadingFactor` stays on
// FinancialsPage because the page uses it to drive a banner independent of the
// form.

import { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import DefaultFieldBadge from './DefaultFieldBadge';
import { useDefaultsMeta } from '../../hooks/useFinancials';
import { toast } from '../common/Toast';
import {
  getModelAssetClass,
  getFieldDefs,
  getDefaultValues,
  getFinancialModelLabel,
} from './fieldDefs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeResidentialLoadingFactor(value, fallback = '0.15') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  // Legacy residential models stored loading as saleable/gross (~0.60-0.70).
  // Reset those obvious legacy ratios to the new additive input default so
  // reopening an older model does not inflate saleable area on recalculation.
  if (numeric > 0.45) return fallback;

  return String(numeric);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthsToYears(months) {
  if (months == null) return null;
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / 12) * 100) / 100;
}

export function buildInitialInputs(financials, targetClass, deal, prefill) {
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

// ─── Component ──────────────────────────────────────────────────────────────

export default function InputForm({
  initialValues,
  assetClass,
  deal,
  onSubmit,
  isLoading,
  prefill,
  onPrefillConsumed,
}) {
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
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
      <h2 className="text-base font-semibold text-content-primary mb-4 flex items-center gap-2">
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
              <label htmlFor={field.name} className="text-sm font-medium text-content-secondary flex items-center gap-1.5 min-w-0">
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
                  className="text-xs text-content-muted hover:text-primary-600 shrink-0"
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
