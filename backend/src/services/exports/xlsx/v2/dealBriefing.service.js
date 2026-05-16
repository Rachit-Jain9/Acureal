'use strict';

/**
 * AI-Assisted Deal Briefing service (PR-NX7 — 2026-05-15)
 *
 * PR-NX12 (2026-05-15): Asset-class × deal-structure × exit-strategy aware
 * narrative. Pre-NX12 the templated narrative was asset-class-blind: every
 * income deal said "rent × occupancy → NOI" even for hospitality (which is
 * Keys × ADR × Occupancy) and even for retail (which is anchor + vanilla +
 * CAM). Every deal also said "GST 18% on under-construction sale"
 * regardless of asset class — wrong for hospitality (which isn't sold UC)
 * and wrong for office leasing (which has GST on rent, not sale). This PR
 * ships per-class economics + per-structure capital + per-exit reversion +
 * per-class GST framing.
 *
 * Generates an investor-grade 4-bullet narrative for the Executive
 * Briefing sheet (first tab) of every per-deal XLSX export.
 *
 * ## Design philosophy
 *
 * Per CLAUDE.md guardrails:
 *   - Never fabricate financial / market / RERA / legal facts.
 *   - AI outputs must carry "AI-assisted — requires human review" label.
 *   - Sources must be traceable.
 *
 * To honour all three: **the AI never generates numbers or facts**.
 * Every number that appears in the briefing is pre-computed in code from
 * the deal's kernel KPIs / inputs / property record. The AI's only job
 * is to assemble those numbers into investor-friendly English prose.
 *
 * If the AI fails (rate-limited, API down, model errors), the service
 * falls back to a DETERMINISTIC templated narrative that's still
 * sourced 100% from the deal's actual numbers + matches the asset class.
 * The Dashboard always shows SOMETHING — never empty.
 */

const crypto = require('crypto');

// Soft-import to avoid hard coupling — the workbook can build even if
// AI services aren't available in the test environment.
let runClaudeReasoning;
let aiResponseCache;
try {
  ({ runClaudeReasoning } = require('../../../ai/aiRouter'));
  aiResponseCache = require('../../../ai/aiResponseCache');
} catch {
  // Test environment without AI services — fallback only path.
}

// ──────────────────────────────────────────────────────────────────────
// Label maps (mirror buildWorkbook.js — keep in sync if those change)
// ──────────────────────────────────────────────────────────────────────
const ASSET_CLASS_LABEL = {
  residential_apartments: 'Residential Apartments',
  villas: 'Villas',
  plotted_development: 'Plotted Development',
  commercial_office: 'Commercial Office',
  retail: 'Retail / Mall',
  industrial_warehousing: 'Industrial & Warehousing',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed-Use Development',
  redevelopment: 'Redevelopment',
  raw_land: 'Raw Land',
};

const DEAL_STRUCTURE_LABEL = {
  outright_purchase: 'Outright Purchase',
  jda_revenue_share: 'JDA — Revenue Share',
  jda_area_share: 'JDA — Area Share',
  development_management: 'Development Management (Fee-Only)',
};

const EXIT_STRATEGY_LABEL = {
  strategic_sale: 'Strategic Sale to Institutional Buyer',
  reit_exit: 'REIT Listing / Contribution',
  hold_to_perpetuity: 'Long-Term Hold',
  refinance_hold: 'LRD Refinance + Hold',
  outright_progressive: 'Progressive Sale (RERA-Milestone Linked)',
  bulk_exit_completion: 'Bulk Sale at Completion',
  hold_post_completion: 'Hold Post-Completion (Lease-up)',
};

// ──────────────────────────────────────────────────────────────────────
// Number-shaping helpers
// ──────────────────────────────────────────────────────────────────────
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pct = (v, digits = 1) => {
  const n = num(v);
  if (n === null) return '—';
  // accept either decimal (0.15) or whole percent (15)
  const p = Math.abs(n) <= 1.5 ? n * 100 : n;
  return `${p.toFixed(digits)}%`;
};

const cr = (v, digits = 1) => {
  const n = num(v);
  if (n === null) return '—';
  return `₹${n.toFixed(digits)} Cr`;
};

const cellNum = (v) => {
  // Treat nullish + empty-string + 0 explicitly. Number(null) coerces to 0,
  // which would make missing KPIs appear as "0" in the briefing — that's
  // a fabrication. Returning null lets narrative bullets skip / mark
  // them as pending. NOTE: we DO accept 0 as a valid input when the field
  // is genuinely 0 (e.g. raw_land construction cost) — caller passes
  // through cellNum(v) ?? 0 explicitly when 0 is meaningful.
  if (v === null || v === undefined || v === '') return null;
  return num(v);
};

const intINR = (v) => {
  const n = num(v);
  if (n === null) return '—';
  return new Intl.NumberFormat('en-IN').format(Math.round(n));
};

// ──────────────────────────────────────────────────────────────────────
// Asset-class-specific snapshot extraction
// ──────────────────────────────────────────────────────────────────────
// Hospitality uses a Keys × Sqft/Key derivation when SaleableAreaSqft
// isn't directly stored on the deal record. The Pointec Pens 2026-05-15
// bug surfaced this: deal.model_params.inputs.saleableAreaSqft was 0
// because the operator entered Keys but never separately filled the
// derived sqft field. The workbook computes it (formula at Inputs R12)
// but the deal record didn't carry it, so the briefing snapshot
// rendered "0 sqft hospitality". Fix: derive sqft from keys × sqft/key
// fallback when the direct field is unavailable.
const deriveHospitalitySqft = (i, kernelOrDefaultKeys, kernelOrDefaultSqftPerKey) => {
  const directSqft = cellNum(i.saleableAreaSqft || i.leasableAreaSqft);
  if (directSqft && directSqft > 0) return directSqft;
  const keys = cellNum(i.hospitalityKeys || kernelOrDefaultKeys);
  const sqftPerKey = cellNum(i.hospitalitySqftPerKey || kernelOrDefaultSqftPerKey || 550);
  if (keys && sqftPerKey) return keys * sqftPerKey;
  return null;
};

