#!/usr/bin/env node
'use strict';

/**
 * Tier-2 #14 — generate the held-out 30-deal A/B eval fixture set.
 *
 * Produces `backend/tests/fixtures/ab-eval-deals.json` with 30
 * synthetic-but-grounded Bengaluru parcels. Each row carries:
 *   • id
 *   • parcel_payload  — input shape consumed by parcelNarrative.service
 *   • deal_payload    — input shape consumed by export.insights.service
 *
 * The fixtures span:
 *   - 6 canonical Bengaluru micro-markets
 *   - 5 verdict labels (verified_clean, partially_verified, gaps_present,
 *     blocked, requires_verification)
 *   - 5 asset classes
 *   - 5 deal stages
 *   - Varied red-flag profiles
 *
 * Why a generator script (vs hand-written JSON): the values move when
 * regulations or rate-pack data refresh, and the eval should be
 * reproducible from a versioned spec. Re-run this anytime to refresh.
 *
 * Usage: `node backend/scripts/generate-ab-eval-fixtures.js`
 */

const fs = require('fs');
const path = require('path');

const MICROMARKETS = [
  { name: 'Whitefield',         lat: 12.9698, lng: 77.7500, ward: 84, zone: 'Mahadevapura',  guidance: 8500 },
  { name: 'Hebbal',             lat: 13.0440, lng: 77.5870, ward: 18, zone: 'Yelahanka',     guidance: 9200 },
  { name: 'Sarjapur Road',      lat: 12.8950, lng: 77.6900, ward: 159, zone: 'Bommanahalli', guidance: 7800 },
  { name: 'Indiranagar',        lat: 12.9716, lng: 77.6411, ward: 80, zone: 'East',          guidance: 14500 },
  { name: 'Devanahalli',        lat: 13.2437, lng: 77.7079, ward: null, zone: 'Yelahanka',   guidance: 4200 },
  { name: 'Yelahanka New Town', lat: 13.1007, lng: 77.5963, ward: 5,  zone: 'Yelahanka',     guidance: 6400 },
];

const VERDICTS = [
  { label: 'verified_clean',          confidence_pct: 92, summary: 'Verified ground truth on zoning, FAR, and guidance value with no open red flags.' },
  { label: 'partially_verified',      confidence_pct: 68, summary: 'Zoning and guidance value verified; setbacks and road width inferred from OSM.' },
  { label: 'gaps_present',            confidence_pct: 47, summary: 'Material gaps in master-plan zone capture and survey-number alignment.' },
  { label: 'requires_verification',   confidence_pct: 35, summary: 'Most fields rely on inference; manual verification required before underwriting.' },
  { label: 'blocked',                 confidence_pct: 18, summary: 'Multiple critical red flags. Snapshot cannot support an underwriting view as-is.' },
];

const ASSET_CLASSES = [
  'residential_apartments', 'plotted_development', 'villas',
  'commercial_office', 'industrial_warehousing',
];

const STAGES = ['sourcing', 'screening', 'diligence', 'underwriting', 'ic_review'];

const RED_FLAG_TEMPLATES = [
  { severity: 'critical', label: 'EC mismatch with sale deed seller name',
    detail: 'Encumbrance certificate names a different transferor than the registered sale deed.' },
  { severity: 'high',     label: 'Setback inputs rely on OSM inference',
    detail: 'No verified survey-of-india road width on file; setback band assumed from OSM highway tag.' },
  { severity: 'high',     label: 'Master plan zone is draft, not gazetted',
    detail: 'Applicable RMP 2031 zoning is from the consultation draft. Treat permissible FAR as approximate.' },
  { severity: 'medium',   label: 'Guidance value newer than property tax record',
    detail: 'BBMP UAV PDF predates the most recent IGR guidance gazette by 18 months.' },
  { severity: 'medium',   label: 'KGIS hierarchy disagrees with revenue records',
    detail: 'Survey number bucket on KGIS does not match the village panchayat record.' },
  { severity: 'low',      label: 'Owner-name spelling variance across documents',
    detail: 'Aadhaar-style transliteration differs by one character across EC and tax record.' },
];

const RISK_BUCKET_TEMPLATES = [
  { critical: 0, high: 1, medium: 2, low: 1 },
  { critical: 1, high: 2, medium: 1, low: 0 },
  { critical: 0, high: 0, medium: 1, low: 2 },
  { critical: 2, high: 3, medium: 2, low: 1 },
  { critical: 0, high: 1, medium: 0, low: 0 },
];

const SAMPLE_RISK_FLAGS = [
  { title: 'Encumbrance certificate gap',                       severity: 'critical', category: 'legal_title',  description: 'EC search returns nil from 1996 to 2002 — verify chain of title.' },
  { title: 'BBMP plan sanction expiring',                       severity: 'high',     category: 'regulatory',   description: 'Sanctioned plan expires in 60 days; revalidation required before commencing.' },
  { title: 'Promoter delivery delays on prior project',         severity: 'high',     category: 'promoter',     description: 'Last project handed over 14 months past committed date per public RERA filing.' },
  { title: 'Demand softening in submarket',                     severity: 'medium',   category: 'market',       description: 'Listing absorption has slowed quarter-on-quarter per latest IPC report.' },
  { title: 'Drainage easement crosses parcel',                  severity: 'medium',   category: 'environmental', description: 'BWSSB-mapped storm-water drain crosses the eastern boundary; 3m setback applies.' },
  { title: 'Stamp duty interpretation pending',                 severity: 'low',      category: 'financial',    description: 'Article 5 vs Article 20 stamp duty applicability under review; ±0.5% delta on land cost.' },
];

