'use strict';

const PptxGenJS = require('pptxgenjs');
const { inferAssetClass } = require('../utils/assetClass');

const FONT = 'Arial';

const COLORS = {
  paper: 'F7F3ED',
  white: 'FFFFFF',
  charcoal: '26221F',
  muted: '6E655E',
  line: 'DDD4CA',
  plum: '5B2C42',
  plumSoft: '8C6677',
  sand: 'D8C5AF',
  sandDeep: 'B89B7C',
  green: '3E6F57',
  amber: 'A06A35',
  red: 'A44747',
  blue: '58738E',
  cloud: 'ECE6DE',
  mist: 'F2EDE7',
};

const ASSET_CLASS_LABELS = {
  residential_apartments: 'Residential Apartments',
  plotted_development: 'Plotted Development',
  villas: 'Villas',
  commercial_office: 'Commercial Office',
  retail: 'Retail',
  industrial_warehousing: 'Industrial & Warehousing',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed Use',
  raw_land: 'Raw Land',
  redevelopment: 'Redevelopment',
};

const DEAL_TYPE_LABELS = {
  acquisition: 'Acquisition',
  jv: 'Joint Venture',
  da: 'Development Agreement',
  outright: 'Outright',
};

const DEAL_STRUCTURE_LABELS = {
  outright: 'Outright Purchase',
  jv: 'Joint Venture',
  jda: 'Joint Development Agreement',
  revenue_share: 'Revenue Share',
  area_share: 'Area Share',
  profit_share: 'Profit Share',
  ground_lease: 'Ground Lease',
  hybrid: 'Hybrid Structure',
};

const STAGE_LABELS = {
  sourced: 'Sourced',
  screening: 'Screening',
  site_visit: 'Site Visit',
  loi: 'LOI',
  due_diligence: 'Due Diligence',
  underwriting: 'Underwriting',
  ic_review: 'Investor-Grade Review',
  negotiation: 'Negotiation',
  active: 'Active',
  closed: 'Closed',
  dead: 'Dead',
};

const PRIORITY_LABELS = {
  low: 'Low Priority',
  medium: 'Medium Priority',
  high: 'High Priority',
};