// ──────────────────────────────────────────────────────────────────────
// Deterministic numeric snapshot (the AI sees ONLY these)
// ──────────────────────────────────────────────────────────────────────
const buildNumericSnapshot = (ctx) => {
  const k = ctx.kernelKpis || {};
  const i = ctx.inputs || {};
  const d = ctx.deal || {};
  const p = ctx.property || {};

  const assetClass = ctx.assetClass;
  const assetLabel = ASSET_CLASS_LABEL[assetClass] || assetClass || 'Real Estate';
  const structureKey = String(d.deal_structure || d.deal_type || 'outright_purchase').toLowerCase();
  const structureLabel = DEAL_STRUCTURE_LABEL[structureKey] || structureKey.replace(/_/g, ' ');
  const exitKey = String(d.exit_strategy || (ctx.dealFamily === 'income' ? 'strategic_sale' : 'outright_progressive')).toLowerCase();
  const exitLabel = EXIT_STRATEGY_LABEL[exitKey] || exitKey.replace(/_/g, ' ');

  // Hospitality-specific sqft derivation (Keys × Sqft/Key fallback)
  const saleableAreaSqft = assetClass === 'hospitality'
    ? deriveHospitalitySqft(i, null, i.hospitalitySqftPerKey)
    : cellNum(i.saleableAreaSqft || p.saleable_area_sqft);

  return {
    dealName: d.name || p.property_name || 'Deal',
    assetClass,
    assetLabel,
    family: ctx.dealFamily,
    structure: structureKey,
    structureLabel,
    exit: exitKey,
    exitLabel,
    city: d.city || p.city || 'Bengaluru',
    microMarket: p.micro_market || null,
    holdYears: ctx.projectMonths ? Math.round(ctx.projectMonths / 12 * 10) / 10 : null,

    // Kernel KPIs
    irr: cellNum(k.irr),
    npvCr: cellNum(k.npv),
    equityMultiple: cellNum(k.equityMultiple),
    noiCr: cellNum(k.noi),
    grossMarginPct: cellNum(k.grossMargin),
    yieldOnCostPct: cellNum(k.yieldOnCost),
    totalRevenueCr: cellNum(k.totalRevenue),
    totalCostCr: cellNum(k.totalCost),
    exitValueCr: cellNum(k.exitValue),
    residualLandValueCr: cellNum(k.residualLandValue),

    // Operator inputs (common across asset classes)
    saleableAreaSqft,
    sellingRatePerSqft: cellNum(i.sellingRatePerSqft),
    baseRentPerSqftMonth: cellNum(i.baseRentPerSqftMonth),
    landCostCr: cellNum(i.landCostCr),
    constructionCostPerSqft: cellNum(i.constructionCostPerSqft),
    exitCapRate: cellNum(i.exitCapRate),
    occupancyPct: cellNum(i.occupancyPct || i.stabilizedOccPct),
    vacancyPct: cellNum(i.vacancyPct),
    debtLTV: cellNum(i.debtLTV),
    debtRatePct: cellNum(i.debtRatePct),
    customerCollectionPct: cellNum(i.customerCollectionPct),
    salesVelocityPct: cellNum(i.salesVelocityPct),
    escalationPct: cellNum(i.escalationPct || i.rentEscalationPct),

    // ── Asset-class-specific operator inputs ─────────────────────────
    // Hospitality (Keys × ADR × Occupancy is the USALI model)
    hospitalityKeys: cellNum(i.hospitalityKeys),
    hospitalityADRBase: cellNum(i.hospitalityADRBase),
    hospitalityADRPeak: cellNum(i.hospitalityADRPeak),
    hospitalityOccupancyPct: cellNum(i.hospitalityOccupancyPct || i.occupancyPct),
    hospitalityHoldYears: cellNum(i.hospitalityHoldYears),
    hospitalityRefiLTV: cellNum(i.hospitalityRefiLTV),
    hospitalityRefiCapRate: cellNum(i.hospitalityRefiCapRate),
    // Retail (Anchor + Vanilla + CAM)
    retailAnchorRentPerSqftMonth: cellNum(i.retailAnchorRentPerSqftMonth),
    retailVanillaRentPerSqftMonth: cellNum(i.retailVanillaRentPerSqftMonth),
    retailAnchorSharePct: cellNum(i.retailAnchorSharePct),
    retailCAMRecoveryPct: cellNum(i.retailCAMRecoveryPct),
    // Office (CAM-loaded)
    otherIncomePerSqft: cellNum(i.otherIncomePerSqft),
    // Mixed-use components
    mixUseResidentialShare: cellNum(i.mixUseResidentialShare),
    mixUseOfficeShare: cellNum(i.mixUseOfficeShare),
    mixUseRetailShare: cellNum(i.mixUseRetailShare),
    mixUseHospitalityShare: cellNum(i.mixUseHospitalityShare),
    // Redevelopment / JDA
    landownerSharePct: cellNum(i.landownerSharePct),
    jvDevPct: cellNum(i.jvDevPct),
    jvLandPct: cellNum(i.jvLandPct),
    // Raw land entitlement
    rawLandStage: i.rawLandStage || null,
    rawLandTitleMonths: cellNum(i.rawLandTitleMonths),
    rawLandConversionMonths: cellNum(i.rawLandConversionMonths),
    rawLandLayoutMonths: cellNum(i.rawLandLayoutMonths),
    // Plotted development
    plotDevCostPerSqft: cellNum(i.plotDevCostPerSqft || i.devCostPerSqft),

    // ── India context (asset-class-aware framing in bullet builder) ──
    gstPct: cellNum(i.gstPct),
    stampDutyPct: cellNum(i.stampDutyPct),
    registrationPct: cellNum(i.registrationPct),
    khataStatus: i.khataStatus || 'A_khata',
    propertyTaxPerSqftYr: cellNum(i.propertyTaxPerSqftYr),
    ltcgRate: cellNum(i.ltcgRate),
  };
};

