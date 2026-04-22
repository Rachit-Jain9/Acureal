// Per-KPI provenance registry. Each entry explains, in plain investor
// English, how the KPI is computed, what drives it, and how to read the
// value shown on the card. The registry is data-only — no React, no
// browser globals — so it stays trivially testable and serializable.
//
// Convention:
//   - `drivers` are raw-input keys (matching the kernel's input schema);
//     the popover resolves each to a value + source via the defaults
//     registry and the inputs the deal actually carries.
//   - `benchmark` is a short, Bengaluru-grounded band the underwriter
//     should compare against. Leave `null` if not applicable.
//   - `confidence` is the kernel's own read on this number ("High" =
//     deterministic, "Medium" = depends on user-supplied exit cap or
//     terminal value assumption, "Low" = depends on a residualized
//     unknown).
//
// Keep entries terse. The popover has ~320px; anything longer makes the
// investor stop reading.

export const KPI_PROVENANCE = {
  irr: {
    name: 'Internal Rate of Return',
    formula: '0 = \u03A3 CF_t / (1 + IRR)^t',
    definition:
      'The discount rate that sets NPV to zero. Unlevered unless the deal carries explicit debt financing. Numerical root — kernel uses bisection + Newton fallback.',
    drivers: ['projectDurationMonths', 'absorptionMonths', 'sellingRatePerSqft', 'exitCapRate'],
    benchmark: {
      residential: '20–28% for a 3-year Bengaluru residential deal',
      income:      '14–18% for a 5-year income asset hold',
      hospitality: '16–22% for a 7–10-year hospitality hold',
    },
    confidence: 'High',
  },
  npv: {
    name: 'Net Present Value',
    formula: '\u03A3 CF_t / (1 + r)^t',
    definition:
      'Discounted sum of project cash flows at the user\u2019s discount rate. Positive NPV means the deal clears the hurdle; magnitude says by how much.',
    drivers: ['discountRate', 'projectDurationMonths', 'sellingRatePerSqft'],
    benchmark: null,
    confidence: 'High',
  },
  equityMultiple: {
    name: 'Equity Multiple',
    formula: '\u03A3 equity distributions / equity invested',
    definition:
      'Total cash returned to equity per rupee invested. A 2.0\u00d7 doubles your money regardless of time; IRR tells you how fast.',
    drivers: ['equityInvested', 'projectDurationMonths'],
    benchmark: {
      residential: '1.5–1.9\u00d7 typical for merchant-build residential',
      income:      '1.8–2.3\u00d7 typical for 5-year income holds',
    },
    confidence: 'High',
  },
  rlv: {
    name: 'Residual Land Value',
    formula:
      'Revenue − (Construction + Soft Costs + Marketing + Finance + Required Margin)',
    definition:
      'The maximum land price at which the deal still clears the developer\u2019s required margin. Use it to bid land, or to check if the asking land cost leaves any margin.',
    drivers: ['sellingRatePerSqft', 'constructionCostPerSqft', 'financeCostPct', 'marginRequiredPct'],
    benchmark: null,
    confidence: 'High',
  },
  dscr: {
    name: 'Debt Service Coverage Ratio',
    formula: 'Operating Cash Flow / (Interest + Principal)',
    definition:
      'How many times over the asset covers its debt service from operations. Below 1.0\u00d7 = shortfall. Institutional lenders require 1.25–1.40\u00d7.',
    drivers: ['debtLTV', 'debtRatePct', 'vacancyPct', 'baseRentPerSqftMonth'],
    benchmark: {
      income:      '1.30–1.45\u00d7 for stabilized Indian commercial',
      hospitality: '1.35–1.50\u00d7 for stabilized hotel debt',
    },
    confidence: 'Medium',
  },
  revPAR: {
    name: 'Revenue per Available Room',
    formula: 'ADR \u00d7 Occupancy',
    definition:
      'The single most-quoted hotel KPI. Blends price and volume into one number per day per available key.',
    drivers: ['adr', 'stabilizedOccPct'],
    benchmark: {
      hospitality: '₹4,500–₹6,500 for a stabilized Bengaluru 4-star',
    },
    confidence: 'High',
  },
  yieldOnCost: {
    name: 'Yield on Cost',
    formula: 'Stabilized NOI / Total Development Cost',
    definition:
      'The day-one going-in yield delivered on total cost basis. Should exceed the exit cap rate by 50–150bps ("development spread") to justify the build-vs-buy risk.',
    drivers: ['baseRentPerSqftMonth', 'vacancyPct', 'constructionCostPerSqft', 'landCostCr'],
    benchmark: {
      income: '8.0–9.5% for Grade-A office; lower \u2192 margin too thin',
    },
    confidence: 'High',
  },
  noi: {
    name: 'Net Operating Income',
    formula: 'Revenue \u00d7 (1 − Vacancy) − OpEx',
    definition:
      'Recurring cash yield the property produces before debt service and taxes. Core valuation input — exit value = NOI / exit cap rate.',
    drivers: ['baseRentPerSqftMonth', 'leasableAreaSqft', 'vacancyPct', 'opExPerSqftMonth'],
    benchmark: null,
    confidence: 'High',
  },
  exitValue: {
    name: 'Exit Value',
    formula: 'Stabilized NOI / Exit Cap Rate',
    definition:
      'Terminal sale value at exit. Direct-capitalization approach — relies on an exit cap rate you take from the market, not from the kernel.',
    drivers: ['baseRentPerSqftMonth', 'vacancyPct', 'exitCapRate'],
    benchmark: {
      income:      'Exit cap: 7.5–8.5% Grade-A BLR office, 8.5–9.5% retail',
      hospitality: 'Exit cap: 8.0–9.5% for stabilized 4-star hotels',
    },
    confidence: 'Medium',
  },
  entryValue: {
    name: 'Entry Value',
    formula: 'Stabilized NOI_year1 / Entry Cap Rate',
    definition:
      'Acquisition price implied by the stabilized first-year NOI at the user\u2019s entry cap. Useful for acquisition underwriting; for ground-up deals entry = total dev cost.',
    drivers: ['baseRentPerSqftMonth', 'entryCapRate'],
    benchmark: null,
    confidence: 'Medium',
  },
};

export function getKpiMeta(key) {
  return KPI_PROVENANCE[key] || null;
}