const INCOME_ASSETS = new Set(['commercial_office', 'retail', 'industrial_warehousing', 'hospitality']);
const LAND_LED_ASSETS = new Set(['raw_land', 'plotted_development', 'redevelopment']);

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = num(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const positiveNumber = (value) => {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const firstText = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
};

const humanize = (value) =>
  String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const formatNumber = (value, decimals = 0) => {
  const parsed = num(value);
  if (parsed === null) return null;
  return parsed.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
};

const formatCrores = (value, decimals = 2) => {
  const formatted = formatNumber(value, decimals);
  return formatted ? `INR ${formatted} Cr` : null;
};

const formatPct = (value, decimals = 1) => {
  const formatted = formatNumber(value, decimals);
  return formatted ? `${formatted}%` : null;
};

const formatArea = (value) => {
  const formatted = formatNumber(value, 0);
  return formatted ? `${formatted} sqft` : null;
};

const formatRate = (value) => {
  const formatted = formatNumber(value, 0);
  return formatted ? `INR ${formatted} / sqft` : null;
};

const formatRent = (value) => {
  const formatted = formatNumber(value, 0);
  return formatted ? `INR ${formatted} / sqft / month` : null;
};

const formatDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const truncate = (value, max) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

const pickSeverityColor = (severity) => {
  switch (severity) {
    case 'deal_breaker':
    case 'critical':
      return COLORS.red;
    case 'buildability_blocker':
    case 'high':
      return COLORS.amber;
    case 'medium':
      return COLORS.blue;
    default:
      return COLORS.green;
  }
};

const resolveStatusText = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const dedupeByTitle = (items = []) => {
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    const key = `${item.title || ''}::${item.detail || ''}`;
    if (!key.trim() || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
};

const severityRank = (severity) => {
  switch (severity) {
    case 'deal_breaker':
    case 'critical':
      return 4;
    case 'buildability_blocker':
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
};

const normalizeStructureFamily = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['acquisition', 'outright', 'purchase', 'buyout'].includes(normalized)) return 'outright';
  if (['jv', 'joint_venture', 'joint venture', 'joint development', 'jda', 'jvda'].includes(normalized)) return 'structured';
  if (['revenue_share', 'area_share', 'profit_share', 'ground_lease', 'hybrid'].includes(normalized)) return 'structured';
  return normalized;
};

const hasStructureMismatch = (deal = {}) => {
  const dealTypeFamily = normalizeStructureFamily(deal.deal_type);
  const structureFamily = normalizeStructureFamily(deal.deal_structure);
  return !!(dealTypeFamily && structureFamily && dealTypeFamily !== structureFamily);
};

const getAssetClassLabel = (assetClass) =>
  ASSET_CLASS_LABELS[assetClass] || humanize(assetClass) || 'Real Estate Opportunity';

const getDealTypeLabel = (dealType) => DEAL_TYPE_LABELS[dealType] || humanize(dealType) || 'Transaction';

const getDealStructureLabel = (dealStructure) =>
  DEAL_STRUCTURE_LABELS[dealStructure] || humanize(dealStructure) || 'Structure Not Provided';

const isIncomeAsset = (assetClass) => INCOME_ASSETS.has(assetClass);
const isLandLedAsset = (assetClass) => LAND_LED_ASSETS.has(assetClass);
const isStructuredDeal = (dealStructure) =>
  ['jv', 'jda', 'revenue_share', 'area_share', 'profit_share', 'ground_lease', 'hybrid'].includes(dealStructure);

const midpoint = (min, max) => {
  const minValue = num(min);
  const maxValue = num(max);
  if (minValue === null && maxValue === null) return null;
  if (minValue === null) return maxValue;
  if (maxValue === null) return minValue;
  return (minValue + maxValue) / 2;
};

const filterRows = (rows) => rows.filter((row) => row && row.value);

const buildDerivedRiskRows = (context) => {
  const rows = [];
  const valueGap = context.valueGapCr;

  if (!context.isIncome) {
    if (valueGap !== null && valueGap < 0) {
      rows.push({
        severity: 'high',
        title: 'Modeled value below total cost',
        detail: `Current revenue / value of ${formatCrores(context.totalRevenue)} trails total cost of ${formatCrores(context.totalCost)} by ${formatCrores(Math.abs(valueGap))}.`,
      });
    }

    if (context.irr !== null && context.irr < 0) {
      rows.push({
        severity: 'high',
        title: 'Negative project IRR',
        detail: `Stored underwriting shows IRR of ${formatPct(context.irr)}, indicating the current price and program assumptions destroy equity returns.`,
      });
    } else if (context.irr !== null && context.irr < 15) {
      rows.push({
        severity: 'medium',
        title: 'Sub-threshold project IRR',
        detail: `Stored underwriting shows IRR of ${formatPct(context.irr)}, below a typical institutional development hurdle.`,
      });
    }

    if (context.grossMargin !== null && context.grossMargin < 0) {
      rows.push({
        severity: 'high',
        title: 'Negative gross margin',
        detail: `Gross margin is ${formatPct(context.grossMargin)}, so the current base case does not support a viable profit cushion.`,
      });
    } else if (context.grossMargin !== null && context.grossMargin < 12) {
      rows.push({
        severity: 'medium',
        title: 'Thin gross margin',
        detail: `Gross margin is ${formatPct(context.grossMargin)}, leaving limited buffer against execution slippage.`,
      });
    }

    if (
      context.askPrice !== null
      && context.residualLandValue !== null
      && context.askPrice > context.residualLandValue
    ) {
      rows.push({
        severity: 'medium',
        title: 'Ask exceeds residual land value',
        detail: `Stored ask of ${formatCrores(context.askPrice)} is above residual land value of ${formatCrores(context.residualLandValue)} by ${formatCrores(context.askPrice - context.residualLandValue)}.`,
      });
    }
  }

  if (context.priceGapPct !== null && context.priceGapPct > 5) {
    rows.push({
      severity: 'medium',
      title: 'Pricing relies on premium to comps',
      detail: `Modeled pricing sits ${formatPct(context.priceGapPct, 1)} above the verified comparable median, compressing execution headroom.`,
    });
  }

  if (context.readiness.readiness_pct != null && context.readiness.readiness_pct < 45) {
    rows.push({
      severity: 'medium',
      title: 'Low execution readiness',
      detail: `Readiness is only ${context.readiness.readiness_pct}%, so approvals, diligence, and document coverage remain too light for a clean investor-review process.`,
    });
  }

  if (
    context.approvalSummary.required
    && context.approvalSummary.validated < context.approvalSummary.required
  ) {
    rows.push({
      severity: 'medium',
      title: 'Required approvals remain open',
      detail: `${context.approvalSummary.validated}/${context.approvalSummary.required} required approvals are currently validated in the data room.`,
    });
  }

  if (context.structureMismatch) {
    rows.push({
      severity: 'medium',
      title: 'Deal type and structure do not align',
      detail: `The record currently shows ${context.dealTypeLabel} as the deal type but ${context.dealStructureLabel} as the commercial structure; this needs confirmation before circulation.`,
    });
  }

  if (
    !context.isIncome
    && ['ic_review', 'negotiation', 'active'].includes(String(context.deal.stage || '').toLowerCase())
    && !context.deal.rera_number
  ) {
    rows.push({
      severity: 'low',
      title: 'RERA registration not recorded',
      detail: 'No RERA number is currently stored for the deal, so launch and compliance readiness should be reconfirmed.',
    });
  }

  return rows.map((row) => ({
    ...row,
    fill: pickSeverityColor(row.severity),
  }));
};

const buildFinancialRows = (context) => {
  if (context.isIncome) {
    return filterRows([
      { label: 'Entry Value', value: formatCrores(context.entryValue) },
      { label: 'Stabilized NOI / Base Rent', value: formatCrores(context.noi) || formatRent(context.baseRent) },
      { label: 'Yield on Cost / Exit Cap', value: formatPct(context.yieldOnCost) || formatPct(context.inputs.exitCapRate, 2) },
      { label: 'Exit Value', value: formatCrores(context.exitValue) },
      { label: 'DSCR / IRR', value: context.deal.dscr != null ? `${formatNumber(context.deal.dscr, 2)}x` : formatPct(context.irr) },
      { label: 'Vacancy', value: context.inputs.vacancyPct != null ? formatPct(context.inputs.vacancyPct, 1) : null },
    ]);
  }

  return filterRows([
    { label: 'Ask / Entry Basis', value: formatCrores(context.commercialMarker) },
    { label: 'Total Cost', value: formatCrores(context.totalCost) },
    { label: 'Revenue / Value', value: formatCrores(firstNumber(context.totalRevenue, context.exitValue)) },
    { label: 'Gross Profit / (Loss)', value: context.valueGapCr != null ? formatCrores(context.valueGapCr) : null },
    { label: 'Residual Land Value', value: formatCrores(context.residualLandValue) },
    { label: 'Sell Rate', value: formatRate(context.modelSellRate) },
  ]);
};

const buildFinancialCommentary = (context) => {
  const points = [];

  if (!context.hasFinancialModel) {
    return ['Stored financial outputs are incomplete, so the economics slide is intentionally limited to available REDIP fields.'];
  }

  if (context.isIncome) {
    if ((context.noi !== null || context.baseRent !== null) && context.exitValue !== null) {
      points.push(`The operating case is underwritten to ${formatCrores(context.noi) || formatRent(context.baseRent)} and ${formatCrores(context.exitValue)} of terminal value.`);
    }
    if (context.baseRent !== null || context.inputs.exitCapRate != null) {
      points.push(
        [
          context.baseRent !== null ? `Base rent is set at ${formatRent(context.baseRent)}` : null,
          context.inputs.exitCapRate != null ? `exit cap at ${formatPct(context.inputs.exitCapRate, 2)}` : null,
        ].filter(Boolean).join(' | ') + '.',
      );
    }
    if (context.deal.dscr != null && context.deal.dscr < 1.2) {
      points.push(`DSCR of ${formatNumber(context.deal.dscr, 2)}x indicates tighter debt service coverage than a typical stabilized lender case.`);
    }
    return points.slice(0, 3);
  }

  if (context.valueGapCr !== null && context.valueGapCr < 0) {
    points.push(`The base case is currently value-destructive, with revenue / value trailing total cost by ${formatCrores(Math.abs(context.valueGapCr))}.`);
  } else if (context.totalRevenue !== null && context.totalCost !== null) {
    points.push(`The current model shows revenue / value of ${formatCrores(context.totalRevenue)} against total cost of ${formatCrores(context.totalCost)}.`);
  }

  if (context.askPrice !== null && context.residualLandValue !== null) {
    const variance = context.askPrice - context.residualLandValue;
    if (variance > 0) {
      points.push(`The stored ask of ${formatCrores(context.askPrice)} is ${formatCrores(variance)} above residual land value, so commercial terms need re-cutting or a scheme reset.`);
    } else {
      points.push(`The stored ask of ${formatCrores(context.askPrice)} is supported by residual land value of ${formatCrores(context.residualLandValue)}.`);
    }
  }

  if (context.priceGapPct !== null && context.modelSellRate !== null && context.benchmarkMedianRate !== null) {
    const stance = context.priceGapPct >= 0 ? 'above' : 'below';
    points.push(`Modeled sell rate of ${formatRate(context.modelSellRate)} sits ${formatPct(Math.abs(context.priceGapPct), 1)} ${stance} the verified comparable median of ${formatRate(context.benchmarkMedianRate)}.`);
  }

  return points.slice(0, 3);
};

const buildTransactionCommentary = (context) => {
  const points = [];

  if (context.structureMismatch) {
    points.push(`Stored deal type (${context.dealTypeLabel}) and structure (${context.dealStructureLabel}) are inconsistent and should be reconciled before external circulation.`);
  } else if (isStructuredDeal(context.deal.deal_structure)) {
    points.push('Structured economics should be locked with partner obligations, downside protections, and documented split mechanics before the next round.');
  } else {
    points.push('The current structure reads as a direct purchase, which simplifies execution if pricing and diligence clear.');
  }

  if (context.recommendations?.label) {
    points.push(`Current underwriting call: ${context.recommendations.label}. ${context.recommendations.reason || ''}`.trim());
  }

  if (context.askPrice !== null && context.negotiatedPrice === null) {
    points.push('A negotiated commercial marker is not yet stored, so the pricing discussion still appears to be at the ask stage.');
  } else if (context.askPrice !== null && context.negotiatedPrice !== null && context.askPrice !== context.negotiatedPrice) {
    points.push(`Negotiation visibility exists between ${formatCrores(context.askPrice)} ask and ${formatCrores(context.negotiatedPrice)} current marker.`);
  }

  return points.slice(0, 3);
};

const buildExecutiveSummaryPoints = (context, exportContext) => {
  const points = [];

  if (context.askPrice !== null || context.negotiatedPrice !== null || context.entryValue !== null) {
    const pricingLine = context.askPrice !== null && context.negotiatedPrice !== null && context.negotiatedPrice !== context.askPrice
      ? `Current commercial marker at ${formatCrores(context.askPrice)} with negotiation visibility at ${formatCrores(context.negotiatedPrice)}.`
      : context.negotiatedPrice !== null
        ? `Current commercial marker at ${formatCrores(context.negotiatedPrice)}.`
      : context.askPrice !== null
        ? `Current transaction marker at ${formatCrores(context.askPrice)}.`
        : context.entryValue !== null
          ? `Current entry value marker at ${formatCrores(context.entryValue)}.`
          : null;
    if (pricingLine) {
      points.push(pricingLine);
    }
  }

  if (context.landAreaSqft !== null || context.grossAreaSqft !== null || context.leasableAreaSqft !== null) {
    const scaleBits = [
      context.landAreaSqft !== null ? `land parcel ${formatArea(context.landAreaSqft)}` : null,
      !context.isIncome && context.grossAreaSqft !== null ? `gross built-up ${formatArea(context.grossAreaSqft)}` : null,
      context.isIncome && context.leasableAreaSqft !== null ? `leasable area ${formatArea(context.leasableAreaSqft)}` : null,
      !context.isIncome && context.saleableAreaSqft !== null ? `saleable area ${formatArea(context.saleableAreaSqft)}` : null,
    ].filter(Boolean);
    if (scaleBits.length) {
      points.push(`Project scale currently indicates ${scaleBits.join(' | ')}.`);
    }
  }

  if (context.hasFinancialModel) {
    if (context.isIncome) {
      const operatingBits = [
        context.noi !== null ? `stabilized NOI ${formatCrores(context.noi)}` : null,
        context.yieldOnCost !== null ? `yield on cost ${formatPct(context.yieldOnCost)}` : null,
        context.exitValue !== null ? `exit value ${formatCrores(context.exitValue)}` : null,
        context.noi === null && context.baseRent !== null ? `base rent ${formatRent(context.baseRent)}` : null,
        context.yieldOnCost === null && context.inputs.exitCapRate != null ? `exit cap ${formatPct(context.inputs.exitCapRate, 2)}` : null,
        context.inputs.vacancyPct != null ? `vacancy ${formatPct(context.inputs.vacancyPct, 1)}` : null,
      ].filter(Boolean);
      if (operatingBits.length) {
        points.push(`Modeled operating profile supports ${operatingBits.join(' | ')}.`);
      }
    } else {
      const returnBits = [
        context.irr !== null ? `IRR ${formatPct(context.irr)}` : null,
        context.npv !== null ? `NPV ${formatCrores(context.npv)}` : null,
        context.grossMargin !== null ? `gross margin ${formatPct(context.grossMargin)}` : null,
      ].filter(Boolean);
      if (returnBits.length) {
        const valueGapLine =
          context.valueGapCr !== null && context.valueGapCr < 0
            ? ` Revenue trails total cost by ${formatCrores(Math.abs(context.valueGapCr))}.`
            : '';
        const intro = context.recommendations?.tone === 'negative'
          ? 'Stored underwriting is currently adverse, with'
          : 'Current underwriting indicates';
        points.push(`${intro} ${returnBits.join(' | ')}.${valueGapLine}`.trim());
      }
    }
  }

  if (context.priceGapPct !== null && context.modelSellRate !== null && context.benchmarkMedianRate !== null) {
    const stance = context.priceGapPct > 0 ? 'premium' : 'discount';
    points.push(
      `Modeled pricing at ${formatRate(context.modelSellRate)} sits at a ${formatPct(Math.abs(context.priceGapPct), 1)} ${stance} to the verified comp median of ${formatRate(context.benchmarkMedianRate)}.`,
    );
  } else if (!context.isIncome && context.baseRent !== null) {
    const rentBits = [
      `base rent ${formatRent(context.baseRent)}`,
      context.inputs.vacancyPct != null ? `vacancy ${formatPct(context.inputs.vacancyPct, 1)}` : null,
      context.inputs.exitCapRate != null ? `exit cap ${formatPct(context.inputs.exitCapRate, 2)}` : null,
    ].filter(Boolean);
    if (rentBits.length) {
      points.push(`The operating model assumes ${rentBits.join(' | ')}.`);
    }
  }

  if (context.showReadinessSlide) {
    const readinessBits = [
      context.readiness.readiness_pct != null ? `readiness ${context.readiness.readiness_pct}%` : null,
      context.readiness.dd_completion_pct != null ? `DD completion ${context.readiness.dd_completion_pct}%` : null,
      context.approvalSummary.required
        ? `${context.approvalSummary.validated}/${context.approvalSummary.required} required approvals validated`
        : null,
    ].filter(Boolean);
    if (readinessBits.length) {
      points.push(`Execution readiness currently shows ${readinessBits.join(' | ')}.`);
    }
  }

  if (context.structureMismatch) {
    points.push(`Stored commercial setup is inconsistent: deal type is ${context.dealTypeLabel} while the structure is marked ${context.dealStructureLabel}.`);
  }

  const openRiskCount = num(exportContext.risks?.summary?.total) || 0;
  const derivedHighRiskCount = context.riskRows.filter((row) => severityRank(String(row.severity || '').toLowerCase()) >= 3).length;
  if (openRiskCount > 0 || derivedHighRiskCount > 0 || num(exportContext.dd?.summary?.open_deal_breakers) > 0) {
    points.push(
      `${resolveStatusText(num(exportContext.dd?.summary?.open_deal_breakers) || 0, 'deal-breaker diligence item')} and ${resolveStatusText(Math.max(openRiskCount, context.riskRows.length), 'active risk flag')} need closure before final circulation.`,
    );
  }

  if (context.deal.expected_close_date || context.deal.target_launch_date) {
    const dateBits = [
      context.deal.expected_close_date ? `expected close ${formatDate(context.deal.expected_close_date)}` : null,
      context.deal.target_launch_date ? `target launch ${formatDate(context.deal.target_launch_date)}` : null,
    ].filter(Boolean);
    if (dateBits.length) {
      points.push(`Current timing markers indicate ${dateBits.join(' | ')}.`);
    }
  }

  return points.slice(0, 7);
};

const buildInvestmentHighlights = (context, exportContext) => {
  const cards = [];

  if (context.landAreaSqft !== null || context.leasableAreaSqft !== null || context.saleableAreaSqft !== null) {
    const detail = context.isIncome
      ? [
          context.leasableAreaSqft !== null ? `${formatArea(context.leasableAreaSqft)} leasable area` : context.grossAreaSqft !== null ? `${formatArea(context.grossAreaSqft)} gross built-up` : null,
          context.entryValue !== null ? `entry value ${formatCrores(context.entryValue)}` : null,
        ].filter(Boolean).join(' | ')
      : [
          context.landAreaSqft !== null ? `${formatArea(context.landAreaSqft)} land parcel` : null,
          context.saleableAreaSqft !== null ? `${formatArea(context.saleableAreaSqft)} saleable area` : null,
          context.grossAreaSqft !== null ? `${formatArea(context.grossAreaSqft)} gross built-up` : null,
        ].filter(Boolean).join(' | ');
    if (detail) cards.push({ title: 'Institutional Scale', detail: `${detail}.` });
  }

  if (context.hasFinancialModel) {
    if (context.isIncome) {
      const detail = [
        context.noi !== null ? `NOI ${formatCrores(context.noi)}` : context.baseRent !== null ? `base rent ${formatRent(context.baseRent)}` : null,
        context.yieldOnCost !== null ? `yield ${formatPct(context.yieldOnCost)}` : context.inputs.exitCapRate != null ? `exit cap ${formatPct(context.inputs.exitCapRate, 2)}` : null,
        context.exitValue !== null ? `exit value ${formatCrores(context.exitValue)}` : null,
      ].filter(Boolean).join(' | ');
      if (detail) cards.push({ title: 'Modeled Income Profile', detail: `${detail}.` });
    } else if (context.recommendations?.tone === 'negative') {
      cards.push({
        title: 'Underwriting Reset Required',
        detail: [
          context.irr !== null ? `IRR ${formatPct(context.irr)}` : null,
          context.npv !== null ? `NPV ${formatCrores(context.npv)}` : null,
          context.grossMargin !== null ? `margin ${formatPct(context.grossMargin)}` : null,
          context.valueGapCr !== null && context.valueGapCr < 0 ? `${formatCrores(Math.abs(context.valueGapCr))} value gap to cost` : null,
        ].filter(Boolean).join(' | '),
      });
    } else {
      const detail = [
        context.irr !== null ? `IRR ${formatPct(context.irr)}` : null,
        context.npv !== null ? `NPV ${formatCrores(context.npv)}` : null,
        context.grossMargin !== null ? `margin ${formatPct(context.grossMargin)}` : null,
      ].filter(Boolean).join(' | ');
      if (detail) cards.push({ title: 'Modeled Return Profile', detail: `${detail}.` });
    }
  }

  if (context.priceGapPct !== null && context.modelSellRate !== null) {
    const position = context.priceGapPct > 0 ? 'premium' : 'discount';
    cards.push({
      title: 'Pricing Positioning',
      detail: `${formatRate(context.modelSellRate)} modeled pricing at a ${formatPct(Math.abs(context.priceGapPct), 1)} ${position} to verified comp median.`,
    });
  } else if (context.baseRent !== null) {
    cards.push({
      title: 'Operating Assumptions',
      detail: [
        `Base rent ${formatRent(context.baseRent)}`,
        context.inputs.vacancyPct != null ? `vacancy ${formatPct(context.inputs.vacancyPct, 1)}` : null,
        context.inputs.rentEscalationPct != null ? `escalation ${formatPct(context.inputs.rentEscalationPct, 1)}` : null,
      ].filter(Boolean).join(' | '),
    });
  }

  if (!context.isIncome && context.askPrice !== null && context.residualLandValue !== null) {
    const variance = context.askPrice - context.residualLandValue;
    cards.push({
      title: variance > 0 ? 'Land Basis vs Residual Value' : 'Land Basis Support',
      detail:
        variance > 0
          ? `Ask of ${formatCrores(context.askPrice)} sits ${formatCrores(variance)} above residual land value of ${formatCrores(context.residualLandValue)}.`
          : `Residual land value of ${formatCrores(context.residualLandValue)} supports the current ask basis of ${formatCrores(context.askPrice)}.`,
    });
  }

  if (context.approvalSummary.required || context.readiness.dd_completion_pct != null) {
    cards.push({
      title: 'Execution Readiness',
      detail: [
        context.approvalSummary.required
          ? `${context.approvalSummary.validated}/${context.approvalSummary.required} required approvals validated`
          : null,
        context.readiness.dd_completion_pct != null ? `DD completion ${context.readiness.dd_completion_pct}%` : null,
        context.documentSummary.total ? `${context.documentSummary.total} documents linked` : null,
      ].filter(Boolean).join(' | '),
    });
  }

  if (context.deal.zoning || context.deal.permissible_fsi || context.deal.circle_rate_per_sqft) {
    cards.push({
      title: 'Planning & Value Markers',
      detail: [
        context.deal.zoning ? `zoning ${humanize(context.deal.zoning)}` : null,
        context.deal.permissible_fsi != null ? `permissible FSI ${formatNumber(context.deal.permissible_fsi, 2)}` : null,
        context.deal.circle_rate_per_sqft != null ? `circle rate ${formatRate(context.deal.circle_rate_per_sqft)}` : null,
      ].filter(Boolean).join(' | '),
    });
  }

  if (context.deal.owner_name || isStructuredDeal(context.deal.deal_structure) || context.negotiatedPrice !== null) {
    cards.push({
      title: 'Transaction Structuring',
      detail: [
        context.deal.owner_name ? `Owner / counterparty: ${context.deal.owner_name}` : null,
        context.deal.deal_structure ? context.dealStructureLabel : null,
        context.negotiatedPrice !== null ? `negotiation marker ${formatCrores(context.negotiatedPrice)}` : null,
        context.structureMismatch ? 'stored deal type / structure mismatch to reconcile' : null,
      ].filter(Boolean).join(' | '),
    });
  }

  if ((exportContext.market?.benchmarks?.count || 0) > 0 || context.cityBenchmarks.length) {
    cards.push({
      title: 'Verified Market Context',
      detail: context.cityBenchmarks.length
        ? `${context.cityBenchmarks.length} city benchmark nodes and ${resolveStatusText(exportContext.market?.benchmarks?.count || 0, 'comparable record')} support pricing context.`
        : `${resolveStatusText(exportContext.market?.benchmarks?.count || 0, 'comparable record')} support current pricing context.`,
    });
  }

  return dedupeByTitle(cards).slice(0, 6);
};

const buildMarketObservations = (context, exportContext) => {
  const observations = [];

  if (context.cityBenchmarks.length) {
    const markets = context.cityBenchmarks.map((row) => row.micro_market).filter(Boolean).slice(0, 3).join(', ');
    const benchmarkLow = Math.min(
      ...context.cityBenchmarks
        .map((row) => firstNumber(row.avg_price_min_per_sqft, row.avg_price_max_per_sqft))
        .filter((value) => value !== null),
    );
    const benchmarkHigh = Math.max(
      ...context.cityBenchmarks
        .map((row) => firstNumber(row.avg_price_max_per_sqft, row.avg_price_min_per_sqft))
        .filter((value) => value !== null),
    );

    if (Number.isFinite(benchmarkLow) && Number.isFinite(benchmarkHigh)) {
      observations.push(
        `${context.deal.city || 'City'} benchmark pricing currently spans ${formatRate(benchmarkLow)} to ${formatRate(benchmarkHigh)} across verified nodes including ${markets}.`,
      );
    }
  }

  if (context.priceGapPct !== null && context.modelSellRate !== null) {
    const stance = context.priceGapPct > 0 ? 'above' : 'below';
    observations.push(
      `The modeled rate of ${formatRate(context.modelSellRate)} sits ${formatPct(Math.abs(context.priceGapPct), 1)} ${stance} the comparable median, which directly frames pricing headroom and execution risk.`,
    );
    if (!context.isIncome && context.recommendations?.tone === 'negative' && Math.abs(context.priceGapPct) <= 5) {
      observations.push(
        'Comparable pricing alone does not explain the weak base case; the underwriting shortfall is more likely being driven by land basis, scheme efficiency, or cost intensity.',
      );
    }
  } else if (context.baseRent !== null && context.inputs.exitCapRate != null) {
    observations.push(
      `The operating case is anchored on ${formatRent(context.baseRent)} base rent and ${formatPct(context.inputs.exitCapRate, 2)} exit cap assumptions.`,
    );
  }

  if ((exportContext.market?.benchmarks?.count || 0) > 0) {
    observations.push(
      `Comparable coverage includes ${resolveStatusText(exportContext.market.benchmarks.count, 'verified rate point')}, with a median at ${formatRate(exportContext.market.benchmarks.median_rate_per_sqft)}.`,
    );
  }

  if (!observations.length) {
    observations.push('Verified city benchmark or comparable data has not been fully linked for this deal, so market commentary is intentionally limited to stored REDIP records.');
  }

  return observations.slice(0, 3);
};

const buildAssetNarrative = (context, exportContext) => {
  const parts = [];

  if (context.deal.city || context.deal.state) {
    parts.push(`${context.assetClassLabel} opportunity in ${[context.deal.city, context.deal.state].filter(Boolean).join(', ') || 'the sourced market'}.`);
  }

  if (context.deal.zoning || context.deal.permissible_fsi) {
    parts.push(
      [
        context.deal.zoning ? `Current zoning is recorded as ${humanize(context.deal.zoning)}.` : null,
        context.deal.permissible_fsi != null ? `Permissible FSI is stored at ${formatNumber(context.deal.permissible_fsi, 2)}.` : null,
      ].filter(Boolean).join(' '),
    );
  }

  if (context.deal.ownership_type || context.deal.encumbrance_status) {
    parts.push(
      [
        context.deal.ownership_type ? `Ownership type: ${context.deal.ownership_type}.` : null,
        context.deal.encumbrance_status ? `Encumbrance status: ${context.deal.encumbrance_status}.` : null,
      ].filter(Boolean).join(' '),
    );
  }

  if (context.documentSummary.visuals?.hasPlans || context.documentSummary.visuals?.hasMaps) {
    parts.push(
      `The current deal room includes ${resolveStatusText(context.documentSummary.planCount || 0, 'plan document')} and ${resolveStatusText(context.documentSummary.mapCount || 0, 'map-backed file', 'map-backed files')} that can support downstream underwriting and investor-review prep.`,
    );
  }

  if ((exportContext.risks?.items || []).length) {
    const topRisk = exportContext.risks.items[0];
    parts.push(`Primary recorded risk at this stage is ${truncate(topRisk.title || 'an open risk flag', 80)}.`);
  }

  return parts.filter(Boolean).slice(0, 4);
};

const buildCounterpartyRows = (context) =>
  filterRows([
    { label: 'Deal Type', value: context.dealTypeLabel },
    { label: 'Structure', value: context.dealStructureLabel },
    {
      label: 'Structure Check',
      value: context.structureMismatch ? 'Stored deal type and structure require reconciliation' : 'Deal type and structure read consistently',
    },
    { label: 'Owner / Counterparty', value: firstText(context.deal.owner_name) },
    { label: 'Ownership Type', value: firstText(context.deal.ownership_type) },
    { label: 'Ask Price', value: formatCrores(context.askPrice) },
    { label: 'Negotiated Marker', value: formatCrores(context.negotiatedPrice) },
    {
      label: 'Partner Economics',
      value:
        context.deal.jv_split_developer_pct != null || context.deal.jv_split_landowner_pct != null
          ? [
              context.deal.jv_split_developer_pct != null
                ? `developer ${formatPct(context.deal.jv_split_developer_pct, 1)}`
                : null,
              context.deal.jv_split_landowner_pct != null
                ? `landowner ${formatPct(context.deal.jv_split_landowner_pct, 1)}`
                : null,
            ].filter(Boolean).join(' | ')
          : null,
    },
    { label: 'Current Stage', value: context.stageLabel },
    { label: 'Priority', value: context.priorityLabel },
    { label: 'Assigned Lead', value: firstText(context.deal.assigned_to_name) },
  ]);

const buildLocationRows = (context) =>
  filterRows([
    { label: 'Address', value: context.addressLine },
    { label: 'City / State', value: [context.deal.city, context.deal.state].filter(Boolean).join(', ') || null },
    { label: 'Pincode', value: firstText(context.deal.pincode) },
    { label: 'Coordinates', value: context.coordinates },
    {
      label: 'Geocode Status',
      value:
        context.deal.geocode_status
          ? `${humanize(context.deal.geocode_status)}${context.deal.geocode_confidence != null ? ` | confidence ${formatPct(context.deal.geocode_confidence * 100, 0)}` : ''}`
          : null,
    },
    { label: 'Road Width', value: context.deal.road_width_mtrs != null ? `${formatNumber(context.deal.road_width_mtrs, 1)} m` : null },
    { label: 'Survey Number', value: firstText(context.deal.survey_number) },
    { label: 'Setback Details', value: firstText(context.deal.setback_details) },
  ]);

const buildAssetDetailRows = (context) =>
  filterRows([
    { label: 'Asset Class', value: context.assetClassLabel },
    { label: 'Land Area', value: formatArea(context.landAreaSqft) },
    { label: 'Gross Built-up', value: formatArea(context.grossAreaSqft) },
    { label: 'Saleable Area', value: formatArea(context.saleableAreaSqft) },
    { label: context.isIncome ? 'Leasable Area' : 'Carpet Area', value: context.isIncome ? formatArea(context.leasableAreaSqft) : formatArea(context.carpetAreaSqft) },
    { label: 'Circle Rate', value: formatRate(context.deal.circle_rate_per_sqft) },
    { label: 'Existing FSI', value: context.deal.existing_fsi != null ? formatNumber(context.deal.existing_fsi, 2) : null },
    { label: 'Permissible FSI', value: context.deal.permissible_fsi != null ? formatNumber(context.deal.permissible_fsi, 2) : null },
    { label: 'Land Pricing Basis', value: firstText(humanize(context.deal.land_pricing_basis)) },
    {
      label: 'Indicative Land Rate',
      value:
        context.deal.land_price_rate_inr != null
          ? context.deal.land_extent_input_unit === 'acre'
            ? `INR ${formatNumber(context.deal.land_price_rate_inr, 0)} / acre`
            : `INR ${formatNumber(context.deal.land_price_rate_inr, 0)} / sqft`
          : null,
    },
  ]);

const buildProjectRows = (context) =>
  filterRows([
    { label: 'Current Stage', value: context.stageLabel },
    { label: 'RERA Number', value: firstText(context.deal.rera_number) },
    { label: 'RERA Expiry', value: formatDate(context.deal.rera_expiry_date) },
    { label: 'Expected Close', value: formatDate(context.deal.expected_close_date) },
    { label: 'Target Launch', value: formatDate(context.deal.target_launch_date) },
    { label: 'Readiness', value: context.readiness.readiness_pct != null ? `${context.readiness.readiness_pct}%` : null },
    {
      label: 'Approvals Tracked',
      value:
        context.approvalSummary.required
          ? `${context.approvalSummary.validated}/${context.approvalSummary.required} required validated`
          : null,
    },
    { label: 'Document Pack', value: context.documentSummary.total ? resolveStatusText(context.documentSummary.total, 'linked document') : null },
    { label: 'Property Type', value: firstText(humanize(context.deal.property_type)) },
  ]);

const buildApprovalRows = (exportContext) => {
  const approvals = Array.isArray(exportContext.approvals?.items) ? exportContext.approvals.items : [];
  const trackedApprovals = approvals.filter((item) => item.is_required);
  const rows = (trackedApprovals.length ? trackedApprovals : approvals)
    .slice(0, 6)
    .map((item) => ({
      name: firstText(item.name, item.approval_name, humanize(item.approval_type)) || 'Approval item',
      status: item.is_validated || ['validated', 'approved'].includes(item.status)
        ? 'Validated'
        : item.status === 'in_progress'
          ? 'In Progress'
          : item.status === 'issue'
            ? 'Issue'
            : 'Pending',
      authority: firstText(item.issuing_authority, item.authority),
      note: firstText(item.next_action, item.notes, item.reference_number),
    }));
  return rows;
};

const buildDiligenceRows = (exportContext) => {
  const ddItems = Array.isArray(exportContext.dd?.items) ? exportContext.dd.items : [];
  return ddItems
    .filter((item) => !['completed', 'not_applicable'].includes(item.status))
    .slice(0, 5)
    .map((item) => ({
      item: item.item_name,
      category: humanize(item.category),
      severity: humanize(item.severity),
      status: humanize(item.status),
      note: firstText(item.notes),
    }));
};

const buildTransactionRows = (context, exportContext) =>
  filterRows([
    { label: 'Deal Type', value: context.dealTypeLabel },
    { label: 'Structure', value: context.dealStructureLabel },
    { label: 'Structure Check', value: context.structureMismatch ? 'Mismatch between stored deal type and structure' : 'Structure is internally consistent' },
    { label: 'Stage', value: context.stageLabel },
    { label: 'Priority', value: context.priorityLabel },
    { label: 'Ask Price', value: formatCrores(context.askPrice) },
    { label: 'Negotiated Marker', value: formatCrores(context.negotiatedPrice) },
    { label: 'Total Cost', value: formatCrores(context.totalCost) },
    { label: 'Total Revenue / Value', value: formatCrores(firstNumber(context.totalRevenue, context.exitValue)) },
    { label: 'Revenue Less Cost', value: context.valueGapCr != null ? formatCrores(context.valueGapCr) : null },
    { label: 'Residual Land Value', value: formatCrores(context.residualLandValue) },
    { label: 'Underwriting Call', value: firstText(context.recommendations?.label) },
    {
      label: 'Capital Stack',
      value:
        context.capitalStack?.debtCr != null || context.capitalStack?.equityCr != null
          ? [
              context.capitalStack.debtCr != null ? `debt ${formatCrores(context.capitalStack.debtCr)}` : null,
              context.capitalStack.equityCr != null ? `equity ${formatCrores(context.capitalStack.equityCr)}` : null,
            ].filter(Boolean).join(' | ')
          : null,
    },
    {
      label: 'Data Room',
      value: [
        exportContext.documents?.summary?.total ? `${exportContext.documents.summary.total} linked docs` : null,
        exportContext.approvals?.summary?.required ? `${exportContext.approvals.summary.required} required approvals tracked` : null,
      ].filter(Boolean).join(' | ') || null,
    },
  ]);

const buildRiskRows = (context, exportContext) => {
  const risks = Array.isArray(exportContext.risks?.items) ? exportContext.risks.items : [];
  const diligenceFallback = Array.isArray(exportContext.dd?.items)
    ? exportContext.dd.items
      .filter((item) => !['completed', 'not_applicable'].includes(item.status))
      .slice(0, 3)
      .map((item) => ({
        severity: item.severity || 'medium',
        title: item.item_name,
        detail: firstText(item.notes) || 'Outstanding diligence item requires closure before advancing the process.',
      }))
    : [];
  const derived = buildDerivedRiskRows(context);

  return [...risks.map((risk) => ({
    severity: risk.severity || 'medium',
    title: risk.title || 'Open risk flag',
    detail: firstText(risk.description, risk.mitigation) || 'Mitigation path has not yet been recorded.',
  })), ...diligenceFallback, ...derived]
    .map((row) => ({
      severity: humanize(row.severity),
      title: row.title,
      detail: row.detail,
      fill: pickSeverityColor(String(row.severity || '').toLowerCase()),
      _rank: severityRank(String(row.severity || '').toLowerCase()),
    }))
    .sort((a, b) => b._rank - a._rank)
    .filter((row, index, items) => items.findIndex((candidate) => candidate.title === row.title) === index)
    .slice(0, 5)
    .map(({ _rank, ...row }) => row);
};

const buildNextStepGroups = (exportContext) => {
  const groups = Array.isArray(exportContext.nextSteps) ? exportContext.nextSteps : [];
  if (!groups.length && Array.isArray(exportContext.ai?.next_steps) && exportContext.ai.next_steps.length) {
    return [
      {
        group: 'Immediate Actions',
        items: exportContext.ai.next_steps.slice(0, 5),
      },
    ];
  }
  return groups.slice(0, 3).map((group) => ({
    group: group.group,
    items: Array.isArray(group.items) ? group.items.slice(0, 3) : [],
  }));
};

const buildSlideManifest = (context) => {
  const slides = [
    { key: 'cover', title: context.dealTitle },
    { key: 'contents', title: 'Contents' },
    { key: 'dividerOpportunity', title: 'The Opportunity' },
    { key: 'executiveSummary', title: 'Executive Summary' },
    { key: 'investmentHighlights', title: 'Key Investment Highlights' },
  ];

  if (context.showStructureSlide) {
    slides.push({ key: 'structure', title: 'Structure & Counterparty' });
  }

  slides.push(
    { key: 'dividerMarket', title: 'Market / Micro-Market' },
    { key: 'marketPositioning', title: context.cityBenchmarks.length ? 'City Benchmarking' : 'Market Positioning' },
    { key: 'locationContext', title: 'Location & Site Context' },
    { key: 'dividerAsset', title: 'About the Asset' },
    { key: 'assetSnapshot', title: 'Asset Snapshot' },
  );

  if (context.showReadinessSlide) {
    slides.push({
      key: 'readiness',
      title: context.isIncome ? 'Diligence & Operating Readiness' : 'Development Readiness',
    });
  }

  if (context.hasFinancialModel) {
    slides.push(
      { key: 'dividerFinancial', title: 'Financial Summary' },
      { key: 'financialOverview', title: context.isIncome ? 'Operating Economics' : 'Development Economics' },
    );

    if (context.hasCashFlowSlide) {
      slides.push({ key: 'cashFlowSensitivity', title: 'Cash Flow & Sensitivity' });
    }
  }

  slides.push(
    { key: 'transactionSummary', title: 'Transaction Summary' },
    { key: 'risksMitigants', title: 'Risks & Mitigants' },
    { key: 'nextSteps', title: 'Next Steps' },
    { key: 'disclaimer', title: 'Disclaimer' },
  );

  return slides;
};

const buildDeckContext = (exportContext, options = {}) => {
  const deal = exportContext.deal || {};
  const model = deal.model_params || {};
  const inputs = model.inputs || {};
  const modelKpis = model.kpis || {};
  const modelAreas = model.areas || {};
  const modelCosts = model.costs || {};
  const modelRevenue = model.revenue || {};
  const capitalStack = model.capitalStack || {};
  const scenarios = model.scenarios || {};
  const assetClass = inferAssetClass({ deal, inputs });
  const landAreaSqft = firstNumber(deal.land_area_sqft, deal.plot_area_sqft, modelAreas.grossBuiltUp);
  const grossAreaSqft = firstNumber(deal.gross_area_sqft, modelAreas.grossBuiltUp);
  const saleableAreaSqft = firstNumber(deal.saleable_area_sqft, modelAreas.saleable);
  const carpetAreaSqft = firstNumber(deal.carpet_area_sqft, modelAreas.carpet);
  const leasableAreaSqft = firstNumber(modelAreas.leasable, deal.saleable_area_sqft);
  const benchmarkMedianRate = firstNumber(exportContext.market?.benchmarks?.median_rate_per_sqft);
  const modelSellRate = firstNumber(deal.selling_rate_per_sqft, inputs.sellingRatePerSqft);
  const baseRent = firstNumber(inputs.baseRentPerSqftMonth);
  const noi = firstNumber(deal.noi_cr, deal.stabilized_noi_cr, modelKpis.noi, modelRevenue.stabilizedNOI);
  const exitValue = firstNumber(deal.exit_value_cr, modelKpis.exitValue, modelRevenue.exitValue, deal.total_revenue_cr);
  const entryValue = firstNumber(deal.entry_value_cr, modelKpis.entryValue);
  const yieldOnCost = firstNumber(deal.yield_on_cost_pct, modelKpis.yieldOnCost);
  const irr = firstNumber(deal.irr_pct, modelKpis.irr);
  const npv = firstNumber(deal.npv_cr, modelKpis.npv);
  const equityMultiple = firstNumber(deal.equity_multiple, modelKpis.equityMultiple);
  const grossMargin = firstNumber(deal.gross_margin_pct, modelKpis.grossMarginPct);
  const residualLandValue = firstNumber(deal.residual_land_value_cr, modelKpis.rlv);
  const totalCost = firstNumber(deal.total_cost_cr, modelCosts.total);
  const totalRevenue = firstNumber(deal.total_revenue_cr, modelRevenue.totalRevenueCr);
  const negotiatedPrice = positiveNumber(deal.negotiated_price_cr);
  const askPrice = positiveNumber(deal.land_ask_price_cr);
  const commercialMarker = firstNumber(negotiatedPrice, askPrice, entryValue);
  const priceGapPct = num(exportContext.market?.pricingGapPct);
  const readiness = exportContext.readiness || {};
  const approvalSummary = exportContext.approvals?.summary || {};
  const documentSummary = exportContext.documents?.summary || {};
  const recommendations = exportContext.risks?.recommendation || {};
  const cityBenchmarks = Array.isArray(exportContext.market?.cityBenchmarks)
    ? exportContext.market.cityBenchmarks.slice(0, 5)
    : [];
  const compRows = Array.isArray(exportContext.market?.exportComps)
    ? exportContext.market.exportComps.slice(0, 5)
    : [];
  const cashRows = exportContext.cashFlows?.yearly?.length
    ? exportContext.cashFlows.yearly.slice(0, 8)
    : Array.isArray(exportContext.cashFlows?.quarterly)
      ? exportContext.cashFlows.quarterly.slice(0, 8)
      : [];
  const sensitivityMatrix = exportContext.sensitivity || {};
  const scenarioRows = ['base', 'bull', 'bear']
    .map((key) => scenarios[key])
    .filter(Boolean)
    .map((scenario) => ({
      label: scenario.label,
      irr: formatPct(scenario.kpis?.irr, 1) || 'N/A',
      npv: formatCrores(scenario.kpis?.npv, 2) || 'N/A',
      multiple: scenario.kpis?.equityMultiple != null ? `${formatNumber(scenario.kpis.equityMultiple, 2)}x` : 'N/A',
    }));

  const context = {
    brandName: options.brandName || 'REDIP',
    generatedAt: options.generatedAt || exportContext.generatedAt || new Date().toISOString(),
    generatedFor: options.userName || 'REDIP user',
    exportContext,
    deal,
    model,
    inputs,
    modelKpis,
    modelAreas,
    modelCosts,
    modelRevenue,
    capitalStack,
    scenarios,
    assetClass,
    assetClassLabel: getAssetClassLabel(assetClass),
    isIncome: isIncomeAsset(assetClass),
    isLandLed: isLandLedAsset(assetClass),
    dealTypeLabel: getDealTypeLabel(deal.deal_type),
    dealStructureLabel: getDealStructureLabel(deal.deal_structure),
    stageLabel: STAGE_LABELS[deal.stage] || humanize(deal.stage) || 'Stage not provided',
    priorityLabel: PRIORITY_LABELS[deal.priority] || humanize(deal.priority),
    propertyTitle: firstText(deal.property_name, deal.name) || 'Institutional Real Estate Opportunity',
    dealTitle: firstText(deal.name, deal.property_name) || 'Institutional Opportunity',
    locationLine: firstText([deal.city, deal.state].filter(Boolean).join(', '), deal.property_address, deal.city) || 'Location not provided',
    addressLine: firstText(deal.property_address, [deal.city, deal.state].filter(Boolean).join(', ')),
    coordinates:
      num(deal.property_lat) !== null && num(deal.property_lng) !== null
        ? `${num(deal.property_lat).toFixed(6)}, ${num(deal.property_lng).toFixed(6)}`
        : null,
    landAreaSqft,
    grossAreaSqft,
    saleableAreaSqft,
    carpetAreaSqft,
    leasableAreaSqft,
    benchmarkMedianRate,
    modelSellRate,
    baseRent,
    noi,
    exitValue,
    entryValue,
    yieldOnCost,
    irr,
    npv,
    equityMultiple,
    grossMargin,
    residualLandValue,
    totalCost,
    totalRevenue,
    valueGapCr: totalRevenue !== null && totalCost !== null ? totalRevenue - totalCost : null,
    askPrice,
    negotiatedPrice,
    commercialMarker,
    priceGapPct,
    readiness,
    approvalSummary,
    documentSummary,
    recommendations,
    cityBenchmarks,
    compRows,
    cashRows,
    sensitivityMatrix,
    scenarioRows,
    hasFinancialModel: !!(totalCost !== null || totalRevenue !== null || irr !== null || noi !== null),
    hasCashFlowSlide:
      cashRows.length >= 2
      || Array.isArray(sensitivityMatrix?.irrGrid) && sensitivityMatrix.irrGrid.length > 0
      || scenarioRows.length > 0,
    structureMismatch: hasStructureMismatch(deal),
    showStructureSlide:
      [
        deal.owner_name,
        deal.ownership_type,
        deal.land_ask_price_cr,
        deal.negotiated_price_cr,
        deal.deal_structure,
        deal.jv_split_developer_pct,
        deal.jv_split_landowner_pct,
      ].filter((value) => value !== null && value !== undefined && value !== '').length >= 3,
    showReadinessSlide:
      (exportContext.approvals?.items?.length || 0) > 0
      || (exportContext.dd?.items?.length || 0) > 0
      || (exportContext.documents?.items?.length || 0) > 0
      || (exportContext.risks?.items?.length || 0) > 0,
  };

  context.riskRows = buildRiskRows(context, exportContext);
  context.executivePoints = buildExecutiveSummaryPoints(context, exportContext);
  context.highlightCards = buildInvestmentHighlights(context, exportContext);
  context.marketObservations = buildMarketObservations(context, exportContext);
  context.assetNarrative = buildAssetNarrative(context, exportContext);
  context.counterpartyRows = buildCounterpartyRows(context);
  context.locationRows = buildLocationRows(context);
  context.assetDetailRows = buildAssetDetailRows(context);
  context.projectRows = buildProjectRows(context);
  context.approvalRows = buildApprovalRows(exportContext);
  context.diligenceRows = buildDiligenceRows(exportContext);
  context.financialRows = buildFinancialRows(context);
  context.financialCommentary = buildFinancialCommentary(context);
  context.transactionRows = buildTransactionRows(context, exportContext);
  context.transactionCommentary = buildTransactionCommentary(context);
  context.nextStepGroups = buildNextStepGroups(exportContext);
  context.slideManifest = buildSlideManifest(context);

  return context;
};

const setSlideDefaults = (slide) => {
  slide.background = { color: COLORS.paper };
};

const addTopHeader = (pptx, slide, context, title, pageNumber, totalSlides, subtitle = '') => {
  setSlideDefaults(slide);
  slide.addText(context.brandName, {
    x: 0.45, y: 0.28, w: 1.4, h: 0.18,
    fontFace: FONT, fontSize: 8, bold: true, color: COLORS.plum, charSpace: 1.5,
  });
  slide.addText(title, {
    x: 0.45, y: 0.52, w: 8.6, h: 0.4,
    fontFace: FONT, fontSize: 22, bold: true, color: COLORS.charcoal,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 8.85, y: 0.3, w: 3.95, h: 0.2,
      fontFace: FONT, fontSize: 8, color: COLORS.muted, align: 'right',
    });
  }
  slide.addText(`${pageNumber} / ${totalSlides}`, {
    x: 12.1, y: 0.58, w: 0.7, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.plum, align: 'right',
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.45, y: 0.98, w: 12.35, h: 0,
    line: { color: COLORS.sandDeep, pt: 1 },
  });
  slide.addText(`Generated ${formatDate(context.generatedAt)} | ${context.brandName}`, {
    x: 0.45, y: 7.05, w: 4.6, h: 0.14,
    fontFace: FONT, fontSize: 7, color: COLORS.muted,
  });
};