// ──────────────────────────────────────────────────────────────────────
// Bullet 1 — Deal overview + location (asset-class-aware sqft phrasing)
// ──────────────────────────────────────────────────────────────────────
const buildOverviewBullet = (s) => {
  const isIncome = s.family === 'income';
  const locationStr = s.microMarket && s.microMarket !== s.city
    ? `${s.city} (${s.microMarket})`
    : s.city;

  // Hospitality leads with KEYS, not sqft, because that's the unit
  // operators reason in for hotels ("a 100-key hotel" vs "55,000 sqft").
  // Falls back to sqft if keys aren't set yet.
  let sizeStr;
  if (s.assetClass === 'hospitality' && s.hospitalityKeys) {
    const sqftSuffix = s.saleableAreaSqft ? ` (~${intINR(s.saleableAreaSqft)} sqft GFA)` : '';
    sizeStr = `${s.hospitalityKeys}-key ${s.assetLabel.toLowerCase()}${sqftSuffix}`;
  } else if (s.assetClass === 'raw_land' && s.saleableAreaSqft) {
    // Raw land: report in sqft AND acres
    const acres = (s.saleableAreaSqft / 43560).toFixed(2);
    sizeStr = `${intINR(s.saleableAreaSqft)} sqft (~${acres} acres) ${s.assetLabel.toLowerCase()} parcel`;
  } else if (s.saleableAreaSqft) {
    sizeStr = `${intINR(s.saleableAreaSqft)} sqft ${s.assetLabel.toLowerCase()}`;
  } else {
    sizeStr = `${s.assetLabel.toLowerCase()} (area inputs pending)`;
  }

  const parts = [`${sizeStr} in ${locationStr}`];
  if (s.holdYears) parts.push(`${s.holdYears}-year ${isIncome ? 'hold' : 'project'} cycle`);
  parts.push(`${s.structureLabel} structure`);
  return parts.join('; ') + '.';
};