const DD_ITEM_TEMPLATES = [
  { item_name: 'Title chain validation 30Y',  category: 'legal',      severity: 'deal_breaker',     status: 'in_progress' },
  { item_name: 'Encumbrance certificate fresh',category: 'legal',     severity: 'deal_breaker',     status: 'pending' },
  { item_name: 'BBMP sanctioned plan',         category: 'regulatory', severity: 'commercial_blocker', status: 'pending' },
  { item_name: 'Khata transfer status',        category: 'regulatory', severity: 'secondary',        status: 'pending' },
  { item_name: 'Comp database refresh',        category: 'commercial', severity: 'secondary',        status: 'in_progress' },
];

const pickIndex = (i, arr) => arr[i % arr.length];

// Deterministic RNG so successive runs produce identical fixtures.
const rng = (seed) => () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

const buildParcelPayload = (mm, verdict, idx, rand) => {
  const baseFar    = [1.75, 2.0, 2.25, 2.5, 3.0, 3.25, 3.5][idx % 7];
  const maxFar     = baseFar + (rand() < 0.5 ? 0.25 : 0.5);
  const areaSqft   = [4356, 6534, 13068, 21780, 43560, 87120][idx % 6]; // 0.1 to 2.0 acres
  const roadWidth  = [9, 12, 15, 18, 24, 30][idx % 6];

  const flagCount = verdict.label === 'verified_clean' ? 0
    : verdict.label === 'partially_verified' ? 1
    : verdict.label === 'gaps_present' ? 2
    : verdict.label === 'blocked' ? 4 : 3;
  const flags = RED_FLAG_TEMPLATES.slice(0, flagCount);

  return {
    parcel: {
      name: `${mm.name} Plot ${String(idx + 1).padStart(2, '0')}`,
      address: `Survey No. ${idx + 12}/${(idx % 8) + 1}, ${mm.name}, Bengaluru, Karnataka`,
      city: 'Bengaluru',
      land_area_sqft: areaSqft,
      road_width_mtrs: roadWidth,
    },
    verdict: {
      label: verdict.label,
      summary: verdict.summary,
      confidence_pct: verdict.confidence_pct,
      counts: {
        verified: verdict.label === 'verified_clean' ? 8 : verdict.label === 'blocked' ? 1 : 4,
        inferred: verdict.label === 'verified_clean' ? 1 : 4,
        needs_verification: flagCount,
      },
    },
    confidence: {
      overall: verdict.confidence_pct,
      zoning: Math.min(100, verdict.confidence_pct + 5),
      buildability: Math.max(0, verdict.confidence_pct - 5),
      guidance: verdict.confidence_pct,
      kgis: Math.max(0, verdict.confidence_pct - 10),
    },
    zoning: {
      zone_code: ['R', 'RM', 'COM-1', 'IND-A', 'MU-2'][idx % 5],
      zone_name: ['Residential (Main)', 'Residential (Mixed)', 'Commercial Axial', 'Industrial Type A', 'Mixed Use'][idx % 5],
      planning_zone: mm.zone,
      plan_version: 'RMP 2031',
      plan_status: idx % 4 === 0 ? 'draft' : 'gazetted',
    },
    buildability: {
      status: verdict.label === 'blocked' ? 'gaps_present' : 'computed',
      max_far: maxFar,
      base_far: baseFar,
      max_buildable_area_sqft: Math.round(areaSqft * maxFar),
      ground_coverage_pct: 50 + (idx % 4) * 5,
      setback_input_status: idx % 3 === 0 ? 'inferred_osm' : 'verified',
    },
    guidance_value: {
      locality: `${mm.name} (SRO ${10 + (idx % 9)})`,
      road_name: `${mm.name} ${(idx % 2) ? 'Main' : 'Cross'} Road`,
      value_inr_per_sqft: mm.guidance + (idx % 5) * 200,
    },
    kgis_hierarchy: `Bengaluru Urban / ${mm.zone} / Ward ${mm.ward || 'NA'}`,
    osm_inferred_road: idx % 3 === 0 ? {
      width_m: roadWidth,
      highway: ['residential', 'tertiary', 'secondary'][idx % 3],
      derivation_method: 'osm_tag_match',
    } : null,
    red_flags: flags,
    bucket_counts: {
      verified: verdict.label === 'verified_clean' ? 8 : verdict.label === 'blocked' ? 1 : 4,
      inferred: verdict.label === 'verified_clean' ? 1 : 4,
      needs_verification: flagCount,
    },
  };
};