const addCard = (pptx, slide, config) => {
  slide.addShape(pptx.ShapeType.rect, {
    x: config.x,
    y: config.y,
    w: config.w,
    h: config.h,
    fill: { color: config.fill || COLORS.white },
    line: { color: config.line || COLORS.line, pt: 0.8 },
  });
  if (config.bandColor) {
    slide.addShape(pptx.ShapeType.rect, {
      x: config.x,
      y: config.y,
      w: config.w,
      h: 0.08,
      fill: { color: config.bandColor },
      line: { color: config.bandColor, pt: 0.1 },
    });
  }
};

const addKpiCard = (pptx, slide, { x, y, w, h, label, value, tone = COLORS.plum, note = '' }) => {
  addCard(pptx, slide, { x, y, w, h, bandColor: tone });
  slide.addText(value || 'N/A', {
    x: x + 0.16, y: y + 0.26, w: w - 0.32, h: 0.34,
    fontFace: FONT, fontSize: 16, bold: true, color: COLORS.charcoal, align: 'center', fit: 'shrink',
  });
  slide.addText(label, {
    x: x + 0.16, y: y + h - 0.34, w: w - 0.32, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.muted, align: 'center',
  });
  if (note) {
    slide.addText(note, {
      x: x + 0.16, y: y + 0.64, w: w - 0.32, h: 0.16,
      fontFace: FONT, fontSize: 7, color: COLORS.muted, align: 'center', fit: 'shrink',
    });
  }
};