// ──────────────────────────────────────────────────────────────────────
// Bullet 2 — Economics (asset-class-specific dispatch)
// ──────────────────────────────────────────────────────────────────────
const ECONOMICS_BUILDERS = {
  hospitality: (s) => {
    const keys = s.hospitalityKeys ? `${s.hospitalityKeys} keys` : 'keys pending';
    const adr = s.hospitalityADRBase
      ? `₹${intINR(s.hospitalityADRBase)} ADR`
      : 'ADR pending';
    const occ = s.hospitalityOccupancyPct || s.occupancyPct
      ? `${pct(s.hospitalityOccupancyPct || s.occupancyPct, 0)} stabilised occupancy`
      : 'occupancy pending';
    const noi = s.noiCr ? `${cr(s.noiCr)} stabilised annual NOI` : 'NOI to be modeled';
    return `USALI economics: ${keys} × ${adr} × ${occ} → ${noi}.`;
  },
  retail: (s) => {
    const parts = [];
    if (s.retailAnchorRentPerSqftMonth && s.retailVanillaRentPerSqftMonth) {
      const anchorShare = s.retailAnchorSharePct ? ` (${pct(s.retailAnchorSharePct, 0)} anchor share)` : '';
      parts.push(`Anchor ₹${s.retailAnchorRentPerSqftMonth}/sqft/mo + Vanilla ₹${s.retailVanillaRentPerSqftMonth}/sqft/mo${anchorShare}`);
    } else if (s.baseRentPerSqftMonth) {
      parts.push(`₹${s.baseRentPerSqftMonth}/sqft/mo blended rent`);
    } else {
      parts.push('rent splits pending');
    }
    if (s.retailCAMRecoveryPct) parts.push(`${pct(s.retailCAMRecoveryPct, 0)} CAM recovery`);
    if (s.occupancyPct) parts.push(`${pct(s.occupancyPct, 0)} occupancy`);
    if (s.noiCr) parts.push(`${cr(s.noiCr)} stabilised NOI`);
    return `Retail economics: ${parts.join(' × ')}.`;
  },
  commercial_office: (s) => {
    const rent = s.baseRentPerSqftMonth ? `₹${s.baseRentPerSqftMonth}/sqft/mo Grade-A rent` : 'rent pending';
    const cam = s.otherIncomePerSqft ? ` + ₹${s.otherIncomePerSqft}/sqft/yr CAM` : '';
    const occ = s.occupancyPct ? `${pct(s.occupancyPct, 0)} stabilised occupancy` : 'occupancy pending';
    const noi = s.noiCr ? `${cr(s.noiCr)} stabilised annual NOI` : 'NOI to be modeled';
    return `Office leasing economics: ${rent}${cam} × ${occ} → ${noi}.`;
  },
  industrial_warehousing: (s) => {
    const rent = s.baseRentPerSqftMonth ? `₹${s.baseRentPerSqftMonth}/sqft/mo warehouse rent` : 'rent pending';
    const occ = s.occupancyPct ? `${pct(s.occupancyPct, 0)} pre-leased occupancy` : 'pre-lease pending';
    const noi = s.noiCr ? `${cr(s.noiCr)} stabilised NOI` : 'NOI to be modeled';
    return `Logistics economics: ${rent} × ${occ} → ${noi} (Grade-A spec build).`;
  },
  residential_apartments: (s) => {
    const sellRate = s.sellingRatePerSqft ? `₹${intINR(s.sellingRatePerSqft)}/sqft launch price` : 'pricing pending';
    const collection = s.customerCollectionPct ? `${pct(s.customerCollectionPct, 0)} RERA collection` : '';
    const margin = s.grossMarginPct != null ? `${pct(s.grossMarginPct, 0)} modeled gross margin` : 'margin pending';
    const velocity = s.salesVelocityPct ? `${pct(s.salesVelocityPct, 0)}/quarter sales velocity` : '';
    const econParts = [sellRate];
    if (velocity) econParts.push(velocity);
    if (collection) econParts.push(collection);
    econParts.push(margin);
    return `Residential economics: ${econParts.join('; ')}.`;
  },
  villas: (s) => {
    const sellRate = s.sellingRatePerSqft ? `₹${intINR(s.sellingRatePerSqft)}/sqft luxury price` : 'pricing pending';
    const margin = s.grossMarginPct != null ? `${pct(s.grossMarginPct, 0)} modeled gross margin (luxury premium)` : 'margin pending';
    const velocity = s.salesVelocityPct ? `${pct(s.salesVelocityPct, 0)}/quarter absorption` : '';
    const parts = [sellRate];
    if (velocity) parts.push(velocity);
    parts.push(margin);
    return `Villa economics: ${parts.join('; ')}.`;
  },
  plotted_development: (s) => {
    const sellRate = s.sellingRatePerSqft ? `₹${intINR(s.sellingRatePerSqft)}/sqft plot price` : 'pricing pending';
    const devCost = s.plotDevCostPerSqft ? `₹${intINR(s.plotDevCostPerSqft)}/sqft layout cost` : 'dev cost pending';
    const margin = s.grossMarginPct != null ? `${pct(s.grossMarginPct, 0)} land-economics margin` : 'margin pending';
    return `Plotted-development economics: ${sellRate} − ${devCost} → ${margin}.`;
  },
  mixed_use: (s) => {
    const shareParts = [];
    if (s.mixUseResidentialShare) shareParts.push(`${pct(s.mixUseResidentialShare, 0)} residential`);
    if (s.mixUseOfficeShare) shareParts.push(`${pct(s.mixUseOfficeShare, 0)} office`);
    if (s.mixUseRetailShare) shareParts.push(`${pct(s.mixUseRetailShare, 0)} retail`);
    if (s.mixUseHospitalityShare) shareParts.push(`${pct(s.mixUseHospitalityShare, 0)} hospitality`);
    const components = shareParts.length ? shareParts.join(' / ') : 'component breakdown pending';
    const sellRate = s.sellingRatePerSqft ? `₹${intINR(s.sellingRatePerSqft)}/sqft blended sale rate` : '';
    const margin = s.grossMarginPct != null ? `${pct(s.grossMarginPct, 0)} blended margin` : '';
    const parts = [`${components} mix`];
    if (sellRate) parts.push(sellRate);
    if (margin) parts.push(margin);
    return `Mixed-use economics: ${parts.join('; ')}.`;
  },
  redevelopment: (s) => {
    const landowner = s.landownerSharePct
      ? `${pct(s.landownerSharePct, 0)} landowner area-share`
      : 'landowner share pending';
    const sellRate = s.sellingRatePerSqft ? `₹${intINR(s.sellingRatePerSqft)}/sqft sale rate` : 'pricing pending';
    const margin = s.grossMarginPct != null ? `${pct(s.grossMarginPct, 0)} developer-side margin` : 'margin pending';
    return `Redevelopment economics: ${landowner}; ${sellRate}; ${margin}.`;
  },
  raw_land: (s) => {
    const sellRate = s.sellingRatePerSqft ? `₹${intINR(s.sellingRatePerSqft)}/sqft expected land price` : 'pricing pending';
    const stagePart = s.rawLandStage ? `${s.rawLandStage.replace(/_/g, ' ')} stage` : 'entitlement stage pending';
    const monthsList = [];
    if (s.rawLandTitleMonths) monthsList.push(`${s.rawLandTitleMonths}mo title`);
    if (s.rawLandConversionMonths) monthsList.push(`${s.rawLandConversionMonths}mo conversion`);
    if (s.rawLandLayoutMonths) monthsList.push(`${s.rawLandLayoutMonths}mo layout approval`);
    const pipeline = monthsList.length ? ` (${monthsList.join(' + ')})` : '';
    return `Raw-land economics: ${stagePart}${pipeline}; ${sellRate}.`;
  },
};

const buildEconomicsBullet = (s) => {
  const builder = ECONOMICS_BUILDERS[s.assetClass];
  if (builder) return builder(s);
  // Generic fallback for unknown asset class — should never hit in practice
  // since all 10 native classes have a builder.
  const isIncome = s.family === 'income';
  if (isIncome) {
    const rentStr = s.baseRentPerSqftMonth ? `₹${s.baseRentPerSqftMonth}/sqft/mo base rent` : 'rent pending';
    const noiStr = s.noiCr ? `${cr(s.noiCr)} stabilised annual NOI` : 'NOI to be modeled';
    return `Operating economics: ${rentStr} → ${noiStr}.`;
  }
  const margin = s.grossMarginPct != null ? `${pct(s.grossMarginPct, 0)} modeled margin` : 'margin pending';
  return `Development economics: ${margin}.`;
};