const buildDealPayload = (mm, verdict, idx) => {
  const assetClass = pickIndex(idx, ASSET_CLASSES);
  const stage      = pickIndex(idx, STAGES);
  const areaSqft   = [4356, 6534, 13068, 21780, 43560, 87120][idx % 6];
  const ratePsf    = mm.guidance * (1.4 + (idx % 5) * 0.05); // gross developer rate
  const totalRevenueCr = Math.round(((areaSqft * ratePsf * 2.4) / 10_000_000) * 100) / 100;
  const totalCostCr    = Math.round(totalRevenueCr * 0.62 * 100) / 100;
  const grossProfitCr  = Math.round((totalRevenueCr - totalCostCr) * 100) / 100;
  const grossMarginPct = Math.round(((totalRevenueCr - totalCostCr) / totalRevenueCr) * 1000) / 10;
  const irrPct         = Math.round((14 + (idx % 7) * 1.5) * 10) / 10;
  const npvCr          = Math.round((grossProfitCr * 0.45) * 100) / 100;
  const equityX        = Math.round((1.4 + (idx % 8) * 0.1) * 100) / 100;
  const landAskCr      = Math.round(totalCostCr * 0.42 * 100) / 100;

  const ddCounts = {
    total_required: 12 + (idx % 5),
    completed_required: Math.max(0, 12 + (idx % 5) - (idx % 8) - 2),
    open_deal_breakers: verdict.label === 'blocked' ? 2 : verdict.label === 'gaps_present' ? 1 : 0,
  };
  const riskCounts = pickIndex(idx, RISK_BUCKET_TEMPLATES);

  return {
    deal: {
      name: `${mm.name} ${assetClass.replace(/_/g, ' ')} ${idx + 1}`,
      asset_class: assetClass,
      deal_type: idx % 3 === 0 ? 'land_purchase' : 'jda',
      stage,
      priority: idx % 4 === 0 ? 'high' : 'medium',
      city: 'Bengaluru',
      state: 'Karnataka',
      land_area_sqft: areaSqft,
      land_ask_price_cr: landAskCr,
      negotiated_price_cr: Math.round(landAskCr * 0.94 * 100) / 100,
      rera_registered: idx % 3 !== 0,
    },
    financial_model: {
      total_cost_cr: totalCostCr,
      total_revenue_cr: totalRevenueCr,
      gross_profit_cr: grossProfitCr,
      gross_margin_pct: grossMarginPct,
      irr_pct: irrPct,
      npv_cr: npvCr,
      equity_multiple: equityX,
      residual_land_value_cr: Math.round(landAskCr * 1.1 * 100) / 100,
      discount_rate_pct: 14,
      project_duration_years: 3 + (idx % 4),
    },
    diligence: ddCounts,
    risks: riskCounts,
    market_benchmarks: {
      count: 4 + (idx % 5),
      avg_rate_per_sqft: Math.round(ratePsf),
      median_rate_per_sqft: Math.round(ratePsf * 0.97),
      min_rate_per_sqft: Math.round(ratePsf * 0.84),
      max_rate_per_sqft: Math.round(ratePsf * 1.18),
    },
    cash_flow_summary: {
      total_inflow_cr: totalRevenueCr,
      total_outflow_cr: totalCostCr,
      net_cr: grossProfitCr,
      peak_deployment_cr: Math.round(totalCostCr * 0.65 * 100) / 100,
      first_positive_period: `Q${(idx % 4) + 5}`,
    },
    open_risk_flags: SAMPLE_RISK_FLAGS.slice(0, Math.max(1, riskCounts.critical + riskCounts.high)).map((r) => ({
      title: r.title, severity: r.severity, category: r.category, description: r.description,
    })),
    pending_dd_items: DD_ITEM_TEMPLATES.slice(0, 3 + (idx % 3)).map((d) => ({
      item_name: d.item_name, category: d.category, severity: d.severity, status: d.status,
    })),
  };
};

const main = () => {
  const FIXTURE_COUNT = 30;
  const rand = rng(20260509);
  const fixtures = [];
  for (let i = 0; i < FIXTURE_COUNT; i += 1) {
    const mm = pickIndex(i, MICROMARKETS);
    const verdict = pickIndex(i, VERDICTS);
    fixtures.push({
      id: `fx-${String(i + 1).padStart(2, '0')}`,
      label: `${mm.name} / ${verdict.label}`,
      parcel_payload: buildParcelPayload(mm, verdict, i, rand),
      deal_payload:   buildDealPayload(mm, verdict, i),
    });
  }
  const outPath = path.join(__dirname, '..', 'tests', 'fixtures', 'ab-eval-deals.json');
  fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${fixtures.length} fixtures to ${outPath}`);
  console.log('Distribution:');
  const byVerdict = {};
  const byAsset = {};
  for (const f of fixtures) {
    const v = f.parcel_payload.verdict.label;
    const a = f.deal_payload.deal.asset_class;
    byVerdict[v] = (byVerdict[v] || 0) + 1;
    byAsset[a] = (byAsset[a] || 0) + 1;
  }
  console.log('  by verdict:', byVerdict);
  console.log('  by asset_class:', byAsset);
};

if (require.main === module) main();

module.exports = { main };