const addBulletList = (slide, items, { x, y, w, h, fontSize = 11, color = COLORS.charcoal, bulletColor = COLORS.plum }) => {
  const totalItems = items.length || 1;
  const rowHeight = h / totalItems;
  items.forEach((item, index) => {
    const top = y + index * rowHeight;
    slide.addShape('ellipse', {
      x,
      y: top + 0.05,
      w: 0.12,
      h: 0.12,
      fill: { color: bulletColor },
      line: { color: bulletColor, pt: 0.1 },
    });
    slide.addText(item, {
      x: x + 0.22,
      y: top,
      w: w - 0.22,
      h: Math.max(0.28, rowHeight - 0.04),
      fontFace: FONT,
      fontSize,
      color,
      fit: 'shrink',
      valign: 'mid',
      margin: 0,
    });
  });
};

const addTable = (slide, rows, options) => {
  slide.addTable(rows, {
    fontFace: FONT,
    fontSize: options.fontSize || 9,
    color: COLORS.charcoal,
    border: { type: 'solid', color: COLORS.line, pt: 0.6 },
    fill: COLORS.white,
    x: options.x,
    y: options.y,
    w: options.w,
    h: options.h,
    rowH: options.rowH,
    colW: options.colW,
    margin: options.margin || 0.06,
    valign: 'mid',
  });
};