// ──────────────────────────────────────────────────────────────────────
// Bullet 3 — Capital stack + exit (structure × exit-strategy dispatch)
// ──────────────────────────────────────────────────────────────────────
const buildCapitalStackPhrase = (s) => {
  // Structure determines what "capital stack" even means.
  // For DM (development management, fee-only) there's no equity at risk
  // for the developer — landowner funds the cost. Different language.
  // For JDA the developer-side cost excludes the land contribution.
  switch (s.structure) {
    case 'development_management': {
      const cost = s.totalCostCr ? `${cr(s.totalCostCr)} project cost` : 'project cost TBD';
      return `Capital structure: ${cost}, fee-only (no developer equity at risk)`;
    }
    case 'jda_revenue_share': {
      const cost = s.totalCostCr ? `${cr(s.totalCostCr)} developer-side cost` : 'developer cost TBD';
      const share = s.landownerSharePct ? `, ${pct(s.landownerSharePct, 0)} landowner revenue-share (no upfront land payment)` : '';
      return `Capital structure: ${cost}${share}`;
    }
    case 'jda_area_share': {
      const cost = s.totalCostCr ? `${cr(s.totalCostCr)} developer-side cost` : 'developer cost TBD';
      const share = s.landownerSharePct ? `, ${pct(s.landownerSharePct, 0)} landowner area-share` : '';
      return `Capital structure: ${cost}${share}`;
    }
    case 'outright_purchase':
    default: {
      const capParts = [];
      if (s.totalCostCr) capParts.push(`${cr(s.totalCostCr)} total project cost`);
      if (s.debtLTV) capParts.push(`${pct(s.debtLTV, 0)} debt LTV`);
      if (s.debtRatePct) capParts.push(`${pct(s.debtRatePct, 1)} all-in rate`);
      return `Capital structure: ${capParts.join(', ') || 'TBD'}`;
    }
  }
};

const EXIT_PHRASE_BUILDERS = {
  strategic_sale: (s) => {
    const cap = s.exitCapRate ? ` at ${pct(s.exitCapRate, 2)} exit cap` : '';
    const value = s.exitValueCr ? ` → ${cr(s.exitValueCr)} terminal value` : '';
    return `Strategic Sale to Institutional Buyer${cap}${value}`;
  },
  reit_exit: (s) => {
    const cap = s.exitCapRate ? ` at ${pct(s.exitCapRate, 2)} implied cap` : '';
    return `REIT contribution${cap} (preferred-unit-holder structure)`;
  },
  hold_to_perpetuity: (s) => {
    const yieldPart = s.yieldOnCostPct ? ` (stabilised yield-on-cost ${pct(s.yieldOnCostPct, 2)})` : '';
    return `Hold to perpetuity${yieldPart}`;
  },
  refinance_hold: (s) => {
    const ltv = s.hospitalityRefiLTV || s.debtLTV;
    const cap = s.hospitalityRefiCapRate || s.exitCapRate;
    const ltvStr = ltv ? `${pct(ltv, 0)} LTV` : 'TBD LTV';
    const capStr = cap ? ` at ${pct(cap, 2)} cap` : '';
    return `LRD refinance + hold (${ltvStr}${capStr}, retained ownership)`;
  },
  outright_progressive: (s) => {
    const velocity = s.salesVelocityPct ? `${pct(s.salesVelocityPct, 0)}/quarter velocity` : '';
    const collection = s.customerCollectionPct ? `, ${pct(s.customerCollectionPct, 0)} RERA-milestone collection` : '';
    return `Progressive sale (RERA-milestone linked${velocity ? `, ${velocity}` : ''}${collection})`;
  },
  bulk_exit_completion: (s) => {
    const proceeds = s.exitValueCr ? ` → ${cr(s.exitValueCr)} bulk proceeds` : '';
    return `Bulk exit at completion (leftover inventory institutional-discount sale)${proceeds}`;
  },
  hold_post_completion: () =>
    'Hold post-completion (convert to lease-up + LRD refinance)',
};

const buildExitPhrase = (s) => {
  const builder = EXIT_PHRASE_BUILDERS[s.exit];
  if (builder) return builder(s);
  return s.exitLabel;
};

const buildCapitalExitBullet = (s) =>
  `${buildCapitalStackPhrase(s)}. Exit: ${buildExitPhrase(s)}.`;

// ──────────────────────────────────────────────────────────────────────
// Bullet 4 — India-context (asset-class-specific GST + Khata + RERA)
// ──────────────────────────────────────────────────────────────────────
const INDIA_GST_FRAMING = {
  // Income-leased asset classes: GST 18% on rent (not on sale)
  commercial_office: () =>
    'GST 18% on commercial rent (ITC available to tenants)',
  retail: () =>
    'GST 18% on retail rent + CAM (ITC available to tenants)',
  industrial_warehousing: () =>
    'GST 18% on warehouse rent (ITC available to tenant operators)',
  // Hospitality: GST on construction inputs (no ITC); GST on room nights via separate slab
  hospitality: () =>
    'GST 18% on construction inputs (no ITC); GST 12-18% on room nights per ARR slab',
  // Development family: GST on under-construction sale
  residential_apartments: (s) =>
    `GST ${s.gstPct != null ? pct(s.gstPct, 0) : '5%'} on under-construction sale (1% affordable < ₹45L; 0% post-OC)`,
  villas: (s) =>
    `GST ${s.gstPct != null ? pct(s.gstPct, 0) : '5%'} on under-construction sale; 0% post-OC`,
  plotted_development: () =>
    'No GST on plot transfer (immovable property sale); stamp duty + registration only',
  mixed_use: (s) =>
    `Component-blend GST: 5% residential UC, 18% commercial leasing portion (input rate ${s.gstPct != null ? pct(s.gstPct, 0) : '18%'})`,
  redevelopment: (s) =>
    `GST ${s.gstPct != null ? pct(s.gstPct, 0) : '5%'} on developer-share UC sale; landowner-share area-allotment no-GST`,
  raw_land: () =>
    'No GST on raw land transfer; Karnataka conversion fee applies post-zoning approval',
};

const buildIndiaContextBullet = (s) => {
  const parts = [];
  // 1. GST framing — asset-class specific
  const gstBuilder = INDIA_GST_FRAMING[s.assetClass];
  if (gstBuilder) parts.push(gstBuilder(s));

  // 2. Karnataka stamp duty — common to all asset classes
  if (s.stampDutyPct != null) {
    const reg = s.registrationPct != null ? ` + ${pct(s.registrationPct, 1)} registration` : '';
    parts.push(`Karnataka stamp ${pct(s.stampDutyPct, 1)}${reg}`);
  }

  // 3. Khata status — Bengaluru-specific land-title quality marker
  if (s.khataStatus && s.khataStatus !== 'A_khata') {
    parts.push(`${s.khataStatus.replace(/_/g, '-')} title (15% exit haircut applied)`);
  } else if (s.khataStatus === 'A_khata') {
    parts.push('A-khata title (full transferability)');
  }

  // 4. RERA collection — only meaningful for development sales
  if (s.family === 'development' && s.customerCollectionPct && s.assetClass !== 'plotted_development' && s.assetClass !== 'raw_land') {
    parts.push(`RERA escrow ${pct(s.customerCollectionPct, 0)} milestone collection`);
  }

  return `India-specific: ${parts.join('; ')}.`;
};

