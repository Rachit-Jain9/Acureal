import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Calculator, TrendingUp, DollarSign, BarChart3,
  Grid3X3, IndianRupee, Percent, Building2, ChevronDown,
  GitFork, Users, Layers, ChevronRight,
} from 'lucide-react';
import { calculateJDAWaterfall, calculateJVWaterfall, buildDebtSchedule } from '../utils/waterfall';
import MethodologyExplorer from '../components/financials/MethodologyExplorer';
import AssetClassInsightBanner from '../components/financials/AssetClassInsightBanner';
import FinancialVisualizationLayer from '../components/financials/FinancialVisualizationLayer';
import HospitalityProformaSection from '../components/financials/HospitalityProformaSection';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { useFinancials, useCalculateFinancials } from '../hooks/useFinancials';
import { useDeal } from '../hooks/useDeals';
import { readPrefill, clearPrefill } from '../utils/programmeToInputs';
import { toast } from '../components/common/Toast';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import StatCard from '../components/common/StatCard';
import { formatCrores, formatPct, formatINR, formatArea } from '../utils/format';
import {
  ASSET_CLASS_CONFIG,
  FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS,
  resolveFinancialModelClass,
} from '../utils/assetClasses';

// ─── ASSET CLASS CONFIG ────────────────────────────────────────────────────

const INCOME_CLASSES     = new Set(['commercial_office', 'retail', 'industrial_warehousing']);
const HOSPITALITY_CLASSES = new Set(['hospitality']);
const EXIT_STRATEGY_OPTIONS = [
  { value: 'cap_rate_sale', label: 'Cap Rate Sale' },
  { value: 'lrd', label: 'LRD' },
  { value: 'forward_purchase', label: 'Forward Purchase' },
];

const TERMINAL_VALUE_METHOD_OPTIONS = [
  { value: 'exit_cap_rate',     label: 'Exit Cap Rate' },
  { value: 'exit_multiple',     label: 'Exit Multiple (NOI / EBITDA)' },
  { value: 'perpetuity_growth', label: 'Perpetuity Growth (Gordon)' },
  { value: 'forward_purchase',  label: 'Forward Purchase' },
];

const TERMINAL_VALUE_METHOD_LABELS = {
  exit_cap_rate:     'Exit Cap Rate',
  exit_multiple:     'Exit Multiple',
  perpetuity_growth: 'Perpetuity Growth',
  forward_purchase:  'Forward Purchase',
};

// Terminal-value overlay fields reused for every income / hospitality class.
const TERMINAL_VALUE_FIELDS = [
  { name: 'terminalValueMethod', label: 'Terminal Value Method',              type: 'select', options: TERMINAL_VALUE_METHOD_OPTIONS, hint: 'DCF terminal value methodology. Cap rate is standard; perpetuity growth or exit multiple can override for specific investor conventions.' },
  { name: 'exitMultiple',        label: 'Exit Multiple (× stabilized NOI)',   type: 'number', step: '0.5',  min: '0', max: '50', placeholder: '12', hint: 'Applied as Stabilized NOI × multiple. Office/Retail: 12–16×; Industrial: 10–14×; Hospitality: 8–11× stabilized EBITDA.', visibleWhen: (inputs) => inputs.terminalValueMethod === 'exit_multiple' },
  { name: 'perpetuityGrowthPct', label: 'Perpetuity Growth (% pa)',           type: 'number', step: '0.25', min: '-10', max: '15', placeholder: '3', hint: 'Gordon growth rate g. Must be less than discount rate. India long-term nominal: 3–6%.', visibleWhen: (inputs) => inputs.terminalValueMethod === 'perpetuity_growth' },
];
const ASSET_CLASSES = ASSET_CLASS_CONFIG;