const addSectionDivider = (pptx, slide, context, title, subtitle, pageNumber, totalSlides) => {
  setSlideDefaults(slide);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 7.5,
    fill: { color: COLORS.paper },
    line: { color: COLORS.paper, pt: 0.1 },
  });

  for (let idx = 0; idx < 8; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 7 + (idx * 0.72),
      y: 0.55,
      w: 0,
      h: 6.2,
      line: { color: idx % 2 === 0 ? COLORS.cloud : COLORS.line, pt: 0.4 },
    });
  }

  for (let idx = 0; idx < 7; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 6.9,
      y: 0.8 + (idx * 0.8),
      w: 5.8,
      h: 0,
      line: { color: idx % 2 === 0 ? COLORS.cloud : COLORS.line, pt: 0.4 },
    });
  }

  slide.addShape(pptx.ShapeType.ellipse, {
    x: 9.3, y: 2.1, w: 2.1, h: 2.1,
    fill: { color: 'F6EFE6', transparency: 65 },
    line: { color: COLORS.sandDeep, pt: 1.2, transparency: 25 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 9.8, y: 2.6, w: 1.1, h: 1.1,
    fill: { color: COLORS.plum, transparency: 10 },
    line: { color: COLORS.plum, pt: 0.8 },
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 1.45, w: 4.9, h: 3.55,
    fill: { color: COLORS.sand },
    line: { color: COLORS.sandDeep, pt: 0.1 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 1.45, w: 0.22, h: 3.55,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.1 },
  });
  slide.addText(title, {
    x: 1.2, y: 2.05, w: 4.1, h: 0.82,
    fontFace: FONT, fontSize: 26, bold: true, color: COLORS.charcoal, fit: 'shrink',
  });
  slide.addText(subtitle, {
    x: 1.2, y: 3.22, w: 4.0, h: 0.56,
    fontFace: FONT, fontSize: 11, color: COLORS.charcoal, fit: 'shrink',
  });
  slide.addText(context.locationLine, {
    x: 1.2, y: 4.32, w: 4.1, h: 0.22,
    fontFace: FONT, fontSize: 8, color: COLORS.plum, bold: true, charSpace: 0.8,
  });
  slide.addText(`${pageNumber} / ${totalSlides}`, {
    x: 12.1, y: 7.05, w: 0.7, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.plum, align: 'right',
  });
};