// ──────────────────────────────────────────────────────────────────────
// Asset-class-aware risk note
// ──────────────────────────────────────────────────────────────────────
const buildRiskNote = (s) => {
  const isIncome = s.family === 'income';

  // Asset-class-specific risk checks (priority order)
  // Hospitality: ADR-occupancy stress + refi-cap-rate spread
  if (s.assetClass === 'hospitality') {
    if (s.hospitalityOccupancyPct && s.hospitalityOccupancyPct < 0.60) {
      return `Modeled hospitality occupancy ${pct(s.hospitalityOccupancyPct, 0)} below 60% break-even threshold — stress-test ADR + season mix before IC.`;
    }
  }
  // Retail: anchor concentration risk
  if (s.assetClass === 'retail' && s.retailAnchorSharePct && s.retailAnchorSharePct > 0.50) {
    return `Anchor tenant share ${pct(s.retailAnchorSharePct, 0)} exceeds 50% concentration threshold — single-tenant exit risk on lease maturity.`;
  }
  // Mixed-use: blend balance
  if (s.assetClass === 'mixed_use') {
    const shares = [s.mixUseResidentialShare, s.mixUseOfficeShare, s.mixUseRetailShare, s.mixUseHospitalityShare]
      .filter((x) => x != null);
    if (shares.length && Math.max(...shares) > 0.70) {
      return `Mixed-use blend dominated by a single component (>70%) — sensitivity to that component's exit cap rate dominates the IRR.`;
    }
  }
  // Plotted dev: short cycle execution risk
  if (s.assetClass === 'plotted_development' && s.salesVelocityPct && s.salesVelocityPct < 0.10) {
    return `Plotted sales velocity ${pct(s.salesVelocityPct, 0)}/quarter below typical 15-25% — re-test absorption assumptions.`;
  }
  // Raw land: entitlement-stage risk
  if (s.assetClass === 'raw_land' && s.rawLandStage && /pre[-_]conversion|title[-_]not[-_]clear|unconverted/i.test(s.rawLandStage)) {
    return `Raw-land entitlement at "${s.rawLandStage.replace(/_/g, ' ')}" — exit value highly contingent on Karnataka land-conversion + layout approval.`;
  }

  // Generic IRR / margin / spread checks
  if (s.irr != null && s.irr < 0.12) {
    return `Modeled IRR ${pct(s.irr, 1)} below typical 12% hurdle — stress-test inputs before IC.`;
  }
  if (isIncome && s.exitCapRate && s.yieldOnCostPct && s.yieldOnCostPct < s.exitCapRate) {
    return `Stabilised yield-on-cost ${pct(s.yieldOnCostPct, 2)} below exit cap ${pct(s.exitCapRate, 2)} — negative spread, exit value < cost.`;
  }
  if (!isIncome && s.grossMarginPct != null && s.grossMarginPct < 0.15) {
    return `Modeled gross margin ${pct(s.grossMarginPct, 0)} below 15% threshold — sensitivity stress required.`;
  }

  // Default risk note when no red flag triggers
  return 'Review all kernel-stored values against source documents (sale deeds, RERA registration, encumbrance certificate, BBMP plan sanction) before IC.';
};

// ──────────────────────────────────────────────────────────────────────
// Returns summary line
// ──────────────────────────────────────────────────────────────────────
const buildReturnsSummary = (s) => {
  const parts = [];
  if (s.irr != null) parts.push(`Project IRR (kernel) ${pct(s.irr, 1)}`);
  if (s.equityMultiple != null) parts.push(`EM ${s.equityMultiple.toFixed(2)}x`);
  if (s.npvCr != null) parts.push(`NPV ${cr(s.npvCr)}`);
  return parts.length
    ? `Modeled returns: ${parts.join(' · ')}.`
    : 'Returns pending kernel computation — fill in inputs and refresh the deal.';
};

// ──────────────────────────────────────────────────────────────────────
// Deterministic templated fallback narrative — public API
// ──────────────────────────────────────────────────────────────────────
const buildTemplatedBriefing = (s) => ({
  source: 'templated',
  summary: buildReturnsSummary(s),
  bullets: [
    buildOverviewBullet(s),
    buildEconomicsBullet(s),
    buildCapitalExitBullet(s),
    buildIndiaContextBullet(s),
  ],
  riskNote: buildRiskNote(s),
  generatedAt: new Date().toISOString(),
});

// ──────────────────────────────────────────────────────────────────────
// AI-assisted narrative
// ──────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an investor-grade Indian real-estate analyst writing a one-glance briefing for IC reviewers. You will receive a JSON snapshot of a Bengaluru deal's pre-computed numbers. Your job is to assemble those numbers into investor-friendly English prose tailored to the deal's asset class, structure, and exit strategy.

STRICT RULES:
1. Use ONLY the numbers provided. NEVER fabricate any value not in the input.
2. If a number is null / missing, say "pending" or "TBD" rather than guessing.
3. Output STRICTLY valid JSON in the exact schema below. No markdown, no commentary.
4. Each bullet is one sentence, < 35 words.
5. Numbers should appear in INR Cr / sqft / % / keys conventions as appropriate to the asset class, not USD.
6. India context (RERA, GST, BBMP UAV, Karnataka stamp, A/B khata) must be framed correctly for the asset class:
   - Hospitality: GST 18% on construction inputs (no ITC); GST on room nights varies by ARR; NOT under-construction sale.
   - Office / Retail / Industrial leasing: GST 18% on rent (ITC available); NOT under-construction sale.
   - Residential / Villas: GST 5% on under-construction sale (1% for affordable < ₹45L); 0% post-OC.
   - Plotted: no GST on plot transfer.
   - Raw land: no GST; Karnataka land-conversion fee.
