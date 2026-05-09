// Financial model field definitions and defaults — single source of truth for
// the Financials page form. Extracted from FinancialsPage.jsx so that the
// catalog can be reused by other views (e.g. scenario builders) and unit-tested
// independently. Pure data + resolver helpers; no React imports.
//
// Every numeric default here is a *UI seed value*, not an underwriting
// assumption. The authoritative per-class defaults with citations live in
// `packages/financial-kernel/src/config/defaults.ts` and are surfaced through
// `DefaultFieldBadge`. These strings just pre-fill the form when the user has
// not yet typed a value.

import {
  ASSET_CLASS_CONFIG,
  FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS,
  resolveFinancialModelClass,
} from '../../utils/assetClasses';

export const INCOME_CLASSES = new Set([
  'commercial_office',
  'retail',
  'industrial_warehousing',
]);
export const HOSPITALITY_CLASSES = new Set(['hospitality']);

export const EXIT_STRATEGY_OPTIONS = [
  { value: 'cap_rate_sale', label: 'Cap Rate Sale' },
  { value: 'lrd', label: 'LRD' },
  { value: 'forward_purchase', label: 'Forward Purchase' },
];

export const TERMINAL_VALUE_METHOD_OPTIONS = [
  { value: 'exit_cap_rate',     label: 'Exit Cap Rate' },
  { value: 'exit_multiple',     label: 'Exit Multiple (NOI / EBITDA)' },
  { value: 'perpetuity_growth', label: 'Perpetuity Growth (Gordon)' },
  { value: 'forward_purchase',  label: 'Forward Purchase' },
];

export const TERMINAL_VALUE_METHOD_LABELS = {
  exit_cap_rate:     'Exit Cap Rate',
  exit_multiple:     'Exit Multiple',
  perpetuity_growth: 'Perpetuity Growth',
  forward_purchase:  'Forward Purchase',
};

// Terminal-value overlay fields reused for every income / hospitality class.
export const TERMINAL_VALUE_FIELDS = [
  { name: 'terminalValueMethod', label: 'Terminal Value Method',              type: 'select', options: TERMINAL_VALUE_METHOD_OPTIONS, hint: 'DCF terminal value methodology. Cap rate is standard; perpetuity growth or exit multiple can override for specific investor conventions.' },
  { name: 'exitMultiple',        label: 'Exit Multiple (× stabilized NOI)',   type: 'number', step: '0.5',  min: '0', max: '50', placeholder: '12', hint: 'Applied as Stabilized NOI × multiple. Office/Retail: 12–16×; Industrial: 10–14×; Hospitality: 8–11× stabilized EBITDA.', visibleWhen: (inputs) => inputs.terminalValueMethod === 'exit_multiple' },
  { name: 'perpetuityGrowthPct', label: 'Perpetuity Growth (% pa)',           type: 'number', step: '0.25', min: '-10', max: '15', placeholder: '3', hint: 'Gordon growth rate g. Must be less than discount rate. India long-term nominal: 3–6%.', visibleWhen: (inputs) => inputs.terminalValueMethod === 'perpetuity_growth' },
];

export const ASSET_CLASSES = ASSET_CLASS_CONFIG;