const renderCover = (pptx, slide, context, totalSlides) => {
  setSlideDefaults(slide);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 7.5,
    fill: { color: COLORS.paper },
    line: { color: COLORS.paper, pt: 0.1 },
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.65, w: 5.8, h: 5.45,
    fill: { color: COLORS.sand },
    line: { color: COLORS.sandDeep, pt: 0.2 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.65, w: 0.28, h: 5.45,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.1 },
  });

  for (let idx = 0; idx < 11; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 6.95 + idx * 0.55,
      y: 0.6,
      w: 0,
      h: 6.05,
      line: { color: idx % 2 === 0 ? COLORS.cloud : COLORS.line, pt: 0.4 },
    });
  }
  for (let idx = 0; idx < 8; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 6.75,
      y: 0.85 + idx * 0.78,
      w: 5.8,
      h: 0,
      line: { color: idx % 2 === 0 ? COLORS.cloud : COLORS.line, pt: 0.4 },
    });
  }
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 9.15, y: 2.0, w: 2.55, h: 2.55,
    fill: { color: 'F6EFE6', transparency: 68 },
    line: { color: COLORS.sandDeep, pt: 1.3, transparency: 25 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 9.93, y: 2.78, w: 0.98, h: 0.98,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.2 },
  });

  slide.addText(context.brandName, {
    x: 0.98, y: 0.95, w: 1.8, h: 0.18,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.plum, charSpace: 1.8,
  });
  slide.addText(context.dealTitle, {
    x: 0.98, y: 1.55, w: 4.95, h: 1.22,
    fontFace: FONT, fontSize: 28, bold: true, color: COLORS.charcoal, fit: 'shrink',
  });
  slide.addText(`${context.assetClassLabel} | ${context.dealTypeLabel}`, {
    x: 0.98, y: 3.0, w: 4.7, h: 0.22,
    fontFace: FONT, fontSize: 11, color: COLORS.plum, bold: true,
  });
  slide.addText(context.locationLine, {
    x: 0.98, y: 3.28, w: 4.8, h: 0.3,
    fontFace: FONT, fontSize: 12, color: COLORS.charcoal,
  });
  slide.addText(`Generated ${formatDate(context.generatedAt)}`, {
    x: 0.98, y: 5.62, w: 2.2, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.muted,
  });

  const coverCards = [
    { label: context.isIncome ? 'NOI / Base Rent' : 'IRR', value: context.isIncome ? (formatCrores(context.noi) || formatRent(context.baseRent)) : formatPct(context.irr), tone: COLORS.plum },
    { label: context.isIncome ? 'Exit Value' : 'NPV', value: context.isIncome ? formatCrores(context.exitValue) : formatCrores(context.npv), tone: COLORS.plum },
    { label: context.isIncome ? 'Yield / Exit Cap' : 'Revenue / Value', value: context.isIncome ? (formatPct(context.yieldOnCost) || formatPct(context.inputs.exitCapRate, 2)) : formatCrores(firstNumber(context.totalRevenue, context.exitValue)), tone: COLORS.sandDeep },
    { label: 'Execution Readiness', value: context.readiness.readiness_pct != null ? `${context.readiness.readiness_pct}%` : 'N/A', tone: COLORS.sandDeep },
  ];

  coverCards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 0.98 + index * 1.36,
      y: 4.18,
      w: 1.22,
      h: 1.18,
      label: card.label,
      value: card.value || 'N/A',
      tone: card.tone,
    });
  });

  slide.addText(`${totalSlides} editable slides | Internal investment material`, {
    x: 10.0, y: 6.72, w: 2.7, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.muted, align: 'right',
  });
};

const renderContents = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Contents', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.locationLine}`);

  addCard(pptx, slide, { x: 0.55, y: 1.3, w: 6.05, h: 5.2, bandColor: COLORS.plum });
  slide.addText('Deck Architecture', {
    x: 0.78, y: 1.52, w: 2.3, h: 0.2,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });

  const groups = [];
  let currentGroup = null;
  context.slideManifest.forEach((slideDef) => {
    if (slideDef.key.startsWith('divider')) {
      currentGroup = { title: slideDef.title, items: [] };
      groups.push(currentGroup);
      return;
    }
    if (!currentGroup) {
      currentGroup = { title: 'Deck Overview', items: [] };
      groups.push(currentGroup);
    }
    if (slideDef.key !== 'cover' && slideDef.key !== 'contents' && slideDef.key !== 'disclaimer') {
      currentGroup.items.push(slideDef.title);
    }
  });

  groups.slice(0, 4).forEach((group, index) => {
    const y = 1.95 + index * 1.17;
    slide.addText(group.title, {
      x: 0.82, y, w: 2.0, h: 0.18,
      fontFace: FONT, fontSize: 10, bold: true, color: COLORS.plum,
    });
    slide.addText(group.items.slice(0, 3).join(' | '), {
      x: 2.1, y: y - 0.01, w: 4.1, h: 0.28,
      fontFace: FONT, fontSize: 9, color: COLORS.charcoal, fit: 'shrink',
    });
  });

  addCard(pptx, slide, {
    x: 6.95,
    y: 1.3,
    w: 5.83,
    h: 5.2,
    bandColor: COLORS.sandDeep,
    fill: COLORS.white,
  });
  slide.addText('Current Decision Frame', {
    x: 7.22, y: 1.52, w: 2.6, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, [
    `${context.dealTypeLabel} opportunity in ${context.locationLine}.`,
    context.recommendations?.label
      ? `Current underwriting call: ${context.recommendations.label}.`
      : 'Current underwriting call is not yet stored.',
    context.readiness.readiness_pct != null
      ? context.approvalSummary.required
        ? `Readiness stands at ${context.readiness.readiness_pct}%, with ${context.approvalSummary.validated || 0}/${context.approvalSummary.required || 0} required approvals validated.`
        : `Readiness stands at ${context.readiness.readiness_pct}%, and required approvals have not yet been fully tagged in REDIP.`
      : 'Readiness inputs are not yet complete.',
    context.structureMismatch
      ? 'Commercial form needs confirmation because the stored deal type and structure do not align.'
      : `Deck covers ${totalSlides - 2} working slides across opportunity, market, asset, and transaction considerations.`,
  ], {
    x: 7.22,
    y: 1.95,
    w: 5.0,
    h: 2.25,
    fontSize: 9.5,
    bulletColor: COLORS.sandDeep,
  });
};

const renderExecutiveSummary = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Executive Summary', pageNumber, totalSlides, `${context.stageLabel} | ${context.locationLine}`);

  addCard(pptx, slide, { x: 0.55, y: 1.25, w: 7.08, h: 5.55, bandColor: COLORS.plum });
  slide.addText('Investment Facts', {
    x: 0.82, y: 1.47, w: 2.0, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.executivePoints, {
    x: 0.82,
    y: 1.9,
    w: 6.4,
    h: 3.9,
    fontSize: 10.5,
  });

  addCard(pptx, slide, { x: 7.9, y: 1.25, w: 4.88, h: 3.65, bandColor: COLORS.sandDeep });
  const cards = [
    { label: context.isIncome ? 'NOI / Base Rent' : 'IRR', value: context.isIncome ? (formatCrores(context.noi) || formatRent(context.baseRent)) : formatPct(context.irr), tone: COLORS.plum },
    { label: context.isIncome ? 'Exit Value' : 'NPV', value: context.isIncome ? formatCrores(context.exitValue) : formatCrores(context.npv), tone: COLORS.plum },
    { label: context.isIncome ? 'Yield / Exit Cap' : 'Margin', value: context.isIncome ? (formatPct(context.yieldOnCost) || formatPct(context.inputs.exitCapRate, 2)) : formatPct(context.grossMargin), tone: COLORS.sandDeep },
    { label: 'Ask / Marker', value: formatCrores(context.commercialMarker), tone: COLORS.sandDeep },
    { label: 'Readiness', value: context.readiness.readiness_pct != null ? `${context.readiness.readiness_pct}%` : 'N/A', tone: COLORS.plumSoft },
    { label: 'Open Risks', value: String(Math.max(num(context.exportContext?.risks?.summary?.total) || 0, context.riskRows.length || 0)), tone: COLORS.plumSoft },
  ];
  cards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 8.18 + (index % 2) * 2.26,
      y: 1.62 + Math.floor(index / 2) * 0.96,
      w: 1.98,
      h: 0.82,
      label: card.label,
      value: card.value || 'N/A',
      tone: card.tone,
    });
  });

  addCard(pptx, slide, { x: 7.9, y: 5.1, w: 4.88, h: 1.7, bandColor: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green });
  slide.addText('Current Recommendation', {
    x: 8.18, y: 5.34, w: 2.1, h: 0.16,
    fontFace: FONT, fontSize: 10, bold: true, color: COLORS.charcoal,
  });
  slide.addText((context.recommendations.label || 'Proceed With Conditions').toUpperCase(), {
    x: 8.18, y: 5.65, w: 4.2, h: 0.24,
    fontFace: FONT, fontSize: 16, bold: true, color: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
  });
  slide.addText(context.recommendations.reason || 'Current recommendation is based on the stored underwriting and diligence stack.', {
    x: 8.18, y: 6.02, w: 4.18, h: 0.42,
    fontFace: FONT, fontSize: 8.5, color: COLORS.charcoal, fit: 'shrink',
  });
};

const renderInvestmentHighlights = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Key Investment Highlights', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.locationLine}`);

  const cards = context.highlightCards.length
    ? context.highlightCards
    : [{ title: 'Deal context', detail: 'Stored REDIP data is currently limited, so the highlight set will expand as approvals, comps, and underwriting inputs are added.' }];

  cards.forEach((card, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.55 + col * 6.18;
    const y = 1.32 + row * 1.72;
    addCard(pptx, slide, {
      x,
      y,
      w: 5.95,
      h: 1.42,
      bandColor: row % 2 === 0 ? COLORS.plum : COLORS.sandDeep,
      fill: row % 2 === 0 ? COLORS.white : COLORS.mist,
    });
    slide.addText(card.title, {
      x: x + 0.22, y: y + 0.22, w: 5.2, h: 0.18,
      fontFace: FONT, fontSize: 11, bold: true, color: COLORS.charcoal,
    });
    slide.addText(card.detail, {
      x: x + 0.22, y: y + 0.52, w: 5.35, h: 0.58,
      fontFace: FONT, fontSize: 9.5, color: COLORS.charcoal, fit: 'shrink',
    });
  });
};