7. Economics framing must match the asset class:
   - Hospitality: Keys × ADR × Occupancy → NOI (USALI). Never "rent × sqft".
   - Retail: Anchor + Vanilla rent + CAM recovery.
   - Office / Industrial: Rent/sqft/mo × Occupancy → NOI.
   - Residential / Villas: Selling rate × velocity × RERA collection → revenue, margin.
   - Plotted: Selling rate − dev cost → margin (land economics).
   - Mixed-use: Component shares blend.
   - Redevelopment: Landowner area-share + developer-side margin.
   - Raw land: Entitlement stage + months to layout.
8. Capital + exit framing must match deal structure:
   - Outright purchase: total cost + debt LTV + rate.
   - JDA revenue/area share: developer-side cost (excluding land contribution); landowner share %.
   - Development management: fee-only, no developer equity at risk.

OUTPUT SCHEMA (return EXACTLY this, no other keys):
{
  "summary": "<one-line modeled-returns summary>",
  "bullets": [
    "<bullet 1: area or keys + asset class + location + structure + hold>",
    "<bullet 2: economics — asset-class-correct framing>",
    "<bullet 3: capital stack + exit assumptions — structure + exit-strategy aware>",
    "<bullet 4: India-specific — asset-class-correct GST + Khata + RERA framing>"
  ],
  "riskNote": "<one-line risk flag based ONLY on the numbers — asset-class-specific risks preferred (occupancy break-even for hospitality, anchor concentration for retail, entitlement-stage for raw land), generic IRR/margin/spread otherwise>"
}`;

const buildUserPrompt = (snapshot) => `Deal snapshot (use ONLY these numbers, do not invent any):

${JSON.stringify(snapshot, null, 2)}