// Per-class input field definitions
export const FIELD_DEFS = {
  residential_apartments: [
    { name: 'plotAreaSqft',           label: 'Plot Area (sqft)',               type: 'number', placeholder: '50000' },
    { name: 'fsi',                    label: 'FSI / FAR',                      type: 'number', step: '0.1',  placeholder: '2.5' },
    { name: 'loadingFactor',          label: 'Loading Factor (add-on to gross)', type: 'number', step: '0.01', min: '0', max: '1', placeholder: '0.15', hint: 'Enter 0.15 for 15% loading. Saleable area = Gross built-up area × (1 + loading factor).' },
    { name: 'avgUnitSizeSqft',        label: 'Avg Unit Size (saleable sqft)',  type: 'number', step: '10',   min: '100', placeholder: '1200', hint: 'Optional. Number of units = Saleable area ÷ Avg unit size. Bengaluru 2BHK: 1,000–1,400 sqft; 3BHK: 1,500–2,200 sqft.' },
    { name: 'constructionCostPerSqft',label: 'Construction Cost (₹/sqft)',      type: 'number', placeholder: '4500' },
    { name: 'gstPct',                 label: 'GST on Construction (%)',          type: 'number', step: '0.5',  placeholder: '18', hint: 'GST on construction. Under-construction residential: 1–5% (affordable) or 18% (commercial). Enter as a percentage (e.g. 18 for 18%).' },
    { name: 'sellingRatePerSqft',     label: 'Selling Rate (₹/sqft)',           type: 'number', placeholder: '8000' },
    { name: 'landCostCr',               label: 'Land Cost (₹ Cr)',                  type: 'number', step: '0.01', placeholder: '25' },
    { name: 'approvalCostPerSqft',      label: 'Approval Cost (₹/sqft GFA)',        type: 'number', step: '10',   placeholder: '200', hint: 'BMRDA/BBMP plan sanction, OC, utilities — typically ₹100–500/sqft of gross built-up area' },
    { name: 'marketingCostPct',         label: 'Marketing Cost (% of revenue)',     type: 'number', step: '0.1',  placeholder: '5' },
    { name: 'developerMarginPct',       label: 'Developer Margin (%)',              type: 'number', step: '0.1',  placeholder: '20' },
    { name: 'contingencyPct',            label: 'Contingency (% of construction)',   type: 'number', step: '0.5',  placeholder: '5',  hint: 'Cost overrun buffer. Institutional: 5–8%' },
    { name: 'architectFeePct',           label: 'Architect Fee (% of construction)', type: 'number', step: '0.25', placeholder: '2',  hint: 'Architecture and design fees. Typically 1.5–3%' },
    { name: 'pmcFeePct',                 label: 'PMC Fee (% of construction)',       type: 'number', step: '0.25', placeholder: '1.5', hint: 'Project Management Consultant fee. Typically 1–2%' },
    { name: 'debtLTV',                   label: 'Debt LTV (0–1)',                    type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0',  hint: '0 = all equity, 1 = fully debt-funded. 0.65 = 65% construction finance. Land cost and approvals are typically equity-funded.' },
    { name: 'debtRatePct',               label: 'Debt Rate (% pa)',                  type: 'number', step: '0.25', placeholder: '14', hint: 'Construction finance rate. Typically 12–16% pa. Also drives the unlevered finance carry cost in total project cost.' },
    { name: 'debtTenorYears',            label: 'Loan Term (years)',                 type: 'number', step: '0.25', min: '0.25', max: '15', placeholder: '3', hint: 'Balloon repayment at this point. Typical construction finance: 2–4 years. Leave blank to repay at project end.' },
    { name: 'pricingEscalationPct',      label: 'Pricing Escalation (% pa)',         type: 'number', step: '0.1',  placeholder: '0', hint: 'Expected annual price appreciation during project' },
    { name: 'projectDurationYears',      label: 'Project Duration (years)',          type: 'number', step: '0.25', min: '1', max: '15', placeholder: '3', hint: 'Total project length from effective date to final collection. Cash flows anchor on the effective date above.' },
    { name: 'constructionStartMonths',   label: 'Construction Start (months)',       type: 'number', step: '1', min: '0', max: '180', placeholder: '3', hint: 'Months from effective date when construction begins (after approvals). Typical: 3–6 months.' },
    { name: 'constructionEndMonths',     label: 'Construction End (months)',         type: 'number', step: '1', min: '1', max: '180', placeholder: '30', hint: 'Months from effective date when structure is complete. Typical Bengaluru apartment: 24–36 months.' },
    { name: 'discountRatePct',           label: 'Discount Rate (%)',                 type: 'number', step: '0.1',  placeholder: '14' },
  ],
  plotted_development: [
    { name: 'totalLandSqft',          label: 'Total Land Area (sqft)',          type: 'number', placeholder: '435600', hint: '1 acre = 43,560 sqft' },
    { name: 'saleableLandPct',        label: 'Saleable Land (%)',               type: 'number', step: '1',    placeholder: '55', hint: 'After roads, parks & amenities (typically 50–60%)' },
    { name: 'avgPlotSizeSqft',        label: 'Avg Plot Size (sqft)',            type: 'number', placeholder: '1200', hint: '1200 sqft = ~133 sqyd' },
    { name: 'sellingRatePerSqft',      label: 'Selling Rate (₹/sqft)',           type: 'number', placeholder: '1350', hint: '₹1,350/sqft ≈ ₹12,150/sqyd. Convert: ÷ 9 to get sqft rate' },
    { name: 'landCostCr',             label: 'Land Cost (₹ Cr)',                type: 'number', step: '0.01', placeholder: '20' },
    { name: 'devCostPerSqft',         label: 'Development Cost (₹/sqft land)', type: 'number', placeholder: '250', hint: 'Roads, utilities, landscaping on total land area' },
    { name: 'gstPct',                 label: 'GST on Dev. Works (%)',           type: 'number', step: '0.5',  placeholder: '12', hint: 'GST on civil/infrastructure development works. Typically 12% for plotted layouts. Enter as a percentage (e.g. 12 for 12%).' },
    { name: 'approvalCostPerSqft',    label: 'Approval Cost (₹/sqft land)',     type: 'number', step: '5',    placeholder: '80', hint: 'BMRDA layout approval, DTCP sanction — typically ₹50–200/sqft of total land' },
    { name: 'marketingCostPct',       label: 'Marketing Cost (% of revenue)',   type: 'number', step: '0.1',  placeholder: '4' },
    { name: 'debtLTV',                label: 'Debt LTV / LTC (0–1)',            type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0', hint: '0 = all equity, 1 = fully debt-funded. Plotted layouts typically 0.40–0.55 (lower than apartments because upfront land dominates).' },
    { name: 'debtRatePct',            label: 'Debt Rate (% pa)',                type: 'number', step: '0.25', placeholder: '13', hint: 'Layout development finance / NBFC rate. Typically 12–15% pa.' },
    { name: 'debtTenorYears',         label: 'Loan Term (years)',               type: 'number', step: '0.25', min: '0.25', max: '10', placeholder: '2', hint: 'Balloon repayment at this point. Plotted layouts: typically 1.5–3 years. Leave blank to repay at project end.' },
    { name: 'projectDurationYears',   label: 'Project Duration (years)',        type: 'number', step: '0.25', min: '1', max: '15', placeholder: '2' },
    { name: 'discountRatePct',        label: 'Discount Rate (%)',               type: 'number', step: '0.1',  placeholder: '14' },
  ],
  commercial_office: [
    { name: 'leasableAreaSqft',       label: 'Leasable Area (sqft)',            type: 'number', placeholder: '100000' },
    { name: 'constructionCostPerSqft',label: 'Construction Cost (₹/sqft)',      type: 'number', placeholder: '6000', hint: 'Grade A office: ₹5,000–8,000/sqft' },
    { name: 'gstPct',                 label: 'GST on Construction (%)',          type: 'number', step: '0.5',  placeholder: '18', hint: 'GST on construction. Commercial: typically 18%. Enter as a percentage (e.g. 18 for 18%).' },
    { name: 'landCostCr',             label: 'Land Cost (₹ Cr)',                type: 'number', step: '0.01', placeholder: '40' },
    { name: 'approvalCostPerSqft',    label: 'Approval Cost (₹/sqft leasable)', type: 'number', step: '10',   placeholder: '150', hint: 'Plan sanction, OC, fire NOC, utilities — typically ₹100–500/sqft of leasable area' },
    { name: 'baseRentPerSqftMonth',   label: 'Base Rent (₹/sqft/month)',        type: 'number', placeholder: '85', hint: 'Bengaluru Grade A: ₹70–120/sqft/month' },
    { name: 'rentEscalationPct',      label: 'Rent Escalation (% pa)',          type: 'number', step: '0.5',  placeholder: '5' },
    { name: 'vacancyPct',             label: 'Vacancy (%)',                     type: 'number', step: '1',    placeholder: '10' },
    { name: 'opexPct',                label: 'Operating Expenses (% of EGR)',   type: 'number', step: '1',    placeholder: '20', hint: 'Property management, maintenance, insurance' },
    { name: 'tiPerSqft',              label: 'Tenant Improvements (₹/sqft)',    type: 'number', placeholder: '500', hint: 'Fit-out contribution to tenant' },
    { name: 'lcMonths',               label: 'Leasing Commissions (months)',    type: 'number', step: '0.5',  placeholder: '2', hint: 'Months of base rent paid to broker' },
    { name: 'entryCapRate',           label: 'Entry Cap Rate (%)',              type: 'number', step: '0.25', placeholder: '7', hint: 'Prime Bengaluru office: 6.5–8%' },
    { name: 'exitCapRate',            label: 'Exit Cap Rate (%)',               type: 'number', step: '0.25', placeholder: '7.5', hint: 'Typically 25–50 bps wider than entry' },
    ...TERMINAL_VALUE_FIELDS,
    { name: 'exitStrategy',           label: 'Exit Strategy',                   type: 'select', options: EXIT_STRATEGY_OPTIONS, hint: 'Choose the monetization path for the stabilized income asset.' },
    { name: 'lrdLTV',                 label: 'LRD LTV (0–1)',                   type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0.65', hint: 'Refinance sizing against entry value when the asset is stabilized.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'lrdInterestRatePct',     label: 'LRD Rate (% pa)',                 type: 'number', step: '0.25', min: '0', max: '50', placeholder: '9', hint: 'Coupon / all-in cost on the refinance facility.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'lrdRefinanceYear',       label: 'LRD Refinance Year',              type: 'number', step: '1', min: '1', max: '20', placeholder: '2', hint: 'Year of the hold period when refinance proceeds arrive.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'forwardPurchasePriceCr', label: 'Forward Purchase Price (₹ Cr)',   type: 'number', step: '0.01', min: '0', placeholder: '180', hint: 'Contracted forward-purchase consideration if agreed.', visibleWhen: (inputs) => inputs.exitStrategy === 'forward_purchase' },
    { name: 'holdPeriodYears',        label: 'Hold Period (years)',             type: 'number', step: '1',    placeholder: '5' },
    { name: 'projectDurationYears',   label: 'Construction Duration (years)',   type: 'number', step: '0.25', min: '1', max: '15', placeholder: '3' },
    { name: 'debtCoverage',           label: 'Debt LTV / LTC (0–1)',            type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0.65' },
    { name: 'interestRatePct',        label: 'Interest Rate (% pa)',            type: 'number', step: '0.25', placeholder: '10' },
    { name: 'discountRatePct',        label: 'Discount Rate (%)',               type: 'number', step: '0.1',  placeholder: '14' },
  ],
  retail: [
    { name: 'leasableAreaSqft',       label: 'Leasable Area (sqft)',            type: 'number', placeholder: '80000' },
    { name: 'constructionCostPerSqft',label: 'Construction Cost (₹/sqft)',      type: 'number', placeholder: '5500', hint: 'Retail mall: ₹4,500–7,000/sqft' },
    { name: 'gstPct',                 label: 'GST on Construction (%)',          type: 'number', step: '0.5',  placeholder: '18', hint: 'GST on construction. Commercial: typically 18%. Enter as a percentage (e.g. 18 for 18%).' },
    { name: 'landCostCr',             label: 'Land Cost (₹ Cr)',                type: 'number', step: '0.01', placeholder: '30' },
    { name: 'approvalCostPerSqft',    label: 'Approval Cost (₹/sqft leasable)', type: 'number', step: '10',   placeholder: '150', hint: 'Plan sanction, fire NOC, OC, utilities — typically ₹100–500/sqft of leasable area' },
    { name: 'baseRentPerSqftMonth',   label: 'Inline Tenant Rent (₹/sqft/mo)', type: 'number', placeholder: '120', hint: 'Non-anchor inline stores' },
    { name: 'anchorPct',              label: 'Anchor Tenant Area (%)',          type: 'number', step: '5',    placeholder: '40', hint: 'Anchor tenants get lower rent (typically 30–50% of area)' },
    { name: 'anchorRentDiscount',     label: 'Anchor Rent Discount (%)',        type: 'number', step: '5',    placeholder: '20', hint: 'Discount applied to anchor tenant rent vs inline rate' },
    { name: 'rentEscalationPct',      label: 'Rent Escalation (% pa)',          type: 'number', step: '0.5',  placeholder: '5' },
    { name: 'vacancyPct',             label: 'Vacancy (%)',                     type: 'number', step: '1',    placeholder: '12' },
    { name: 'opexPct',                label: 'Operating Expenses (% of EGR)',   type: 'number', step: '1',    placeholder: '22' },
    { name: 'tiPerSqft',              label: 'Tenant Improvements (₹/sqft)',    type: 'number', placeholder: '800' },
    { name: 'lcMonths',               label: 'Leasing Commissions (months)',    type: 'number', step: '0.5',  placeholder: '2' },
    { name: 'exitCapRate',            label: 'Exit Cap Rate (%)',               type: 'number', step: '0.25', placeholder: '8', hint: 'Retail: 7.5–9%' },
    ...TERMINAL_VALUE_FIELDS,
    { name: 'exitStrategy',           label: 'Exit Strategy',                   type: 'select', options: EXIT_STRATEGY_OPTIONS, hint: 'Choose the monetization path for the stabilized income asset.' },
    { name: 'lrdLTV',                 label: 'LRD LTV (0–1)',                   type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0.60', hint: 'Refinance sizing against entry value when the asset is stabilized.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'lrdInterestRatePct',     label: 'LRD Rate (% pa)',                 type: 'number', step: '0.25', min: '0', max: '50', placeholder: '9', hint: 'Coupon / all-in cost on the refinance facility.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'lrdRefinanceYear',       label: 'LRD Refinance Year',              type: 'number', step: '1', min: '1', max: '20', placeholder: '3', hint: 'Year of the hold period when refinance proceeds arrive.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'forwardPurchasePriceCr', label: 'Forward Purchase Price (₹ Cr)',   type: 'number', step: '0.01', min: '0', placeholder: '160', hint: 'Contracted forward-purchase consideration if agreed.', visibleWhen: (inputs) => inputs.exitStrategy === 'forward_purchase' },
    { name: 'holdPeriodYears',        label: 'Hold Period (years)',             type: 'number', step: '1',    placeholder: '7' },
    { name: 'projectDurationYears',   label: 'Construction Duration (years)',   type: 'number', step: '0.25', min: '1', max: '15', placeholder: '3' },
    { name: 'debtCoverage',           label: 'Debt LTV / LTC (0–1)',            type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0.60' },
    { name: 'interestRatePct',        label: 'Interest Rate (% pa)',            type: 'number', step: '0.25', placeholder: '10.5' },
    { name: 'discountRatePct',        label: 'Discount Rate (%)',               type: 'number', step: '0.1',  placeholder: '15' },
  ],
  industrial_warehousing: [
    { name: 'leasableAreaSqft',       label: 'Industrial Floor Area (sqft)',    type: 'number', placeholder: '200000' },
    { name: 'constructionCostPerSqft',label: 'Construction Cost (₹/sqft)',      type: 'number', placeholder: '1800', hint: 'Industrial shed/warehouse: ₹1,200–2,500/sqft' },
    { name: 'gstPct',                 label: 'GST on Construction (%)',          type: 'number', step: '0.5',  placeholder: '18', hint: 'GST on construction. Industrial: typically 18%. Enter as a percentage (e.g. 18 for 18%).' },
    { name: 'landCostCr',             label: 'Land Cost (₹ Cr)',                type: 'number', step: '0.01', placeholder: '25' },
    { name: 'approvalCostPerSqft',    label: 'Approval Cost (₹/sqft GFA)',      type: 'number', step: '5',    placeholder: '75', hint: 'Layout approval, utilities, fire NOC — typically ₹30–150/sqft of industrial floor area' },
    { name: 'baseRentPerSqftMonth',   label: 'Base Rent (₹/sqft/month)',        type: 'number', placeholder: '28', hint: 'Bengaluru industrial: ₹18–40/sqft/month' },
    { name: 'rentEscalationPct',      label: 'Rent Escalation (% pa)',          type: 'number', step: '0.5',  placeholder: '4', hint: 'Industrial leases: typically 3-5% pa or 15% every 3 years' },
    { name: 'vacancyPct',             label: 'Vacancy (%)',                     type: 'number', step: '1',    placeholder: '7', hint: 'Industrial: typically 5–10% in strong markets' },
    { name: 'opexPct',                label: 'Operating Expenses (% of EGR)',   type: 'number', step: '1',    placeholder: '15', hint: 'Industrial is lower opex than office' },
    { name: 'exitCapRate',            label: 'Exit Cap Rate (%)',               type: 'number', step: '0.25', placeholder: '8.5', hint: 'Warehousing/logistics: 7.5–9.5%' },
    ...TERMINAL_VALUE_FIELDS,
    { name: 'exitStrategy',           label: 'Exit Strategy',                   type: 'select', options: EXIT_STRATEGY_OPTIONS, hint: 'Choose the monetization path for the stabilized income asset.' },
    { name: 'lrdLTV',                 label: 'LRD LTV (0–1)',                   type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0.65', hint: 'Refinance sizing against entry value when the asset is stabilized.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'lrdInterestRatePct',     label: 'LRD Rate (% pa)',                 type: 'number', step: '0.25', min: '0', max: '50', placeholder: '9', hint: 'Coupon / all-in cost on the refinance facility.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'lrdRefinanceYear',       label: 'LRD Refinance Year',              type: 'number', step: '1', min: '1', max: '20', placeholder: '3', hint: 'Year of the hold period when refinance proceeds arrive.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'forwardPurchasePriceCr', label: 'Forward Purchase Price (₹ Cr)',   type: 'number', step: '0.01', min: '0', placeholder: '140', hint: 'Contracted forward-purchase consideration if agreed.', visibleWhen: (inputs) => inputs.exitStrategy === 'forward_purchase' },
    { name: 'holdPeriodYears',        label: 'Hold Period (years)',             type: 'number', step: '1',    placeholder: '7' },
    { name: 'projectDurationYears',   label: 'Construction Duration (years)',   type: 'number', step: '0.25', min: '1', max: '15', placeholder: '1.5' },
    { name: 'debtCoverage',           label: 'Debt LTV / LTC (0–1)',            type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0.65' },
    { name: 'interestRatePct',        label: 'Interest Rate (% pa)',            type: 'number', step: '0.25', placeholder: '10' },
    { name: 'discountRatePct',        label: 'Discount Rate (%)',               type: 'number', step: '0.1',  placeholder: '13' },
  ],
  hospitality: [
    { name: 'keys',                    label: 'Number of Keys (rooms)',               type: 'number', placeholder: '100' },
    { name: 'constructionCostPerKey',  label: 'Construction Cost (₹/key)',            type: 'number', placeholder: '8000000', hint: 'All-in cost per key incl. FF&E. Budget: ₹50L–1.5Cr/key' },
    { name: 'preOpeningCostPerKey',    label: 'Pre-Opening Cost (₹/key)',             type: 'number', placeholder: '300000',  hint: 'Staff training, launch marketing, consumables. Typically ₹2–5L/key' },
    { name: 'landCostCr',              label: 'Land Cost (₹ Cr)',                     type: 'number', step: '0.01', placeholder: '20' },
    { name: 'approvalCostPerSqft',     label: 'Approval Cost (₹/sqft GFA)',           type: 'number', step: '10',   placeholder: '150', hint: 'Plan sanctions, fire NOC, FSSAI, utilities — applied to est. GFA (keys × ~600 sqft). Typically ₹100–400/sqft.' },
    { name: 'gstPct',                  label: 'GST on Construction (%)',              type: 'number', step: '0.5',  placeholder: '18', hint: 'GST on construction cost. Typically 18%. Enter as a percentage (e.g. 18 for 18%).' },
    { name: 'adr',                     label: 'Average Daily Rate (₹/night)',         type: 'number', placeholder: '6000', hint: 'Stabilized ADR. Bengaluru mid-scale: ₹4k–8k; luxury: ₹10k–25k' },
    { name: 'stabilizedOccPct',        label: 'Stabilized Occupancy (%)',             type: 'number', step: '1',    placeholder: '65', hint: 'Y3+ occupancy. Bengaluru hotels: 60–75% stabilized' },
    { name: 'adrGrowthPct',            label: 'ADR Growth (% pa)',                    type: 'number', step: '0.5',  placeholder: '5' },
    { name: 'fbRevPct',                label: 'F&B Revenue (% of rooms rev)',         type: 'number', step: '1',    placeholder: '25', hint: 'Full service: 25–40%; limited service: 10–15%' },
    { name: 'otherRevPct',             label: 'Other Revenue (% of rooms rev)',       type: 'number', step: '1',    placeholder: '10', hint: 'Spa, events, parking, laundry' },
    { name: 'gopMarginPct',            label: 'GOP Margin (% of total revenue)',      type: 'number', step: '1',    placeholder: '35', hint: 'Gross Operating Profit. India branded hotels: 30–45%' },
    { name: 'ebitdaMarginPct',         label: 'EBITDA Margin (% of total revenue)',   type: 'number', step: '1',    placeholder: '28', hint: 'After management fee & reserve. India hotels: 22–32%' },
    { name: 'exitCapRate',             label: 'Exit Cap Rate (%)',                    type: 'number', step: '0.25', placeholder: '9',  hint: 'Hotel exit caps India: 8–11%' },
    ...TERMINAL_VALUE_FIELDS,
    { name: 'exitStrategy',            label: 'Exit Strategy',                         type: 'select', options: EXIT_STRATEGY_OPTIONS, hint: 'Choose the monetization path for the stabilized operating asset.' },
    { name: 'lrdLTV',                  label: 'Operating Refi LTV (0–1)',              type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0.55', hint: 'Refinance sizing against stabilized entry value during hold.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'lrdInterestRatePct',      label: 'Operating Refi Rate (% pa)',            type: 'number', step: '0.25', min: '0', max: '50', placeholder: '9.5', hint: 'Coupon / all-in cost on the operating refinance facility.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'lrdRefinanceYear',        label: 'Operating Refi Year',                   type: 'number', step: '1', min: '1', max: '20', placeholder: '3', hint: 'Year of the hold period when refinance proceeds arrive.', visibleWhen: (inputs) => inputs.exitStrategy === 'lrd' },
    { name: 'forwardPurchasePriceCr',  label: 'Forward Purchase Price (₹ Cr)',         type: 'number', step: '0.01', min: '0', placeholder: '220', hint: 'Contracted forward-purchase consideration if agreed.', visibleWhen: (inputs) => inputs.exitStrategy === 'forward_purchase' },
    { name: 'holdPeriodYears',         label: 'Hold Period (years)',                  type: 'number', step: '1',    placeholder: '8' },
    { name: 'projectDurationYears',    label: 'Construction Duration (years)',        type: 'number', step: '0.25', min: '1', max: '15', placeholder: '2.5', hint: 'Typical hotel construction: 2–3 years' },
    { name: 'debtCoverage',            label: 'Debt LTV / LTC (0–1)',                 type: 'number', step: '0.05', min: '0', max: '1', placeholder: '0.55' },
    { name: 'interestRatePct',         label: 'Interest Rate (% pa)',                 type: 'number', step: '0.25', placeholder: '10.5' },
    { name: 'contingencyPct',          label: 'Contingency (% of construction)',      type: 'number', step: '1',    placeholder: '5' },
    { name: 'discountRatePct',         label: 'Discount Rate (%)',                    type: 'number', step: '0.1',  placeholder: '15' },
  ],
};

FIELD_DEFS.villas = FIELD_DEFS.residential_apartments.map((field) => (
  field.name === 'loadingFactor'
    ? { ...field, placeholder: '0.05', hint: 'Villa projects typically carry less saleable loading than apartment projects.' }
    : field
));

FIELD_DEFS.mixed_use = FIELD_DEFS.residential_apartments.map((field) => (
  field.name === 'constructionCostPerSqft'
    ? { ...field, label: 'Blended Construction Cost (INR/sqft)' }
    : field.name === 'sellingRatePerSqft'
    ? { ...field, label: 'Blended Sale Rate (INR/sqft)' }
    : field
));

FIELD_DEFS.redevelopment = [
  ...FIELD_DEFS.residential_apartments,
  { name: 'rehousingCostCr', label: 'Rehousing / Corpus Cost (INR Cr)', type: 'number', step: '0.01', placeholder: '8', hint: 'Temporary accommodation, corpus, or rehousing carry for existing occupants where applicable.' },
];

export const DEFAULT_VALUES = {
  residential_apartments: {
    loadingFactor: '0.15', marketingCostPct: '5', financeCostPct: '12',
    developerMarginPct: '20', pricingEscalationPct: '0',
    contingencyPct: '5', architectFeePct: '2', pmcFeePct: '1.5',
    debtLTV: '0', debtRatePct: '14',
    projectDurationYears: '3', discountRatePct: '14',
    constructionStartMonths: '3', constructionEndMonths: '30',
    gstPct: '18',
  },
  villas: {
    loadingFactor: '0.05', marketingCostPct: '4', financeCostPct: '12',
    developerMarginPct: '20', pricingEscalationPct: '0',
    contingencyPct: '5', architectFeePct: '2', pmcFeePct: '1.5',
    debtLTV: '0', debtRatePct: '14',
    projectDurationYears: '2.5', discountRatePct: '14',
    constructionStartMonths: '3', constructionEndMonths: '24',
    gstPct: '18',
  },
  mixed_use: {
    loadingFactor: '0.12', marketingCostPct: '5', financeCostPct: '12',
    developerMarginPct: '20', pricingEscalationPct: '0',
    contingencyPct: '6', architectFeePct: '2', pmcFeePct: '1.5',
    debtLTV: '0', debtRatePct: '14',
    projectDurationYears: '3.5', discountRatePct: '15',
    constructionStartMonths: '3', constructionEndMonths: '36',
    gstPct: '18',
  },
  redevelopment: {
    loadingFactor: '0.12', marketingCostPct: '5', financeCostPct: '12',
    developerMarginPct: '20', pricingEscalationPct: '0',
    contingencyPct: '7', architectFeePct: '2', pmcFeePct: '1.5',
    debtLTV: '0', debtRatePct: '14',
    projectDurationYears: '4', discountRatePct: '16',
    constructionStartMonths: '6', constructionEndMonths: '42',
    gstPct: '18',
  },
  plotted_development: {
    saleableLandPct: '55', avgPlotSizeSqft: '1200', devCostPerSqft: '250',
    marketingCostPct: '4', financeCostPct: '12',
    projectDurationYears: '2', discountRatePct: '14',
    gstPct: '12',
  },
  commercial_office: {
    rentEscalationPct: '5', vacancyPct: '10', opexPct: '20',
    tiPerSqft: '500', lcMonths: '2',
    entryCapRate: '7', exitCapRate: '7.5', exitStrategy: 'cap_rate_sale', lrdLTV: '0.65', lrdInterestRatePct: '9', lrdRefinanceYear: '2', holdPeriodYears: '5',
    terminalValueMethod: 'exit_cap_rate', exitMultiple: '14', perpetuityGrowthPct: '3',
    projectDurationYears: '3', debtCoverage: '0.65', interestRatePct: '10', discountRatePct: '14',
    gstPct: '18',
  },
  retail: {
    anchorPct: '40', anchorRentDiscount: '20',
    rentEscalationPct: '5', vacancyPct: '12', opexPct: '22',
    tiPerSqft: '800', lcMonths: '2',
    exitCapRate: '8', exitStrategy: 'cap_rate_sale', lrdLTV: '0.60', lrdInterestRatePct: '9', lrdRefinanceYear: '3', holdPeriodYears: '7',
    terminalValueMethod: 'exit_cap_rate', exitMultiple: '12', perpetuityGrowthPct: '3',
    projectDurationYears: '3', debtCoverage: '0.60', interestRatePct: '10.5', discountRatePct: '15',
    gstPct: '18',
  },
  industrial_warehousing: {
    rentEscalationPct: '4', vacancyPct: '7', opexPct: '15',
    exitCapRate: '8.5', exitStrategy: 'cap_rate_sale', lrdLTV: '0.65', lrdInterestRatePct: '9', lrdRefinanceYear: '3', holdPeriodYears: '7',
    terminalValueMethod: 'exit_cap_rate', exitMultiple: '11', perpetuityGrowthPct: '2.5',
    projectDurationYears: '1.5', debtCoverage: '0.65', interestRatePct: '10', discountRatePct: '13',
    gstPct: '18',
  },
  hospitality: {
    stabilizedOccPct: '65', adrGrowthPct: '5', fbRevPct: '25', otherRevPct: '10',
    gopMarginPct: '35', ebitdaMarginPct: '28', exitCapRate: '9', exitStrategy: 'cap_rate_sale', lrdLTV: '0.55', lrdInterestRatePct: '9.5', lrdRefinanceYear: '3',
    terminalValueMethod: 'exit_cap_rate', exitMultiple: '9', perpetuityGrowthPct: '3',
    holdPeriodYears: '8', projectDurationYears: '2.5',
    debtCoverage: '0.55', interestRatePct: '10.5', contingencyPct: '5', discountRatePct: '15',
    gstPct: '18',
  },
};

// ─── RESOLVERS ─────────────────────────────────────────────────────────────

export const getModelAssetClass = (assetClass) => resolveFinancialModelClass(assetClass);
export const getFieldDefs = (assetClass) => FIELD_DEFS[getModelAssetClass(assetClass)] || [];
export const getDefaultValues = (assetClass) => DEFAULT_VALUES[getModelAssetClass(assetClass)] || {};
export const getFinancialModelLabel = (assetClass) =>
  FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS[assetClass]
  || FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS[getModelAssetClass(assetClass)]
  || 'Residential Apartments';