const renderStructure = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Structure & Counterparty', pageNumber, totalSlides, `${context.dealStructureLabel} | ${context.stageLabel}`);

  addCard(pptx, slide, { x: 0.55, y: 1.3, w: 6.1, h: 5.3, bandColor: COLORS.plum });
  slide.addText('Counterparty & Ownership', {
    x: 0.82, y: 1.52, w: 2.6, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  context.counterpartyRows.slice(0, 9).forEach((row, index) => {
    const y = 1.92 + index * 0.44;
    slide.addText(row.label, {
      x: 0.82, y, w: 1.8, h: 0.16,
      fontFace: FONT, fontSize: 8.5, color: COLORS.muted,
    });
    slide.addText(row.value, {
      x: 2.72, y: y - 0.01, w: 3.5, h: 0.2,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.charcoal, fit: 'shrink',
    });
  });

  addCard(pptx, slide, { x: 6.95, y: 1.3, w: 5.83, h: 2.15, bandColor: COLORS.sandDeep, fill: COLORS.mist });
  slide.addText('Commercial Markers', {
    x: 7.22, y: 1.52, w: 2.2, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, [
    context.askPrice !== null
      ? `Recorded ask or entry marker: ${formatCrores(context.askPrice)}.`
      : context.entryValue !== null
        ? `Recorded entry value marker: ${formatCrores(context.entryValue)}.`
        : 'Entry pricing has not yet been recorded.',
    context.negotiatedPrice !== null ? `Negotiation marker currently sits at ${formatCrores(context.negotiatedPrice)}.` : 'Negotiated pricing is not yet stored.',
    context.structureMismatch
      ? `Stored deal type (${context.dealTypeLabel}) and structure (${context.dealStructureLabel}) do not currently align and should be reconciled.`
      : isStructuredDeal(context.deal.deal_structure)
      ? 'Structure requires partner-level economics and downside protections to be locked before close.'
      : 'Structure currently reads as a direct purchase, which simplifies execution if diligence clears.',
  ], {
    x: 7.22,
    y: 1.93,
    w: 5.05,
    h: 1.1,
    fontSize: 9.6,
    bulletColor: COLORS.sandDeep,
  });
};

const renderMarketPositioning = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, context.cityBenchmarks.length ? 'City Benchmarking' : 'Market Positioning', pageNumber, totalSlides, `${context.deal.city || 'City'} | verified pricing context`);

  const benchmarkSeries = context.cityBenchmarks.length
    ? context.cityBenchmarks.map((row) => ({
        label: truncate(row.micro_market, 22),
        value: midpoint(row.avg_price_min_per_sqft, row.avg_price_max_per_sqft),
      })).filter((row) => row.value !== null)
    : context.compRows.map((row) => ({
        label: truncate(row.project_name || row.locality || 'Comparable', 22),
        value: num(row.rate_per_sqft),
      })).filter((row) => row.value !== null);

  if (benchmarkSeries.length >= 2) {
    slide.addChart(pptx.ChartType.bar, [{
      name: 'Verified market context',
      labels: benchmarkSeries.map((row) => row.label),
      values: benchmarkSeries.map((row) => row.value),
    }], {
      x: 0.55, y: 1.3, w: 6.2, h: 3.85,
      barDir: 'bar',
      chartColors: [COLORS.plum, COLORS.sandDeep, COLORS.blue, COLORS.green, COLORS.amber],
      showValue: true,
      dataLabelFontSize: 8,
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 8,
      legendPos: 'none',
      title: context.cityBenchmarks.length ? 'Verified Benchmark Nodes (mid-point pricing)' : 'Verified Comparable Rates',
      titleFontFace: FONT,
      titleFontSize: 10,
    });
  } else {
    addCard(pptx, slide, { x: 0.55, y: 1.3, w: 6.2, h: 3.85, bandColor: COLORS.plum });
    slide.addText('Verified market pricing context is still limited for this deal.', {
      x: 0.9, y: 2.8, w: 5.5, h: 0.34,
      fontFace: FONT, fontSize: 12, italic: true, color: COLORS.charcoal, align: 'center',
    });
  }

  addCard(pptx, slide, { x: 6.95, y: 1.3, w: 5.83, h: 5.2, bandColor: COLORS.sandDeep, fill: COLORS.white });
  slide.addText('Market Read-Through', {
    x: 7.22, y: 1.54, w: 2.4, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.marketObservations, {
    x: 7.22,
    y: 1.95,
    w: 5.0,
    h: 1.3,
    fontSize: 9.5,
    bulletColor: COLORS.sandDeep,
  });
};

const renderLocationContext = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Location & Site Context', pageNumber, totalSlides, `${context.locationLine}`);

  addCard(pptx, slide, { x: 0.55, y: 1.25, w: 5.7, h: 5.55, bandColor: COLORS.plum, fill: COLORS.mist });
  for (let idx = 0; idx < 7; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.95 + idx * 0.7,
      y: 1.65,
      w: 0,
      h: 4.5,
      line: { color: COLORS.line, pt: 0.4 },
    });
  }
  for (let idx = 0; idx < 6; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.88,
      y: 1.9 + idx * 0.72,
      w: 4.95,
      h: 0,
      line: { color: COLORS.line, pt: 0.4 },
    });
  }
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 2.42, y: 2.68, w: 1.7, h: 1.7,
    fill: { color: 'F5EBE2', transparency: 30 },
    line: { color: COLORS.sandDeep, pt: 1.1 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 2.97, y: 3.23, w: 0.6, h: 0.6,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.2 },
  });
  slide.addText('Site Pin', {
    x: 2.73, y: 4.6, w: 1.15, h: 0.16,
    fontFace: FONT, fontSize: 8, bold: true, color: COLORS.plum, align: 'center',
  });
  slide.addText(context.coordinates || 'Coordinates not provided', {
    x: 1.1, y: 5.3, w: 4.55, h: 0.24,
    fontFace: FONT, fontSize: 9, color: COLORS.charcoal, align: 'center',
  });

  addCard(pptx, slide, { x: 6.55, y: 1.25, w: 6.23, h: 5.55, bandColor: COLORS.sandDeep });
  slide.addText('Known Site Facts', {
    x: 6.82, y: 1.48, w: 2.4, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  context.locationRows.slice(0, 8).forEach((row, index) => {
    const y = 1.9 + index * 0.49;
    slide.addText(row.label, {
      x: 6.82, y, w: 1.6, h: 0.16,
      fontFace: FONT, fontSize: 8.5, color: COLORS.muted,
    });
    slide.addText(row.value, {
      x: 8.6, y: y - 0.01, w: 3.8, h: 0.2,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.charcoal, fit: 'shrink',
    });
  });
};

const renderAssetSnapshot = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Asset Snapshot', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.locationLine}`);

  const topCards = [
    { label: 'Land Area', value: formatArea(context.landAreaSqft) || 'N/A', tone: COLORS.plum },
    { label: context.isIncome ? 'Leasable Area' : 'Gross Area', value: context.isIncome ? formatArea(context.leasableAreaSqft) || 'N/A' : formatArea(context.grossAreaSqft) || 'N/A', tone: COLORS.plum },
    { label: context.isIncome ? 'Base Rent' : 'Saleable Area', value: context.isIncome ? formatRent(context.baseRent) || 'N/A' : formatArea(context.saleableAreaSqft) || 'N/A', tone: COLORS.sandDeep },
    { label: 'Circle / Pricing', value: formatRate(firstNumber(context.deal.circle_rate_per_sqft, context.modelSellRate)) || 'N/A', tone: COLORS.sandDeep },
  ];
  topCards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 0.55 + index * 3.06,
      y: 1.25,
      w: 2.82,
      h: 1.05,
      label: card.label,
      value: card.value,
      tone: card.tone,
    });
  });

  const leftRows = [
    [
      { text: 'Asset Facts', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Value', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
    ],
    ...context.assetDetailRows.slice(0, 8).map((row, index) => [
      { text: row.label, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
      { text: row.value, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
    ]),
  ];
  addTable(slide, leftRows, {
    x: 0.55,
    y: 2.6,
    w: 6.2,
    colW: [2.0, 4.2],
    rowH: 0.4,
  });

  const rightRows = [
    [
      { text: 'Project Facts', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
      { text: 'Value', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
    ],
    ...context.projectRows.slice(0, 8).map((row, index) => [
      { text: row.label, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
      { text: row.value, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
    ]),
  ];
  addTable(slide, rightRows, {
    x: 6.92,
    y: 2.6,
    w: 5.86,
    colW: [1.95, 3.91],
    rowH: 0.4,
  });
};

const renderReadiness = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, context.isIncome ? 'Diligence & Operating Readiness' : 'Development Readiness', pageNumber, totalSlides, `${context.stageLabel} | execution preparedness`);

  const readinessCards = [
    { label: 'Readiness', value: context.readiness.readiness_pct != null ? `${context.readiness.readiness_pct}%` : 'N/A', tone: COLORS.plum },
    { label: 'DD Complete', value: context.readiness.dd_completion_pct != null ? `${context.readiness.dd_completion_pct}%` : 'N/A', tone: COLORS.plumSoft },
    { label: 'Approvals', value: context.approvalSummary.required ? `${context.approvalSummary.validated}/${context.approvalSummary.required}` : 'N/A', tone: COLORS.sandDeep },
    { label: 'Linked Docs', value: String(context.documentSummary.total || 0), tone: COLORS.sandDeep },
  ];
  readinessCards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 0.55 + index * 3.06,
      y: 1.25,
      w: 2.82,
      h: 1.0,
      label: card.label,
      value: card.value,
      tone: card.tone,
    });
  });

  const approvalTableRows = context.approvalRows.length
    ? [
        [
          { text: 'Approval', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
          { text: 'Status', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
          { text: 'Authority / Note', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
        ],
        ...context.approvalRows.slice(0, 5).map((row, index) => [
          { text: row.name, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
          { text: row.status, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2, bold: true, color: row.status === 'Validated' ? COLORS.green : row.status === 'Issue' ? COLORS.red : COLORS.amber, align: 'center' } },
          { text: [row.authority, row.note].filter(Boolean).join(' | ') || 'Not recorded', options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
        ]),
      ]
    : null;

  const diligenceTableRows = context.diligenceRows.length
    ? [
        [
          { text: 'Open Item', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
          { text: 'Severity', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
          { text: 'Status / Note', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
        ],
        ...context.diligenceRows.slice(0, 5).map((row, index) => [
          { text: row.item, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
          { text: row.severity, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2, bold: true, color: pickSeverityColor(String(row.severity || '').toLowerCase()), align: 'center' } },
          { text: [row.status, row.note].filter(Boolean).join(' | ') || 'Open item', options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
        ]),
      ]
    : null;

  if (approvalTableRows) {
    addTable(slide, approvalTableRows, {
      x: 0.55,
      y: 2.55,
      w: 6.15,
      colW: [2.2, 1.0, 2.95],
      rowH: 0.46,
    });
  } else {
    addCard(pptx, slide, { x: 0.55, y: 2.55, w: 6.15, h: 3.6, bandColor: COLORS.plum, fill: COLORS.white });
    slide.addText('Approval tracker has not yet been populated for this deal.', {
      x: 0.9, y: 4.05, w: 5.4, h: 0.28,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.charcoal, align: 'center',
    });
  }

  if (diligenceTableRows) {
    addTable(slide, diligenceTableRows, {
      x: 6.92,
      y: 2.55,
      w: 5.86,
      colW: [2.35, 1.0, 2.51],
      rowH: 0.46,
    });
  } else {
    addCard(pptx, slide, { x: 6.92, y: 2.55, w: 5.86, h: 3.6, bandColor: COLORS.sandDeep, fill: COLORS.white });
    slide.addText('No open diligence items are currently linked in REDIP.', {
      x: 7.25, y: 4.05, w: 5.15, h: 0.28,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.charcoal, align: 'center',
    });
  }
};

const renderFinancialOverview = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, context.isIncome ? 'Operating Economics' : 'Development Economics', pageNumber, totalSlides, `${context.assetClassLabel} | stored underwriting outputs`);

  const cards = context.isIncome
    ? [
        { label: 'NOI / Base Rent', value: formatCrores(context.noi) || formatRent(context.baseRent) || 'N/A', tone: COLORS.plum },
        { label: 'Yield / Exit Cap', value: formatPct(context.yieldOnCost) || formatPct(context.inputs.exitCapRate, 2) || 'N/A', tone: COLORS.plumSoft },
        { label: 'Exit Value', value: formatCrores(context.exitValue) || 'N/A', tone: COLORS.sandDeep },
        { label: 'DSCR / IRR', value: context.deal.dscr != null ? `${formatNumber(context.deal.dscr, 2)}x` : formatPct(context.irr) || 'N/A', tone: COLORS.sandDeep },
      ]
    : [
        { label: 'Total Cost', value: formatCrores(context.totalCost) || 'N/A', tone: COLORS.plum },
        { label: 'Revenue / Value', value: formatCrores(firstNumber(context.totalRevenue, context.exitValue)) || 'N/A', tone: COLORS.plumSoft },
        { label: 'IRR', value: formatPct(context.irr) || 'N/A', tone: COLORS.sandDeep },
        { label: 'Gross Margin', value: formatPct(context.grossMargin) || 'N/A', tone: COLORS.sandDeep },
      ];

  cards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 0.55 + index * 3.06,
      y: 1.25,
      w: 2.82,
      h: 1.0,
      label: card.label,
      value: card.value,
      tone: card.tone,
    });
  });

  const tableRows = [
    [
      { text: 'Line Item', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Current Stored Value', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
    ],
    ...context.financialRows.slice(0, 6).map((row, index) => [
      { text: row.label, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.4 } },
      { text: row.value, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.4 } },
    ]),
  ];
  addTable(slide, tableRows, {
    x: 0.55,
    y: 2.55,
    w: 6.2,
    colW: [2.3, 3.9],
    rowH: 0.44,
  });

  addCard(pptx, slide, {
    x: 6.95,
    y: 2.55,
    w: 5.83,
    h: 3.6,
    bandColor: COLORS.sandDeep,
    fill: COLORS.white,
  });
  slide.addText('Underwriting Read-Through', {
    x: 7.22, y: 2.78, w: 2.8, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.financialCommentary, {
    x: 7.22,
    y: 3.18,
    w: 5.05,
    h: 2.35,
    fontSize: 9.4,
    bulletColor: COLORS.sandDeep,
  });
};

const getHeatFill = (value) => {
  const numeric = num(value);
  if (numeric === null) return COLORS.white;
  if (numeric >= 20) return 'DCEBDD';
  if (numeric >= 15) return 'F4EAD1';
  return 'F5DCDC';
};

const renderCashFlowSensitivity = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Cash Flow & Sensitivity', pageNumber, totalSlides, `${context.assetClassLabel} | phasing and scenario range`);

  if (context.cashRows.length >= 2) {
    slide.addChart(pptx.ChartType.bar, [{
      name: 'Net cash flow',
      labels: context.cashRows.map((row, index) => truncate(row.label || `P${index + 1}`, 12)),
      values: context.cashRows.map((row) => num(row.net) || 0),
    }], {
      x: 0.55, y: 1.3, w: 6.4, h: 3.55,
      barDir: 'col',
      chartColors: [COLORS.plum],
      showValue: true,
      dataLabelFontSize: 8,
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 8,
      legendPos: 'none',
      title: 'Modeled Net Cash Flow',
      titleFontFace: FONT,
      titleFontSize: 10,
    });
  }

  const hasSensitivity = Array.isArray(context.sensitivityMatrix?.irrGrid) && context.sensitivityMatrix.irrGrid.length > 0;
  if (hasSensitivity) {
    const sensitivityRows = [
      [
        { text: 'Cost \\ Price', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
        ...context.sensitivityMatrix.sellingRates.slice(0, 5).map((value) => ({
          text: formatNumber(value, 0) || 'N/A',
          options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum }, align: 'center', fontSize: 7.5 },
        })),
      ],
      ...context.sensitivityMatrix.irrGrid.slice(0, 5).map((row, rowIndex) => [
        { text: formatNumber(context.sensitivityMatrix.constructionCosts[rowIndex], 0) || 'N/A', options: { bold: true, fill: { color: COLORS.mist }, fontSize: 7.5 } },
        ...row.slice(0, 5).map((value) => ({
          text: value != null ? `${formatNumber(value, 1)}%` : 'N/A',
          options: { align: 'center', fill: { color: getHeatFill(value) }, fontSize: 7.5 },
        })),
      ]),
    ];
    addTable(slide, sensitivityRows, {
      x: 7.2,
      y: 1.3,
      w: 5.58,
      colW: [1.3, 0.86, 0.86, 0.86, 0.86, 0.84],
      rowH: 0.42,
    });
  }
};