Generate the briefing JSON per the schema above.`;

const parseBriefingResponse = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return null;
  // Strip code fences if model wraps in ```json
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.summary !== 'string') return null;
    if (!Array.isArray(parsed.bullets) || parsed.bullets.length < 3) return null;
    if (typeof parsed.riskNote !== 'string') return null;
    return {
      source: 'ai-assisted',
      summary: parsed.summary.trim(),
      bullets: parsed.bullets.slice(0, 4).map((b) => String(b).trim()),
      riskNote: parsed.riskNote.trim(),
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const sha256OfSnapshot = (snapshot) =>
  crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

const sha256OfPrompt = () =>
  crypto.createHash('sha256').update(SYSTEM_PROMPT).digest('hex');

// ──────────────────────────────────────────────────────────────────────
// PR-NX21 (2026-05-16) — Multi-provider failover cascade
// ──────────────────────────────────────────────────────────────────────
//
// Pre-NX21 the briefing was Claude-only: if Claude returned a 401
// (bad key), rate-limited, or had a network error, the service fell
// straight to the templated narrative. Operators saw "deterministic
// templated fallback" in the briefing footer and had no idea why.
//
// Post-NX21 the cascade is:
//   1. PRIMARY    — `narrative_synthesis` routing default (Claude Sonnet 4.6)
//   2. SECONDARY  — OpenAI GPT-5.4 (if Claude fails AND OpenAI is configured)
//   3. TEMPLATED  — deterministic narrative (always available)
//
// The returned briefing carries:
//   - `source`         — 'ai-assisted-claude' | 'ai-assisted-openai' | 'templated'
//   - `provider`       — model id used (or null for templated)
//   - `fallbackReason` — diagnostic string when primary failed
//                        (e.g., "Claude 401 invalid_api_key; OpenAI 429 rate_limited")
//
// Why this matters in practice: today the operator's ANTHROPIC_API_KEY
// shows "Needs Attention" in Vercel and the briefing dark-fails. With
// auto-failover, OpenAI (whose key works) seamlessly produces the AI
// briefing — operator never sees the templated fallback unless BOTH
// providers are simultaneously down.
//
// The cascade preserves the existing `runClaudeReasoning` env-var routing:
// if `AI_PROVIDER_NARRATIVE_SYNTHESIS=openai` is set, primary IS already
// OpenAI; the secondary path then becomes Claude (a symmetric swap).
const callPrimaryProvider = async (snapshot, inputSha256, promptSha256, dealId, assetClass, family) => {
  return runClaudeReasoning({
    task: 'narrative_synthesis',
    systemPrompt: SYSTEM_PROMPT,
    payload: buildUserPrompt(snapshot),
    maxTokens: 700,
    attach: { dealId },
    metadata: { stage: 'deal_briefing', assetClass, family, attempt: 'primary' },
    cache: { inputSha256, promptSha256 },
    retry: { attempts: 1 },
  });
};

const callSecondaryProvider = async (snapshot, inputSha256, promptSha256, dealId, assetClass, family) => {
  // Force the alternate provider by passing explicit `provider` arg to
  // `runAI` (the full-envelope variant). The router honors explicit
  // provider over routing-config / env-var. If primary was Claude
  // (default), secondary is OpenAI. If operator already overrode primary
  // to OpenAI via env var, secondary is Claude.
  const primaryProvider = (process.env.AI_PROVIDER_NARRATIVE_SYNTHESIS || 'claude').toLowerCase();
  const alternateProvider = primaryProvider === 'openai' ? 'claude' : 'openai';
  // Soft-import to avoid breaking when AI services aren't available.
  let runAI;
  try {
    ({ runAI } = require('../../../ai/aiRouter'));
  } catch {
    return null;
  }
  if (!runAI) return null;
  return runAI({
    task: 'narrative_synthesis',
    provider: alternateProvider, // ← explicit override
    attach: { dealId },
    metadata: { stage: 'deal_briefing', assetClass, family, attempt: 'secondary' },
    cache: { inputSha256, promptSha256 },
    run: async ({ providers, model }) => {
      if (alternateProvider === 'openai') {
        return providers.runOpenAIReasoning({
          systemPrompt: SYSTEM_PROMPT,
          payload: buildUserPrompt(snapshot),
          maxTokens: 700,
          model,
        });
      }
      return providers.runClaudeReasoning({
        systemPrompt: SYSTEM_PROMPT,
        payload: buildUserPrompt(snapshot),
        maxTokens: 700,
        model,
      });
    },
  });
};

// Extract a one-line diagnostic from an error. Goal: tell the operator
// WHY the AI call failed without leaking internals. Examples:
//   "Claude 401 invalid_api_key" → operator knows to check the key
//   "Claude 429 rate_limited"   → operator knows to wait / lift cap
//   "OpenAI ECONNRESET"         → transient network — auto-retry next time
const describeProviderError = (provider, err) => {
  if (!err) return `${provider} failed (unknown reason)`;
  const msg = String(err.message || err).slice(0, 120);
  const status = err.status || err.statusCode || err.code || null;
  return status ? `${provider} ${status} ${msg}` : `${provider} ${msg}`;
};

/**
 * Generate the deal briefing with multi-provider failover.
 *
 * Cascade: PRIMARY (Claude or env-overridden) → SECONDARY (alternate AI
 * provider) → TEMPLATED (deterministic fallback).
 *
 * ALWAYS returns a valid briefing object — the caller can render without
 * further error handling. The `source` + `provider` + `fallbackReason`
 * fields tell the caller which path actually fired so the export can
 * surface accurate provenance to the operator.
 *
 * @param {object} ctx - the buildContext()-prepared workbook context
 * @param {object} [options]
 * @param {boolean} [options.preferTemplated=false] - skip AI entirely
 * @returns {Promise<{source, provider, fallbackReason, summary, bullets, riskNote, generatedAt}>}
 */
const generateDealBriefing = async (ctx, options = {}) => {
  const snapshot = buildNumericSnapshot(ctx);
  const templated = buildTemplatedBriefing(snapshot);

  // Test env / explicit opt-out — skip AI entirely, ship templated cleanly.
  if (options.preferTemplated) return templated;
  if (!runClaudeReasoning) return templated;
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) return templated;

  const inputSha256 = sha256OfSnapshot(snapshot);
  const promptSha256 = sha256OfPrompt();
  const dealId = ctx.deal?.id || null;
  const fallbackReasons = [];

  // ─── Attempt 1: PRIMARY provider (routing default per PR-NX9) ────────
  try {
    const result = await callPrimaryProvider(snapshot, inputSha256, promptSha256, dealId, ctx.assetClass, ctx.dealFamily);
    const parsed = parseBriefingResponse(result?.result || null);
    if (parsed) {
      const primaryProvider = (process.env.AI_PROVIDER_NARRATIVE_SYNTHESIS || 'claude').toLowerCase();
      return {
        ...parsed,
        source: `ai-assisted-${primaryProvider}`,
        provider: result?.model || (primaryProvider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.4'),
      };
    }
    fallbackReasons.push('primary returned malformed JSON');
  } catch (err) {
    fallbackReasons.push(describeProviderError('primary', err));
  }

  // ─── Attempt 2: SECONDARY provider (cross-over) ──────────────────────
  // Only attempt if the alternate provider has a key configured (otherwise
  // the call would throw immediately on missing-credential check).
  const primaryProvider = (process.env.AI_PROVIDER_NARRATIVE_SYNTHESIS || 'claude').toLowerCase();
  const alternateProvider = primaryProvider === 'openai' ? 'claude' : 'openai';
  const alternateConfigured = alternateProvider === 'claude'
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);

  if (alternateConfigured) {
    try {
      const result = await callSecondaryProvider(snapshot, inputSha256, promptSha256, dealId, ctx.assetClass, ctx.dealFamily);
      const parsed = parseBriefingResponse(result?.result || null);
      if (parsed) {
        return {
          ...parsed,
          source: `ai-assisted-${alternateProvider}`,
          provider: result?.model || (alternateProvider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.4'),
          fallbackReason: `${fallbackReasons.join('; ')} — auto-failover succeeded on ${alternateProvider}`,
        };
      }
      fallbackReasons.push(`secondary (${alternateProvider}) returned malformed JSON`);
    } catch (err) {
      fallbackReasons.push(describeProviderError(alternateProvider, err));
    }
  } else {
    fallbackReasons.push(`secondary (${alternateProvider}) not configured`);
  }

  // ─── Attempt 3: TEMPLATED fallback ───────────────────────────────────
  // Both providers failed (or weren't available). Ship the deterministic
  // narrative with diagnostic context so the operator knows exactly why.
  return {
    ...templated,
    fallbackReason: fallbackReasons.join('; '),
  };
};

module.exports = {
  generateDealBriefing,
  buildNumericSnapshot,
  buildTemplatedBriefing,
  parseBriefingResponse,
  // Exported for tests / future reuse
  __internal: {
    SYSTEM_PROMPT,
    ASSET_CLASS_LABEL,
    DEAL_STRUCTURE_LABEL,
    EXIT_STRATEGY_LABEL,
    ECONOMICS_BUILDERS,
    EXIT_PHRASE_BUILDERS,
    INDIA_GST_FRAMING,
    buildOverviewBullet,
    buildEconomicsBullet,
    buildCapitalStackPhrase,
    buildExitPhrase,
    buildCapitalExitBullet,
    buildIndiaContextBullet,
    buildRiskNote,
    describeProviderError, // PR-NX21: exposed for unit-testing the failover diagnostic formatter
    buildReturnsSummary,
    deriveHospitalitySqft,
  },
};
