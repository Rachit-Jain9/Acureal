'use strict';

/**
 * Content row + commentary builders for the PPTX deal-deck pipeline.
 *
 * Each `buildXxxRows`/`buildXxxCommentary`/`buildXxxPoints` function takes
 * the merged deal+kpis+market context (and sometimes the raw exportContext)
 * and returns a typed shape ready to render. Slide renderers consume these
 * via the `context.slideManifest` data plumbed by deckContext.
 *
 * Extracted from the original dealPptx.service.js as part of the Bet 3
 * god-service decomposition.
 */

const {
  COLORS,
  ASSET_CLASS_LABELS,
  STAGE_LABELS,
  PRIORITY_LABELS,
  INCOME_ASSETS,
  LAND_LED_ASSETS,
  num,
  firstNumber,
  positiveNumber,
  firstText,
  humanize,
  formatNumber,
  formatCrores,
  formatPct,
  formatArea,
  formatRate,
  formatRent,
  formatDate,
  truncate,
  pickSeverityColor,
  resolveStatusText,
  dedupeByTitle,
  severityRank,
  hasStructureMismatch,
  getAssetClassLabel,
  getDealTypeLabel,
  getDealStructureLabel,
  isIncomeAsset,
  isLandLedAsset,
  isStructuredDeal,
  midpoint,
  filterRows,
} = require('./_helpers');

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
    return ['Stored financial outputs are incomplete, so the economics slide is intentionally limited to available Acureal fields.'];
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
    observations.push('Verified city benchmark or comparable data has not been fully linked for this deal, so market commentary is intentionally limited to stored Acureal records.');
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


// Planning Intelligence rows — pulls the city-level callouts (SDZ, NGT,
// heritage, PRR) from the master-plan service feed surfaced on the
// `exportContext.planning` payload. Falls back to a "no data" row when
// the master-plan corpus has not been ingested yet so the slide still
// renders predictably.
const buildPlanningRows = (exportContext) => {
  const planning = exportContext?.planning || {};
  const callouts = Array.isArray(planning.callouts) ? planning.callouts : [];
  const find = (predicate) => callouts.find(predicate)?.value;

  const sdz = find((c) => c.key === 'special_development_zones');
  const ngt = find((c) => c.key === 'ngt_drainage_classification');
  const heritage = find((c) => c.key === 'heritage_zones');
  const prr = find((c) => c.key === 'peripheral_ring_road');

  const rows = [];
  if (sdz) {
    rows.push({
      label: 'Special Development Zones',
      value: `${sdz.count ?? '—'} corridors${sdz.max_far ? ` • max FAR ${sdz.max_far}` : ''}`,
      hint: Array.isArray(sdz.locations) ? sdz.locations.slice(0, 3).join(', ') : null,
    });
  }
  if (ngt) {
    rows.push({
      label: 'NGT drain buffers',
      value: `Primary ${ngt.buffer_m_primary}m • Secondary ${ngt.buffer_m_secondary}m • Tertiary ${ngt.buffer_m_tertiary}m`,
      hint: ngt.source || 'NGT classification',
    });
  }
  if (heritage) {
    rows.push({
      label: 'Heritage zones',
      value: `${heritage.count ?? '—'} delineated • prohibited ${heritage.prohibited_radius_m}m`,
      hint: heritage.regulated_radius_m ? `Regulated radius ${heritage.regulated_radius_m}m` : null,
    });
  }
  if (prr) {
    rows.push({
      label: 'Peripheral Ring Road',
      value: `${prr.width_m}m corridor • ${prr.type}`,
      hint: prr.note || null,
    });
  }
  return rows;
};

// Planning Intelligence narrative — short bullets that sit above the
// callout grid. Emphasises that every number is traceable + AI-extracted
// (must be reconciled before quoting in IC). Length-capped for slide layout.
const buildPlanningCommentary = (exportContext) => {
  const planning = exportContext?.planning || {};
  const callouts = Array.isArray(planning.callouts) ? planning.callouts : [];
  if (!callouts.length) {
    return [
      'RMP 2031 is a withdrawn draft (provisional approval withdrawn July 2020) — descriptive reference only, not an operative source. The operative plan is RMP 2015.',
      'Once the RMP 2031 reference maps and Volume 4 PDR are ingested, this slide surfaces its draft SDZ corridors, NGT drain buffers, heritage radii, and Peripheral Ring Road alignment — each page-cited, to be verified against primary records before quoting.',
    ];
  }
  const bullets = [
    `Drawn from ${callouts.length} RMP 2031 reference fact${callouts.length === 1 ? '' : 's'} (withdrawn draft, July 2020 — descriptive reference only, not operative). Each callout is page-cited; verify against primary records before quoting in IC.`,
    'Cross-reference each callout against the parcel\'s exact location before underwriting — heritage and NGT buffers can disqualify entire envelopes.',
  ];
  return bullets;
};

module.exports = {
  buildDerivedRiskRows,
  buildFinancialRows,
  buildFinancialCommentary,
  buildTransactionCommentary,
  buildExecutiveSummaryPoints,
  buildInvestmentHighlights,
  buildMarketObservations,
  buildAssetNarrative,
  buildCounterpartyRows,
  buildLocationRows,
  buildAssetDetailRows,
  buildProjectRows,
  buildApprovalRows,
  buildDiligenceRows,
  buildTransactionRows,
  buildRiskRows,
  buildNextStepGroups,
  buildPlanningRows,
  buildPlanningCommentary,
};