const renderTransactionSummary = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Transaction Summary', pageNumber, totalSlides, `${context.dealTypeLabel} | ${context.dealStructureLabel}`);

  const tableRows = [
    [
      { text: 'Commercial Term', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Current Stored Value', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
    ],
    ...context.transactionRows.slice(0, 12).map((row, index) => [
      { text: row.label, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
      { text: row.value, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
    ]),
  ];
  addTable(slide, tableRows, {
    x: 0.55,
    y: 1.3,
    w: 6.35,
    colW: [2.25, 4.1],
    rowH: 0.39,
  });

  addCard(pptx, slide, {
    x: 7.15,
    y: 1.3,
    w: 5.63,
    h: 5.3,
    bandColor: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
    fill: COLORS.white,
  });
  slide.addText('Transaction Read-Through', {
    x: 7.42, y: 1.54, w: 2.8, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.transactionCommentary, {
    x: 7.42,
    y: 1.98,
    w: 4.95,
    h: 2.1,
    fontSize: 9.4,
    bulletColor: context.recommendations.tone === 'negative' ? COLORS.red : COLORS.sandDeep,
  });
  addKpiCard(pptx, slide, {
    x: 7.42,
    y: 4.58,
    w: 2.25,
    h: 1.12,
    label: 'Recommendation',
    value: (context.recommendations.label || 'Review').toUpperCase(),
    tone: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
  });
  addKpiCard(pptx, slide, {
    x: 10.0,
    y: 4.58,
    w: 2.25,
    h: 1.12,
    label: 'Revenue Less Cost',
    value: context.valueGapCr != null ? formatCrores(context.valueGapCr) || 'N/A' : 'N/A',
    tone: context.valueGapCr != null && context.valueGapCr < 0 ? COLORS.red : COLORS.green,
  });
};

const renderRisksMitigants = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Risks & Mitigants', pageNumber, totalSlides, `${context.stageLabel} | current live issue stack`);

  const riskRows = context.riskRows.length
    ? context.riskRows
    : [{ severity: 'Low', title: 'No open risks recorded', detail: 'The live risk register does not currently contain any open or flagged items.', fill: COLORS.green }];

  const tableRows = [
    [
      { text: 'Severity', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Risk', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Current Mitigant / Read-Through', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
    ],
    ...riskRows.slice(0, 5).map((row, index) => [
      { text: row.severity, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2, color: row.fill, bold: true, align: 'center' } },
      { text: row.title, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
      { text: row.detail, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
    ]),
  ];
  addTable(slide, tableRows, {
    x: 0.55,
    y: 1.3,
    w: 8.1,
    colW: [1.1, 2.4, 4.6],
    rowH: 0.44,
  });

  addCard(pptx, slide, {
    x: 8.95,
    y: 1.3,
    w: 3.83,
    h: 5.2,
    bandColor: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
    fill: COLORS.white,
  });
  slide.addText('Decision Overlay', {
    x: 9.22, y: 1.54, w: 2.2, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  slide.addText((context.recommendations.label || 'Review').toUpperCase(), {
    x: 9.22, y: 1.95, w: 3.1, h: 0.28,
    fontFace: FONT, fontSize: 16, bold: true, color: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
  });
  slide.addText(context.recommendations.reason || 'Recommendation will update as risk and underwriting fields are refreshed.', {
    x: 9.22, y: 2.38, w: 3.05, h: 0.7,
    fontFace: FONT, fontSize: 8.7, color: COLORS.charcoal, fit: 'shrink',
  });
  addBulletList(slide, riskRows.slice(0, 3).map((row) => `${row.title}: ${row.detail}`), {
    x: 9.22,
    y: 3.32,
    w: 3.0,
    h: 2.4,
    fontSize: 8.6,
    bulletColor: context.recommendations.tone === 'negative' ? COLORS.red : COLORS.sandDeep,
  });
};

const renderNextSteps = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Next Steps', pageNumber, totalSlides, `${context.stageLabel} | action list from live readiness state`);

  const groups = context.nextStepGroups.length
    ? context.nextStepGroups
    : [{ group: 'Immediate Actions', items: ['Populate approvals, documents, and underwriting fields to unlock a fuller Investor-Grade deck.'] }];

  groups.forEach((group, index) => {
    const x = 0.55 + index * 4.12;
    addCard(pptx, slide, {
      x,
      y: 1.32,
      w: 3.84,
      h: 5.3,
      bandColor: index === 0 ? COLORS.plum : index === 1 ? COLORS.sandDeep : COLORS.plumSoft,
      fill: index === 1 ? COLORS.mist : COLORS.white,
    });
    slide.addText(group.group, {
      x: x + 0.24, y: 1.56, w: 3.1, h: 0.18,
      fontFace: FONT, fontSize: 11, bold: true, color: COLORS.charcoal,
    });
    addBulletList(slide, group.items, {
      x: x + 0.24,
      y: 1.98,
      w: 3.2,
      h: 3.9,
      fontSize: 9.3,
      bulletColor: index === 1 ? COLORS.sandDeep : COLORS.plum,
    });
  });
};

const renderDisclaimer = (pptx, slide, context, pageNumber, totalSlides) => {
  setSlideDefaults(slide);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 1.05, w: 11.73, h: 5.35,
    fill: { color: COLORS.mist },
    line: { color: COLORS.sandDeep, pt: 1 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 1.05, w: 0.26, h: 5.35,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.1 },
  });
  slide.addText('Disclaimer', {
    x: 1.28, y: 1.62, w: 2.4, h: 0.28,
    fontFace: FONT, fontSize: 24, bold: true, color: COLORS.charcoal,
  });
  slide.addText(`${context.brandName} | Generated for ${context.generatedFor} | ${formatDate(context.generatedAt)} | ${pageNumber} / ${totalSlides}`, {
    x: 1.28, y: 5.82, w: 10.5, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.muted, align: 'center',
  });
};

const renderSlide = (pptx, slide, context, slideDef, pageNumber, totalSlides) => {
  switch (slideDef.key) {
    case 'cover': renderCover(pptx, slide, context, totalSlides); return;
    case 'contents': renderContents(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerOpportunity': addSectionDivider(pptx, slide, context, 'The Opportunity', `${context.assetClassLabel} | ${context.dealTypeLabel}`, pageNumber, totalSlides); return;
    case 'executiveSummary': renderExecutiveSummary(pptx, slide, context, pageNumber, totalSlides); return;
    case 'investmentHighlights': renderInvestmentHighlights(pptx, slide, context, pageNumber, totalSlides); return;
    case 'structure': renderStructure(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerMarket': addSectionDivider(pptx, slide, context, 'Market / Micro-Market', `${context.deal.city || 'City'} | verified market context`, pageNumber, totalSlides); return;
    case 'marketPositioning': renderMarketPositioning(pptx, slide, context, pageNumber, totalSlides); return;
    case 'locationContext': renderLocationContext(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerAsset': addSectionDivider(pptx, slide, context, 'About the Asset', `${context.assetClassLabel} | site, title, and delivery context`, pageNumber, totalSlides); return;
    case 'assetSnapshot': renderAssetSnapshot(pptx, slide, context, pageNumber, totalSlides); return;
    case 'readiness': renderReadiness(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerFinancial': addSectionDivider(pptx, slide, context, 'Financial Summary', `${context.assetClassLabel} | current underwriting outputs`, pageNumber, totalSlides); return;
    case 'financialOverview': renderFinancialOverview(pptx, slide, context, pageNumber, totalSlides); return;
    case 'cashFlowSensitivity': renderCashFlowSensitivity(pptx, slide, context, pageNumber, totalSlides); return;
    case 'transactionSummary': renderTransactionSummary(pptx, slide, context, pageNumber, totalSlides); return;
    case 'risksMitigants': renderRisksMitigants(pptx, slide, context, pageNumber, totalSlides); return;
    case 'nextSteps': renderNextSteps(pptx, slide, context, pageNumber, totalSlides); return;
    case 'disclaimer': renderDisclaimer(pptx, slide, context, pageNumber, totalSlides); return;
    default: addTopHeader(pptx, slide, context, slideDef.title, pageNumber, totalSlides);
  }
};

const buildDealDeckPptx = async (exportContext, options = {}) => {
  const pptx = new PptxGenJS();
  const context = buildDeckContext(exportContext, options);

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = options.userName || 'REDIP';
  pptx.company = options.brandName || 'REDIP';
  pptx.subject = `${context.assetClassLabel} investment deck`;
  pptx.title = `${context.dealTitle} | ${context.assetClassLabel}`;
  pptx.lang = 'en-IN';

  const totalSlides = context.slideManifest.length;
  context.slideManifest.forEach((slideDef, index) => {
    const slide = pptx.addSlide();
    renderSlide(pptx, slide, context, slideDef, index + 1, totalSlides);
  });

  return pptx.write({ outputType: 'nodebuffer' });
};

module.exports = {
  buildDealDeckPptx,
  __testables: {
    buildDeckContext,
    buildSlideManifest,
    buildExecutiveSummaryPoints,
    buildInvestmentHighlights,
  },
};