// Per-class input field definitions
const FIELD_DEFS = {
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

const DEFAULT_VALUES = {
  residential_apartments: {
    loadingFactor: '0.15', marketingCostPct: '5', financeCostPct: '12',
    developerMarginPct: '20', pricingEscalationPct: '0',
    contingencyPct: '5', architectFeePct: '2', pmcFeePct: '1.5',
    debtLTV: '0', debtRatePct: '14',
    projectDurationYears: '3', discountRatePct: '14',
    constructionStartMonths: '3', constructionEndMonths: '30',
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

const getModelAssetClass = (assetClass) => resolveFinancialModelClass(assetClass);
const getFieldDefs = (assetClass) => FIELD_DEFS[getModelAssetClass(assetClass)] || [];
const getDefaultValues = (assetClass) => DEFAULT_VALUES[getModelAssetClass(assetClass)] || {};
const getFinancialModelLabel = (assetClass) =>
  FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS[assetClass] || 'Residential Apartments';

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
    },
    // Preserve extended hospitality payloads
    costsRaw: costs,
    capitalStack: mp.capitalStack || null,
    sourcesUses: costs.sources_uses || null,
    cashFlows: cashFlowSeries.map((cf, i) => ({ quarter: cf.quarter ?? i, value: toNumber(cf.net) ?? 0 })),
    yearlyCashFlows: (financials.cash_flows?.yearly || []).map((cf) => ({ year: cf.year, label: cf.label, value: toNumber(cf.net) ?? 0 })),
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
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={field.name} className="text-sm font-medium text-gray-700">
                {field.label}
              </label>
              {field.hint && (
                <button
                  type="button"
                  onClick={() => setHintOpen(hintOpen === field.name ? null : field.name)}
                  className="text-xs text-gray-400 hover:text-primary-600"
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

function KPICards({ kpis, assetClass }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const isIncome = INCOME_CLASSES.has(modelAssetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(modelAssetClass);

  if (isHospitality) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="RevPAR" value={kpis.revPAR != null ? formatINR(kpis.revPAR, 0) : '-'} subtitle="₹/key/night (stabilized)" icon={IndianRupee} />
        <StatCard title="EBITDA" value={formatCrores(kpis.noi)} subtitle="Stabilized EBITDA / yr" icon={TrendingUp} />
        <StatCard title="IRR" value={formatPct(kpis.irr)} subtitle="Unlevered, through exit" icon={Percent} />
        <StatCard title="Exit Value" value={formatCrores(kpis.exitValue)} subtitle="EBITDA / exit cap rate" icon={DollarSign} />
      </div>
    );
  }

  if (isIncome) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Stabilized NOI" value={formatCrores(kpis.noi)} subtitle="Net Operating Income / yr" icon={IndianRupee} />
        <StatCard title="Yield on Cost" value={kpis.yieldOnCost != null ? `${kpis.yieldOnCost.toFixed(2)}%` : '-'} subtitle="NOI / Total Dev. Cost" icon={Percent} />
        <StatCard title="IRR" value={formatPct(kpis.irr)} subtitle="Unlevered, through exit" icon={TrendingUp} />
        <StatCard title="Exit Value" value={formatCrores(kpis.exitValue)} subtitle="At exit cap rate" icon={DollarSign} />
      </div>
    );
  }

  const hasDscr = kpis.dscr != null;
  return (
    <div className={`grid grid-cols-2 ${hasDscr ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
      <StatCard title="IRR" value={formatPct(kpis.irr)} subtitle="Internal Rate of Return" icon={TrendingUp} />
      <StatCard title="NPV" value={formatCrores(kpis.npv)} subtitle="Net Present Value" icon={IndianRupee} />
      <StatCard
        title="Equity Multiple"
        value={kpis.equityMultiple != null ? `${kpis.equityMultiple.toFixed(2)}x` : '-'}
        subtitle="Return on equity invested"
        icon={DollarSign}
      />
      <StatCard
        title="RLV"
        value={formatCrores(kpis.rlv)}
        subtitle="Residual Land Value"
        icon={Percent}
      />
      {hasDscr && (
        <StatCard
          title="DSCR"
          value={`${kpis.dscr.toFixed(2)}x`}
          subtitle="Revenue / total debt service"
          icon={Percent}
        />
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

// ─── JDA WATERFALL PANEL ──────────────────────────────────────────────────

const JDA_STRUCTURE_LABELS = {
  area_share: 'Area Share',
  revenue_share: 'Revenue Share',
};

function JDAWaterfallPanel({ financials, deal }) {
  const mp = financials;
  const [open, setOpen] = useState(
    deal?.deal_structure === 'jda' ||
    deal?.deal_structure === 'area_share' ||
    deal?.deal_structure === 'revenue_share'
  );

  const [inputs, setInputs] = useState(() => ({
    landownerSharePct: 40,
    structureType: deal?.deal_structure === 'revenue_share' ? 'revenue_share' : 'area_share',
    totalRevenueCr: mp?.revenue?.totalRevenue ?? '',
    totalConstructionCostCr: mp?.costs?.construction ?? '',
    approvalCostCr: mp?.costs?.approval ?? '',
    marketingCostCr: mp?.costs?.marketing ?? '',
    financeCostCr: mp?.costs?.finance ?? '',
    landCostCr: mp?.costs?.land ?? '',
  }));

  // Sync from financial results when they arrive
  useEffect(() => {
    if (!mp) return;
    setInputs((prev) => ({
      ...prev,
      totalRevenueCr: mp.revenue?.totalRevenue ?? prev.totalRevenueCr,
      totalConstructionCostCr: mp.costs?.construction ?? prev.totalConstructionCostCr,
      approvalCostCr: mp.costs?.approval ?? prev.approvalCostCr,
      marketingCostCr: mp.costs?.marketing ?? prev.marketingCostCr,
      financeCostCr: mp.costs?.finance ?? prev.financeCostCr,
      landCostCr: mp.costs?.land ?? prev.landCostCr,
    }));
  }, [mp]);

  const set = (k, v) => setInputs((p) => ({ ...p, [k]: v }));
  const num = (v) => (v === '' ? 0 : Number(v) || 0);

  const result = useMemo(
    () =>
      calculateJDAWaterfall({
        totalRevenueCr: num(inputs.totalRevenueCr),
        totalConstructionCostCr: num(inputs.totalConstructionCostCr),
        approvalCostCr: num(inputs.approvalCostCr),
        marketingCostCr: num(inputs.marketingCostCr),
        financeCostCr: num(inputs.financeCostCr),
        landCostCr: num(inputs.landCostCr),
        landownerSharePct: num(inputs.landownerSharePct),
        structureType: inputs.structureType,
      }),
    [inputs]
  );

  const fmtCr = (v) => (v != null ? `₹${v.toFixed(2)} Cr` : '—');
  const fmtPct = (v) => (v != null ? `${v.toFixed(1)}%` : '—');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <GitFork size={16} className="text-primary-600" />
          <span className="text-sm font-semibold text-gray-900">JDA / Development Agreement Waterfall</span>
          {deal?.deal_structure && ['jda', 'area_share', 'revenue_share'].includes(deal.deal_structure) && (
            <span className="text-xs bg-primary-50 text-primary-700 border border-primary-200 rounded px-2 py-0.5">
              Active structure
            </span>
          )}
        </div>
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-5">
          {/* Inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Structure Type</label>
              <select
                value={inputs.structureType}
                onChange={(e) => set('structureType', e.target.value)}
                className="input w-full text-sm"
              >
                {Object.entries(JDA_STRUCTURE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Landowner Share (%)</label>
              <input
                type="number" step="1" min="0" max="100"
                value={inputs.landownerSharePct}
                onChange={(e) => set('landownerSharePct', e.target.value)}
                className="input w-full"
                placeholder="40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Total Revenue (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.totalRevenueCr}
                onChange={(e) => set('totalRevenueCr', e.target.value)}
                className="input w-full"
                placeholder="Auto from DCF"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Construction Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.totalConstructionCostCr}
                onChange={(e) => set('totalConstructionCostCr', e.target.value)}
                className="input w-full"
                placeholder="Auto from DCF"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Approval Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.approvalCostCr}
                onChange={(e) => set('approvalCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Marketing Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.marketingCostCr}
                onChange={(e) => set('marketingCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Finance Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.financeCostCr}
                onChange={(e) => set('financeCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Land Payment (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.landCostCr}
                onChange={(e) => set('landCostCr', e.target.value)}
                className="input w-full"
                placeholder="0 (JDA — no upfront)"
              />
            </div>
          </div>

          {result ? (
            <>
              {/* Waterfall table */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Distribution Waterfall
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Party</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Allocation</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Gross Revenue</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Dev. Costs</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Net Proceeds</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Net Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.waterfall.map((row, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2.5 font-medium text-gray-800">{row.party}</td>
                          <td className="px-3 py-2.5 text-gray-600">{row.label}</td>
                          <td className="px-3 py-2.5 text-right text-gray-800">{fmtCr(row.grossCr)}</td>
                          <td className="px-3 py-2.5 text-right text-red-600">
                            {row.costCr > 0 ? `(${fmtCr(row.costCr)})` : '—'}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${row.netCr != null && row.netCr >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {fmtCr(row.netCr)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-500">
                            {row.marginPct != null ? fmtPct(row.marginPct) : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td colSpan={2} className="px-3 py-2.5 text-gray-700">Project Total</td>
                        <td className="px-3 py-2.5 text-right">{fmtCr(result.summary.totalRevenueCr)}</td>
                        <td className="px-3 py-2.5 text-right text-red-600">({fmtCr(result.summary.devCostCr)})</td>
                        <td className="px-3 py-2.5 text-right text-green-700">{fmtCr(result.summary.projectProfitCr)}</td>
                        <td className="px-3 py-2.5 text-right">{fmtPct(result.summary.projectMarginPct)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-500 mb-0.5">Landowner Net ({result.landownerSharePct}%)</p>
                  <p className="text-base font-bold text-blue-800">{fmtCr(result.summary.landownerNetCr)}</p>
                  <p className="text-xs text-blue-400 mt-0.5">Implicit land value</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className="text-xs text-indigo-500 mb-0.5">Developer Net ({result.developerSharePct}%)</p>
                  <p className={`text-base font-bold ${result.summary.developerNetCr != null && result.summary.developerNetCr >= 0 ? 'text-indigo-800' : 'text-red-700'}`}>
                    {fmtCr(result.summary.developerNetCr)}
                  </p>
                  <p className="text-xs text-indigo-400 mt-0.5">After all costs</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3">
                  <p className="text-xs text-emerald-500 mb-0.5">Developer Margin</p>
                  <p className="text-base font-bold text-emerald-800">{fmtPct(result.summary.developerMarginPct)}</p>
                  <p className="text-xs text-emerald-400 mt-0.5">On developer revenue</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Project Margin</p>
                  <p className="text-base font-bold text-gray-800">{fmtPct(result.summary.projectMarginPct)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">On total revenue</p>
                </div>
              </div>

              <p className="text-xs text-gray-400">
                JDA model: Landowner contributes land (no cash cost); Developer bears 100% of construction,
                approval, marketing, and finance costs. Sharing basis:{' '}
                {inputs.structureType === 'revenue_share' ? 'Revenue share on total project revenue' : 'Area share — proportional unit/plot allocation'}.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">
              Enter a Landowner Share % and Total Revenue to see the distribution.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── JV WATERFALL PANEL ───────────────────────────────────────────────────

function JVWaterfallPanel({ financials, deal }) {
  const mp = financials;
  const [open, setOpen] = useState(
    deal?.deal_structure === 'jv' || deal?.deal_structure === 'profit_share'
  );

  const [inputs, setInputs] = useState(() => ({
    landownerEquityCr: mp?.costs?.land ?? '',
    developerEquityCr: '',
    preferredReturnPct: 8,
    preferredReturnType: 'compound',
    holdPeriodYears: 3,
    developerPromotePct: 20,
    promoteThresholdMultiple: 1.5,
    useCatchUp: false,
    totalRevenueCr: mp?.revenue?.totalRevenue ?? '',
    totalCostCr: mp?.costs?.total ?? '',
  }));

  useEffect(() => {
    if (!mp) return;
    setInputs((prev) => ({
      ...prev,
      landownerEquityCr: prev.landownerEquityCr || mp.costs?.land || '',
      totalRevenueCr: prev.totalRevenueCr || mp.revenue?.totalRevenue || '',
      totalCostCr: prev.totalCostCr || mp.costs?.total || '',
    }));
  }, [mp]);

  const set = (k, v) => setInputs((p) => ({ ...p, [k]: v }));
  const num = (v) => (v === '' ? 0 : Number(v) || 0);

  const result = useMemo(
    () =>
      calculateJVWaterfall({
        totalRevenueCr: num(inputs.totalRevenueCr),
        totalCostCr: num(inputs.totalCostCr),
        landownerEquityCr: num(inputs.landownerEquityCr),
        developerEquityCr: num(inputs.developerEquityCr),
        preferredReturnPct: num(inputs.preferredReturnPct),
        preferredReturnType: inputs.preferredReturnType || 'compound',
        holdPeriodYears: num(inputs.holdPeriodYears),
        developerPromotePct: num(inputs.developerPromotePct),
        promoteThresholdMultiple: num(inputs.promoteThresholdMultiple),
        useCatchUp: !!inputs.useCatchUp,
      }),
    [inputs]
  );

  const fmtCr = (v) => (v != null ? `₹${v.toFixed(2)} Cr` : '—');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <Users size={16} className="text-primary-600" />
          <span className="text-sm font-semibold text-gray-900">Joint Venture Profit Waterfall</span>
          {deal?.deal_structure && ['jv', 'profit_share'].includes(deal.deal_structure) && (
            <span className="text-xs bg-primary-50 text-primary-700 border border-primary-200 rounded px-2 py-0.5">
              Active structure
            </span>
          )}
        </div>
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-5">
          {/* Equity structure inputs */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Equity Structure
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Landowner Equity (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.landownerEquityCr}
                  onChange={(e) => set('landownerEquityCr', e.target.value)}
                  className="input w-full" placeholder="Land value" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Developer Equity (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.developerEquityCr}
                  onChange={(e) => set('developerEquityCr', e.target.value)}
                  className="input w-full" placeholder="Cash contribution" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Total Revenue (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.totalRevenueCr}
                  onChange={(e) => set('totalRevenueCr', e.target.value)}
                  className="input w-full" placeholder="Auto from DCF" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Total Cost (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.totalCostCr}
                  onChange={(e) => set('totalCostCr', e.target.value)}
                  className="input w-full" placeholder="Auto from DCF" />
              </div>
            </div>
          </div>

          {/* Waterfall terms */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Waterfall Terms
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Preferred Return (% pa)</label>
                <input type="number" step="0.5" value={inputs.preferredReturnPct}
                  onChange={(e) => set('preferredReturnPct', e.target.value)}
                  className="input w-full" placeholder="8" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Hold Period (years)</label>
                <input type="number" step="0.5" value={inputs.holdPeriodYears}
                  onChange={(e) => set('holdPeriodYears', e.target.value)}
                  className="input w-full" placeholder="3" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Developer Promote (%)</label>
                <input type="number" step="5" value={inputs.developerPromotePct}
                  onChange={(e) => set('developerPromotePct', e.target.value)}
                  className="input w-full" placeholder="20" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Promote Threshold (x EM)</label>
                <input type="number" step="0.1" value={inputs.promoteThresholdMultiple}
                  onChange={(e) => set('promoteThresholdMultiple', e.target.value)}
                  className="input w-full" placeholder="1.5" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Pref Return Compounding</label>
                <select
                  value={inputs.preferredReturnType || 'compound'}
                  onChange={(e) => set('preferredReturnType', e.target.value)}
                  className="input w-full"
                >
                  <option value="compound">Compound (institutional std)</option>
                  <option value="simple">Simple</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  id="jv-useCatchUp"
                  type="checkbox"
                  checked={!!inputs.useCatchUp}
                  onChange={(e) => set('useCatchUp', e.target.checked)}
                  className="rounded border-gray-300"
                />
                <label htmlFor="jv-useCatchUp" className="text-xs font-medium text-gray-600">
                  GP Catch-Up tranche
                </label>
              </div>
            </div>
          </div>

          {result ? (
            <>
              {/* Equity split header */}
              <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-2.5">
                <span className="font-medium text-gray-800">Equity Split:</span>
                <span className="text-blue-700 font-semibold">
                  Landowner {result.landownerEquityPct?.toFixed(1)}%
                </span>
                <span className="text-gray-400">/</span>
                <span className="text-indigo-700 font-semibold">
                  Developer {result.developerEquityPct?.toFixed(1)}%
                </span>
                <span className="ml-auto text-gray-500">
                  Total equity: ₹{result.totalEquityCr?.toFixed(2)} Cr
                </span>
                {result.promoteTriggered && (
                  <span className="text-amber-700 bg-amber-50 border border-amber-200 text-xs px-2 py-0.5 rounded">
                    Promote triggered
                  </span>
                )}
                {result.catchUpTriggered && (
                  <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 text-xs px-2 py-0.5 rounded">
                    GP catch-up
                  </span>
                )}
                {result.preferredReturnType && (
                  <span className="text-gray-600 bg-white border border-gray-200 text-xs px-2 py-0.5 rounded">
                    Pref: {result.preferredReturnType}
                  </span>
                )}
              </div>

              {/* Waterfall table */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Profit Distribution Waterfall
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Tranche</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Landowner</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Developer</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Total</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.waterfall.map((row, i) => (
                        <tr key={i} className={`border-b last:border-0 hover:bg-gray-50 transition-colors ${!row.fromProfit ? 'bg-blue-50/40' : ''}`}>
                          <td className="px-3 py-2.5 font-medium text-gray-800">{row.tranche}</td>
                          <td className="px-3 py-2.5 text-right text-blue-700">{fmtCr(row.landownerCr)}</td>
                          <td className="px-3 py-2.5 text-right text-indigo-700">{fmtCr(row.developerCr)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-800">{fmtCr(row.totalCr)}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-400">{row.note}</td>
                        </tr>
                      ))}
                      {/* Totals */}
                      <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                        <td className="px-3 py-2.5 text-gray-700">Total Distribution</td>
                        <td className="px-3 py-2.5 text-right text-blue-700">{fmtCr(result.summary.landownerTotal)}</td>
                        <td className="px-3 py-2.5 text-right text-indigo-700">{fmtCr(result.summary.developerTotal)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-800">
                          {fmtCr((result.summary.landownerTotal || 0) + (result.summary.developerTotal || 0))}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-500 mb-0.5">Landowner Profit</p>
                  <p className="text-base font-bold text-blue-800">{fmtCr(result.summary.landownerProfit)}</p>
                  <p className="text-xs text-blue-400 mt-0.5">After capital return</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className="text-xs text-indigo-500 mb-0.5">Developer Profit</p>
                  <p className="text-base font-bold text-indigo-800">{fmtCr(result.summary.developerProfit)}</p>
                  <p className="text-xs text-indigo-400 mt-0.5">Incl. promote</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-500 mb-0.5">Landowner Multiple</p>
                  <p className="text-base font-bold text-blue-800">
                    {result.summary.landownerMultiple != null ? `${result.summary.landownerMultiple.toFixed(2)}x` : '—'}
                  </p>
                  <p className="text-xs text-blue-400 mt-0.5">On land contribution</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className="text-xs text-indigo-500 mb-0.5">Developer Multiple</p>
                  <p className="text-base font-bold text-indigo-800">
                    {result.summary.developerMultiple != null ? `${result.summary.developerMultiple.toFixed(2)}x` : '—'}
                  </p>
                  <p className="text-xs text-indigo-400 mt-0.5">On cash contribution</p>
                </div>
              </div>

              <p className="text-xs text-gray-400">
                JV model: Landowner equity = land at agreed valuation. Developer equity = cash contribution.
                Preferred return accrues on total equity at {inputs.preferredReturnPct}% pa over{' '}
                {inputs.holdPeriodYears} years before residual profit sharing.
                {result.promoteTriggered
                  ? ` Developer promote of ${inputs.developerPromotePct}% triggered at ${inputs.promoteThresholdMultiple}x equity multiple.`
                  : ` Promote threshold (${inputs.promoteThresholdMultiple}x) not reached — no promote.`}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">
              Enter equity contributions, total revenue, and total cost to see the waterfall.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DEBT SCHEDULE PANEL ──────────────────────────────────────────────────

function DebtSchedulePanel({ financials: rawFinancials, normalizedFinancials }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const capitalStack = rawFinancials?.capital_stack || rawFinancials?.model_params?.capitalStack;
  const inputs = rawFinancials?.model_params?.inputs || {};

  const debtLTV = capitalStack?.debtLTV ?? inputs.debtLTV ?? 0;
  const debtRatePct = capitalStack?.debtRatePct ?? inputs.debtRatePct ?? 0;
  const debtDrawnCr = capitalStack?.debtCr ?? 0;
  const projectDurationMonths =
    (inputs.projectDurationYears != null ? Number(inputs.projectDurationYears) * 12 : null)
    ?? inputs.projectDurationMonths
    ?? rawFinancials?.project_duration_months
    ?? 36;
  const constructionStartMonths =
    (inputs.constructionStartMonths != null && inputs.constructionStartMonths !== '' ? Number(inputs.constructionStartMonths) : null)
    ?? (inputs.constructionStartYears != null ? Number(inputs.constructionStartYears) * 12 : null)
    ?? 0;
  const constructionEndMonths =
    (inputs.constructionEndMonths != null && inputs.constructionEndMonths !== '' ? Number(inputs.constructionEndMonths) : null)
    ?? (inputs.constructionEndYears != null ? Number(inputs.constructionEndYears) * 12 : null)
    ?? projectDurationMonths * 0.85;

  const debtTenorYearsRaw = capitalStack?.debtTenorYears ?? inputs.debtTenorYears;
  const debtTenorMonths = debtTenorYearsRaw != null && debtTenorYearsRaw !== ''
    ? Number(debtTenorYearsRaw) * 12
    : null;

  const schedule = useMemo(() => {
    if (!(debtDrawnCr > 0) || !(debtRatePct > 0)) return null;
    return buildDebtSchedule({
      debtDrawnCr,
      debtRatePct,
      projectDurationMonths,
      constructionStartMonths,
      constructionEndMonths,
      debtTenorMonths,
    });
  }, [debtDrawnCr, debtRatePct, projectDurationMonths, constructionStartMonths, constructionEndMonths, debtTenorMonths]);

  // Backend-computed amortizing schedule for income assets + hospitality.
  // Present when debtCoverage > 0 on an income-asset model.
  const amortizingSchedule = capitalStack?.debtSchedule;

  // Render if we have either (a) a construction-loan S-curve (residential/plotted
  // with debtLTV > 0), or (b) a backend amortizing schedule (income/hospitality).
  if (!capitalStack || (!schedule && !amortizingSchedule?.termLoan && !amortizingSchedule?.lrd)) {
    return null;
  }

  const rows = schedule ? (showAll ? schedule.rows : schedule.rows.slice(0, 10)) : [];
  const fmtCr = (v) => (v != null && v !== 0 ? `₹${v.toFixed(2)} Cr` : '—');
  const hasAmortizing = !!(amortizingSchedule?.termLoan || amortizingSchedule?.lrd);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-primary-600" />
          <span className="text-sm font-semibold text-gray-900">Debt Schedule</span>
          {schedule && (
            <span className="text-xs text-gray-500">
              ₹{schedule.totalDebtCr.toFixed(2)} Cr @ {schedule.debtRatePct}% pa
            </span>
          )}
          {hasAmortizing && (
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5">
              Amortizing — {amortizingSchedule.termLoan?.amortizationYears || amortizingSchedule.lrd?.amortizationYears}yr
            </span>
          )}
          {debtLTV > 0 && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">
              {(debtLTV * 100).toFixed(0)}% LTV
            </span>
          )}
        </div>
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-4">
          {/* Amortizing term-loan summary (income assets / hospitality) */}
          {hasAmortizing && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Operating-Phase Amortizing Debt
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {amortizingSchedule.termLoan && (
                  <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
                    <p className="text-xs font-semibold text-emerald-700 mb-2">Term Loan</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-gray-500">Principal</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.principalCr)}</dd>
                      <dt className="text-gray-500">Rate / Amort</dt>
                      <dd className="text-right text-gray-800 font-medium">
                        {amortizingSchedule.termLoan.annualRatePct}% / {amortizingSchedule.termLoan.amortizationYears}yr
                      </dd>
                      <dt className="text-gray-500">Quarterly P&amp;I</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.quarterlyPaymentCr)}</dd>
                      <dt className="text-gray-500">Annual Debt Service</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.annualDebtServiceCr)}</dd>
                      <dt className="text-gray-500">Total Interest</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.totalInterestCr)}</dd>
                      <dt className="text-gray-500">Balloon at Exit</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.balloonRepaymentCr)}</dd>
                    </dl>
                  </div>
                )}
                {amortizingSchedule.lrd && (
                  <div className="bg-sky-50 rounded-lg p-4 border border-sky-100">
                    <p className="text-xs font-semibold text-sky-700 mb-2">LRD Refinance</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-gray-500">Principal</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.lrd.principalCr)}</dd>
                      <dt className="text-gray-500">Rate / Amort</dt>
                      <dd className="text-right text-gray-800 font-medium">
                        {amortizingSchedule.lrd.annualRatePct}% / {amortizingSchedule.lrd.amortizationYears}yr
                      </dd>
                      <dt className="text-gray-500">Quarterly P&amp;I</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.lrd.quarterlyPaymentCr)}</dd>
                      <dt className="text-gray-500">Annual Debt Service</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.lrd.annualDebtServiceCr)}</dd>
                      <dt className="text-gray-500">Refinance Quarter</dt>
                      <dd className="text-right text-gray-800 font-medium">Q{amortizingSchedule.lrd.refinanceQuarter}</dd>
                      <dt className="text-gray-500">Balloon at Exit</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.lrd.balloonRepaymentCr)}</dd>
                    </dl>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Quarterly P&amp;I based on standard CRE annuity amortization; remaining balance paid as balloon at exit.
              </p>
            </div>
          )}

          {/* Construction S-curve summary (residential / plotted) */}
          {schedule && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs text-amber-500 mb-0.5">Total Debt Drawn</p>
              <p className="text-base font-bold text-amber-800">₹{schedule.totalDebtCr.toFixed(2)} Cr</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs text-amber-500 mb-0.5">Interest Cost</p>
              <p className="text-base font-bold text-amber-800">₹{schedule.totalInterestCr.toFixed(2)} Cr</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-0.5">Interest Rate</p>
              <p className="text-base font-bold text-gray-800">{schedule.debtRatePct}% pa</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-0.5">Total Debt Service</p>
              <p className="text-base font-bold text-gray-800">
                ₹{(schedule.totalDebtCr + schedule.totalInterestCr).toFixed(2)} Cr
              </p>
            </div>
          </div>
          )}

          {/* Construction S-curve schedule table */}
          {schedule && (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Quarter</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Opening Balance</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Draw</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Repayment</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Closing Balance</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Interest</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Cum. Interest</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.quarter} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 text-gray-600">Q{row.quarter}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{fmtCr(row.openingBalance)}</td>
                    <td className="px-3 py-2 text-right text-green-600">
                      {row.draw > 0 ? `+${fmtCr(row.draw)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-red-600">
                      {row.repayment < 0 ? fmtCr(Math.abs(row.repayment)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-800">{fmtCr(row.closingBalance)}</td>
                    <td className="px-3 py-2 text-right text-amber-600">{fmtCr(row.interest)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtCr(row.cumulativeInterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {schedule.rows.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="text-xs text-primary-600 hover:underline"
            >
              {showAll ? 'Show less' : `Show all ${schedule.rows.length} quarters`}
            </button>
          )}

          <p className="text-xs text-gray-400">
            Draw schedule follows construction S-curve. Repayment is a balloon at project completion
            (typical India construction finance). Interest accrues quarterly on outstanding balance.
          </p>
          </>
          )}
        </div>
      )}
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
            <MethodologyExplorer assetClass={activeClass} />
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
              {ASSET_CLASS_CONFIG.map((ac) => (
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
          <KPICards kpis={normalizedFinancials.kpis} assetClass={normalizedFinancials.assetClass} />

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
          <SensitivityTable sensitivity={normalizedFinancials.sensitivity} assetClass={normalizedFinancials.assetClass} />

          {/* Structure waterfall panels */}
          <JDAWaterfallPanel financials={normalizedFinancials} deal={deal} />
          <JVWaterfallPanel financials={normalizedFinancials} deal={deal} />
          <DebtSchedulePanel financials={financials} normalizedFinancials={normalizedFinancials} />

          <div className="border-t pt-6">
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
