'use strict';

/**
 * Reference-template context factory (PR-TPL — 2026-05-15)
 *
 * Generates synthetic "blank template" deal contexts that feed the existing
 * `buildDealWorkbookV2()` builder. The output is a fully-structured,
 * formula-driven, investor-grade Excel workbook with realistic India-specific
 * defaults per asset class — pre-populated enough that the operator sees a
 * complete worked example, NOT empty cells.
 *
 * Design philosophy:
 * -------------------
 * Rather than build a second XLSX generator for "blank templates", we reuse
 * the production dynamic-deal builder (~7200 LOC, already battle-tested with
 * 1534 unit tests) and feed it a synthetic context with sensible defaults.
 * Benefits:
 *   - 100% feature parity with the deal-export workbook (same formulas,
 *     same charts, same conditional formatting, same Indian tax / GST /
 *     RERA / JDA logic).
 *   - Single source of truth — improvements to the builder flow through
 *     to both deal exports AND reference templates.
 *   - Zero formula divergence risk.
 *
 * Template variants:
 * ------------------
 * Each user-facing asset class × deal-structure pair produces a distinct
 * workbook with:
 *   - Asset-class-appropriate Operating P&L (USALI for hospitality, rent
 *     × sqft for office/retail/industrial, sales velocity for residential
 *     / villas / plotted, etc.)
 *   - Deal-structure-appropriate capital stack (outright = 100% equity +
 *     debt; JV/JDA = developer/landowner profit split; DM = fee-only
 *     model with no capital).
 *   - Exit-strategy-appropriate reversion math (cap-rate exit for income;
 *     phased-sale for development; LRD refi for stabilised income).
 *
 * Asset-class coverage (Phase 1 — 2026-05-15):
 * ---------------------------------------------
 * 10 native asset classes (full standalone branches in buildWorkbook.js):
 *   residential_apartments, villas, plotted_development, commercial_office,
 *   retail, industrial_warehousing, hospitality, mixed_use, raw_land,
 *   redevelopment.
 *
 * 9 mapped asset classes (Phase 2 will add standalone branches):
 *   data_centres → industrial_warehousing (similar capex + lease structure)
 *   co_living → residential_apartments (rentable variant)
 *   student_housing → residential_apartments (BTR-like)
 *   senior_living → residential_apartments (assisted-living rentals)
 *   build_to_rent → residential_apartments (rentable, income-family)
 *   logistics_parks → industrial_warehousing (multi-tenant variant)
 *   flex_spaces → commercial_office (co-working / managed-office)
 *   sez_business_parks → commercial_office (campus / tax-zone variant)
 *   township → mixed_use (multi-component master plan)
 *
 * Mapping is intentional: an operator downloading a "Co-living Template"
 * gets a residential_apartments workbook with co-living-aware DEFAULTS
 * (smaller unit sizes, higher per-bed rates, higher turnover). The
 * underlying P&L structure is residential-family but the inputs are
 * tuned for the use case. Operators can refine in subsequent edits.
 */

// ──────────────────────────────────────────────────────────────────────────
// Asset-class registry
// ──────────────────────────────────────────────────────────────────────────
//
// Each entry contains:
//   id              — user-facing slug (URL-friendly)
//   label           — human-readable name
//   family          — 'development' | 'income' (drives the P&L branch)
//   underlyingAssetClass — maps to a buildWorkbook.js asset_class string
//   propertyType    — feeds the property.property_type field
//   description     — 1-line marketing copy for the templates page
//   marketContext   — typical India-context note (Bengaluru-priority)
//   supportedDealStructures — which deal_structure values make sense
//   supportedExitStrategies — which exit_strategy values make sense
//   inputDefaults   — sensible Bengaluru-priority defaults for the inputs
//   propertyDefaults — defaults for the property record
//   projectDurationMonths — typical hold/build period

const FIVE_YEAR_INCOME = 60;      // 5-year hold for income-family
const FOURTEEN_YEAR_INCOME = 168; // long hold for hospitality / data centre
const THIRTY_SIX_MONTH_DEV = 36;  // typical residential build cycle
const FORTY_EIGHT_MONTH_DEV = 48; // larger residential / mixed-use
const TWENTY_FOUR_MONTH_DEV = 24; // plotted / villas (faster cycles)

const ASSET_CLASS_REGISTRY = {
  // ── Development family ──────────────────────────────────────────────
  residential_apartments: {
    id: 'residential_apartments',
    label: 'Residential Apartments',
    family: 'development',
    underlyingAssetClass: 'residential_apartments',
    propertyType: 'residential_apartments',
    description:
      'High-rise / mid-rise apartment projects. RERA-registered, milestone-collection sales, ' +
      'JDA structures common in Bengaluru. Includes GST 5%/1% + Karnataka stamp duty 6.6%.',
    marketContext:
      'Bengaluru — Whitefield / Sarjapur / Hebbal premium ₹9k–12k/sqft. North BLR mid-segment ' +
      '₹6.5k–8.5k. Plotted-area Affordable < ₹5.5k.',
    supportedDealStructures: ['outright_purchase', 'jda_revenue_share', 'jda_area_share', 'development_management'],
    supportedExitStrategies: ['outright_sale', 'phased_sale', 'partial_sale_partial_hold'],
    projectDurationMonths: FORTY_EIGHT_MONTH_DEV,
    inputDefaults: {
      saleableAreaSqft: 350000,
      sellingRatePerSqft: 9500,
      landCostCr: 65,
      constructionCostPerSqft: 4500,
      approvalCostCr: 8,
      escalationPct: 0.06,
      salesVelocityPct: 0.16,
      salesLagQuarters: 2,
      constructionLagQuarters: 1,
      customerCollectionPct: 0.85,
      marketingCostPct: 0.04,
      financeCostPct: 0.02,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.55,
      debtRatePct: 0.115,
      loanTermYears: 5,
      moratoriumMonths: 12,
      discountRatePct: 0.16,
      developerMarginPct: 0.22,
      loadingFactor: 1.30,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Whitefield',
      land_area_sqft: 175000,
      existing_fsi: 2.0,
    },
  },

  villas: {
    id: 'villas',
    label: 'Villas',
    family: 'development',
    underlyingAssetClass: 'villas',
    propertyType: 'villas',
    description:
      'Gated villa communities — premium plots with built-up units. Lower density, higher ticket, ' +
      'faster absorption than apartments. RERA-applicable.',
    marketContext: 'Bengaluru North & East — Devanahalli / Sarjapur / Hennur ₹14k–22k/sqft built-up.',
    supportedDealStructures: ['outright_purchase', 'jda_area_share', 'development_management'],
    supportedExitStrategies: ['outright_sale', 'phased_sale'],
    projectDurationMonths: TWENTY_FOUR_MONTH_DEV,
    inputDefaults: {
      saleableAreaSqft: 180000,
      sellingRatePerSqft: 16000,
      landCostCr: 90,
      constructionCostPerSqft: 5500,
      approvalCostCr: 5,
      escalationPct: 0.05,
      salesVelocityPct: 0.20,
      salesLagQuarters: 1,
      constructionLagQuarters: 1,
      customerCollectionPct: 0.90,
      marketingCostPct: 0.03,
      financeCostPct: 0.02,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.50,
      debtRatePct: 0.115,
      loanTermYears: 4,
      moratoriumMonths: 6,
      discountRatePct: 0.16,
      developerMarginPct: 0.25,
      loadingFactor: 1.15,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Devanahalli',
      land_area_sqft: 250000,
      existing_fsi: 1.0,
    },
  },

  plotted_development: {
    id: 'plotted_development',
    label: 'Plotted Development',
    family: 'development',
    underlyingAssetClass: 'plotted_development',
    propertyType: 'plotted_development',
    description:
      'Layout developments — DTCP / BDA approved residential plots. No construction risk, ' +
      'fastest deal cycle in Indian residential. BDA / BMRDA layout norms apply.',
    marketContext: 'Bengaluru periphery — Hoskote / Anekal / Devanahalli ₹3k–7k/sqft plotted.',
    supportedDealStructures: ['outright_purchase', 'jda_revenue_share', 'jda_area_share'],
    supportedExitStrategies: ['outright_sale', 'phased_sale'],
    projectDurationMonths: 24,
    inputDefaults: {
      saleableAreaSqft: 400000,
      sellingRatePerSqft: 5500,
      landCostCr: 110,
      constructionCostPerSqft: 1200, // infra cost only
      approvalCostCr: 3,
      escalationPct: 0.07,
      salesVelocityPct: 0.22,
      salesLagQuarters: 2,
      constructionLagQuarters: 2,
      customerCollectionPct: 0.95,
      marketingCostPct: 0.03,
      financeCostPct: 0.02,
      gstPct: 0.00, // plotted sales = no GST
      stampDutyPct: 0.066,
      debtLTV: 0.40,
      debtRatePct: 0.12,
      loanTermYears: 3,
      moratoriumMonths: 3,
      discountRatePct: 0.18,
      developerMarginPct: 0.28,
      loadingFactor: 1.0,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Hoskote',
      land_area_sqft: 450000,
      existing_fsi: 1.0,
    },
  },

  // ── Income family ───────────────────────────────────────────────────
  commercial_office: {
    id: 'commercial_office',
    label: 'Commercial Office',
    family: 'income',
    underlyingAssetClass: 'commercial_office',
    propertyType: 'commercial_office',
    description:
      'Grade-A office towers with multi-tenant leasing. CAM + rent escalation, ' +
      'institutional-grade lease covenants, LRD refi or REIT exit. ' +
      'Karnataka stamp duty 6.6% + GST 18% on office (input-tax-credit eligible).',
    marketContext:
      'Bengaluru ORR / Whitefield / KGN — ₹95–135/sqft/mo headline; CAM ₹15–22/sqft/mo. ' +
      'Stabilised cap rate 7.5–8.5%; Grade-A vacancy 8–14%.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'forward_purchase', 'built_to_suit'],
    supportedExitStrategies: ['sale_to_institutional', 'reit_exit', 'lrd_refinance', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 500000,
      baseRentPerSqftMonth: 110,
      rentEscalationPct: 0.05,
      occupancyPct: 0.92,
      vacancyPct: 0.08,
      otherIncomePerSqft: 240, // CAM annualised
      leaseUpPeriodQuarters: 4,
      propertyTaxPerSqftYr: 40,
      insurancePct: 0.01,
      propMgmtPct: 0.03,
      utilitiesPct: 0.04,
      maintenancePct: 0.05,
      capExReservePct: 0.04,
      landCostCr: 80,
      constructionCostPerSqft: 6800,
      approvalCostCr: 6,
      exitCapRate: 0.080,
      sellingCostPct: 0.02,
      gstPct: 0.0, // net of ITC for commercial
      stampDutyPct: 0.066,
      debtLTV: 0.60,
      debtRatePct: 0.105,
      loanTermYears: 12,
      moratoriumMonths: 18,
      discountRatePct: 0.135,
      loadingFactor: 1.35,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Outer Ring Road',
      land_area_sqft: 200000,
      existing_fsi: 3.25,
    },
  },

  retail: {
    id: 'retail',
    label: 'Retail / Mall',
    family: 'income',
    underlyingAssetClass: 'retail',
    propertyType: 'retail',
    description:
      'Multi-tenant retail malls + high-street. Anchor + vanilla rent split, CAM recovery, ' +
      'percentage rent kickers. Cap-rate exit or REIT.',
    marketContext:
      'Bengaluru — Mall of Asia / Phoenix Marketcity benchmark ₹180–240/sqft/mo blended (anchor ' +
      '₹60–80, vanilla ₹180–280). Stabilised cap 8.5–9.5%.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'forward_purchase'],
    supportedExitStrategies: ['sale_to_institutional', 'reit_exit', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 350000,
      baseRentPerSqftMonth: 180,
      rentEscalationPct: 0.05,
      occupancyPct: 0.88,
      vacancyPct: 0.12,
      otherIncomePerSqft: 360, // CAM + parking + percentage rent
      leaseUpPeriodQuarters: 6,
      propertyTaxPerSqftYr: 60,
      insurancePct: 0.01,
      propMgmtPct: 0.04,
      utilitiesPct: 0.05,
      maintenancePct: 0.06,
      capExReservePct: 0.05,
      landCostCr: 70,
      constructionCostPerSqft: 7500,
      approvalCostCr: 8,
      exitCapRate: 0.090,
      sellingCostPct: 0.025,
      gstPct: 0.0,
      stampDutyPct: 0.066,
      debtLTV: 0.55,
      debtRatePct: 0.11,
      loanTermYears: 10,
      moratoriumMonths: 24,
      discountRatePct: 0.14,
      loadingFactor: 1.40,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Indiranagar',
      land_area_sqft: 150000,
      existing_fsi: 3.0,
    },
  },

  industrial_warehousing: {
    id: 'industrial_warehousing',
    label: 'Industrial & Warehousing',
    family: 'income',
    underlyingAssetClass: 'industrial_warehousing',
    propertyType: 'industrial_warehousing',
    description:
      'Grade-A warehousing + light industrial. Single-tenant or multi-tenant. Lower yields than ' +
      'office but tighter cap rates post-2020. RFID / EV-charging tenants accelerating.',
    marketContext:
      'Bengaluru — Hoskote / Nelamangala / Devanahalli ₹22–28/sqft/mo. Cap rate 7.5–8.5%. ' +
      'Logistics push: GST + Make-in-India.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'forward_purchase', 'built_to_suit', 'sale_and_leaseback'],
    supportedExitStrategies: ['sale_to_institutional', 'reit_exit', 'hold_to_lease', 'lrd_refinance'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 600000,
      baseRentPerSqftMonth: 24,
      rentEscalationPct: 0.05,
      occupancyPct: 0.95,
      vacancyPct: 0.05,
      otherIncomePerSqft: 60,
      leaseUpPeriodQuarters: 3,
      propertyTaxPerSqftYr: 15,
      insurancePct: 0.01,
      propMgmtPct: 0.02,
      utilitiesPct: 0.02,
      maintenancePct: 0.03,
      capExReservePct: 0.03,
      landCostCr: 50,
      constructionCostPerSqft: 2400,
      approvalCostCr: 4,
      exitCapRate: 0.080,
      sellingCostPct: 0.02,
      gstPct: 0.0,
      stampDutyPct: 0.066,
      debtLTV: 0.60,
      debtRatePct: 0.105,
      loanTermYears: 12,
      moratoriumMonths: 12,
      discountRatePct: 0.13,
      loadingFactor: 1.05,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Hoskote',
      land_area_sqft: 500000,
      existing_fsi: 1.5,
    },
  },

  hospitality: {
    id: 'hospitality',
    label: 'Hospitality / Hotel',
    family: 'income',
    underlyingAssetClass: 'hospitality',
    propertyType: 'hospitality',
    description:
      'Full-service / upscale hotels. USALI-compliant P&L (Rooms / F&B / MOD / Banquet). ' +
      'ADR × Occupancy = RevPAR. Brand-affiliated (Marriott / Hyatt / IHG) or independent.',
    marketContext:
      'Bengaluru — ITC Gardenia / Conrad ADR ₹10k–14k peak, ₹7k–9k base. RevPAR ₹6.5–9k. ' +
      'Tier-1 city occupancy 68–74%. Cap rate 9–10.5%.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'jda_revenue_share', 'forward_purchase'],
    supportedExitStrategies: ['sale_to_institutional', 'reit_exit', 'hold_to_lease'],
    projectDurationMonths: FOURTEEN_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 220000,
      baseRentPerSqftMonth: 0, // hospitality doesn't use rent × sqft
      hospitalityKeys: 250,
      hospitalityADRBase: 7500,
      hospitalityADRPeak: 11500,
      hospitalityPeakShare: 0.30,
      hospitalityOccupancyPct: 0.70,
      hospitalityStabilizationYear: 4,
      hospitalityHoldYears: 14,
      hospitalityConstLoanLTC: 0.55,
      hospitalityRefiLTV: 0.55,
      exitCapRate: 0.095,
      occupancyPct: 0.70,
      vacancyPct: 0.30,
      propertyTaxPerSqftYr: 40,
      landCostCr: 35,
      constructionCostPerSqft: 6400,
      approvalCostCr: 5,
      sellingCostPct: 0.025,
      gstPct: 0.0,
      stampDutyPct: 0.066,
      debtLTV: 0.55,
      debtRatePct: 0.115,
      loanTermYears: 14,
      moratoriumMonths: 36,
      discountRatePct: 0.13,
      loadingFactor: 1.25,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'MG Road',
      land_area_sqft: 90000,
      existing_fsi: 4.0,
    },
  },

  mixed_use: {
    id: 'mixed_use',
    label: 'Mixed-Use Development',
    family: 'development',
    underlyingAssetClass: 'mixed_use',
    propertyType: 'mixed_use',
    description:
      'Multi-component projects — typically residential tower + retail podium + office. ' +
      'Component-weighted P&L. Higher complexity, higher returns when balanced.',
    marketContext: 'Bengaluru CBD + ORR — Brigade Gateway / Embassy ONE pattern.',
    supportedDealStructures: ['outright_purchase', 'jda_revenue_share', 'jda_area_share', 'development_management'],
    supportedExitStrategies: ['outright_sale', 'phased_sale', 'partial_sale_partial_hold'],
    projectDurationMonths: FORTY_EIGHT_MONTH_DEV,
    inputDefaults: {
      saleableAreaSqft: 550000,
      sellingRatePerSqft: 10500,
      landCostCr: 120,
      constructionCostPerSqft: 5800,
      approvalCostCr: 12,
      escalationPct: 0.06,
      salesVelocityPct: 0.14,
      salesLagQuarters: 3,
      constructionLagQuarters: 2,
      customerCollectionPct: 0.80,
      marketingCostPct: 0.04,
      financeCostPct: 0.02,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.55,
      debtRatePct: 0.115,
      loanTermYears: 6,
      moratoriumMonths: 18,
      discountRatePct: 0.16,
      developerMarginPct: 0.20,
      loadingFactor: 1.30,
      mixUseResidentialShare: 0.50,
      mixUseOfficeShare: 0.30,
      mixUseRetailShare: 0.15,
      mixUseHospitalityShare: 0.05,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Yeshwanthpur',
      land_area_sqft: 220000,
      existing_fsi: 3.5,
    },
  },

  redevelopment: {
    id: 'redevelopment',
    label: 'Redevelopment',
    family: 'development',
    underlyingAssetClass: 'redevelopment',
    propertyType: 'redevelopment',
    description:
      'Society redevelopment — existing built-up replaced with new construction. ' +
      'Bombay / Bengaluru cluster redev. Typically area-share with existing residents.',
    marketContext: 'Mumbai SRA / cluster redev + Bengaluru old-society uplift.',
    supportedDealStructures: ['jda_area_share', 'jda_revenue_share', 'development_management'],
    supportedExitStrategies: ['outright_sale', 'phased_sale'],
    projectDurationMonths: FORTY_EIGHT_MONTH_DEV,
    inputDefaults: {
      saleableAreaSqft: 280000,
      sellingRatePerSqft: 13500,
      landCostCr: 0, // landowner contributes via area-share
      constructionCostPerSqft: 5200,
      approvalCostCr: 10,
      escalationPct: 0.06,
      salesVelocityPct: 0.15,
      salesLagQuarters: 4,
      constructionLagQuarters: 3,
      customerCollectionPct: 0.85,
      marketingCostPct: 0.04,
      financeCostPct: 0.02,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.45,
      debtRatePct: 0.12,
      loanTermYears: 5,
      moratoriumMonths: 12,
      discountRatePct: 0.18,
      developerMarginPct: 0.18,
      loadingFactor: 1.30,
      jvDevPct: 0.55,
      jvLandPct: 0.45,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Basavanagudi',
      land_area_sqft: 90000,
      existing_fsi: 2.5,
    },
  },

  raw_land: {
    id: 'raw_land',
    label: 'Raw Land / Land Banking',
    family: 'development',
    underlyingAssetClass: 'raw_land',
    propertyType: 'raw_land',
    description:
      'Pre-conversion agricultural / undeveloped land. Hold-and-flip strategy. ' +
      'Karnataka 79A/79B compliance, conversion DC, layout approval timeline.',
    marketContext: 'Bengaluru fringe — Devanahalli / Hoskote / Doddaballapur ₹1.5–4 Cr/acre raw, conversion-ready 2–3×.',
    supportedDealStructures: ['outright_purchase', 'jda_revenue_share', 'platform_investment'],
    supportedExitStrategies: ['outright_sale', 'phased_sale', 'hold_strategy'],
    projectDurationMonths: 36,
    inputDefaults: {
      saleableAreaSqft: 0, // raw land has no built-up
      sellingRatePerSqft: 0,
      landCostCr: 25,
      constructionCostPerSqft: 0,
      approvalCostCr: 2, // conversion + layout
      escalationPct: 0.10,
      salesVelocityPct: 0.10,
      gstPct: 0,
      stampDutyPct: 0.066,
      debtLTV: 0.30,
      debtRatePct: 0.14,
      loanTermYears: 3,
      moratoriumMonths: 0,
      discountRatePct: 0.20,
      developerMarginPct: 0.40,
      rawLandTitleMonths: 3,
      rawLandConversionMonths: 6,
      rawLandLayoutMonths: 9,
      rawLandCurrentStage: 'title_diligence',
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Doddaballapur',
      land_area_sqft: 220000,
      existing_fsi: 0,
    },
  },

  // ── Mapped asset classes (Phase 2 = add standalone branches) ────────
  data_centres: {
    id: 'data_centres',
    label: 'Data Centres',
    family: 'income',
    underlyingAssetClass: 'industrial_warehousing', // closest financial structure
    propertyType: 'industrial_warehousing',
    description:
      'Tier-3/Tier-4 hyperscale data centres. Long-tenor leases (12–20 years), high capex / sqft, ' +
      'low vacancy. Power + water + connectivity infrastructure critical. Operator override required for ' +
      'IT-load-density inputs.',
    marketContext: 'Mumbai / Chennai / Hyderabad lead; Bengaluru growing — ₹85–110/sqft/mo.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'built_to_suit'],
    supportedExitStrategies: ['sale_to_institutional', 'hold_to_lease', 'lrd_refinance'],
    projectDurationMonths: FOURTEEN_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 250000,
      baseRentPerSqftMonth: 95,
      rentEscalationPct: 0.04,
      occupancyPct: 0.95,
      vacancyPct: 0.05,
      otherIncomePerSqft: 0,
      leaseUpPeriodQuarters: 4,
      propertyTaxPerSqftYr: 25,
      insurancePct: 0.015,
      propMgmtPct: 0.02,
      utilitiesPct: 0.0, // tenant pays power directly
      maintenancePct: 0.02,
      capExReservePct: 0.05,
      landCostCr: 60,
      constructionCostPerSqft: 18000, // very high capex (UPS / chillers / fire suppression)
      approvalCostCr: 8,
      exitCapRate: 0.085,
      sellingCostPct: 0.02,
      gstPct: 0,
      stampDutyPct: 0.066,
      debtLTV: 0.55,
      debtRatePct: 0.105,
      loanTermYears: 15,
      moratoriumMonths: 18,
      discountRatePct: 0.13,
      loadingFactor: 1.10,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Whitefield',
      land_area_sqft: 200000,
      existing_fsi: 1.25,
    },
  },

  co_living: {
    id: 'co_living',
    label: 'Co-living',
    family: 'income',
    underlyingAssetClass: 'residential_apartments',
    propertyType: 'residential_apartments',
    description:
      'Shared-living rentable accommodations — Stanza Living / Zolo / Colive model. ' +
      'Per-bed rates, high turnover, F&B + housekeeping ancillary income. Furnished.',
    marketContext: 'Bengaluru — ₹14k–24k/bed/mo HSR / Whitefield / Koramangala.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'sale_and_leaseback'],
    supportedExitStrategies: ['sale_to_institutional', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 80000,
      baseRentPerSqftMonth: 60, // converted from per-bed
      rentEscalationPct: 0.07,
      occupancyPct: 0.85,
      vacancyPct: 0.15,
      otherIncomePerSqft: 180, // F&B / housekeeping / amenities
      leaseUpPeriodQuarters: 3,
      propertyTaxPerSqftYr: 30,
      insurancePct: 0.015,
      propMgmtPct: 0.08, // high — operating-intensive
      utilitiesPct: 0.06,
      maintenancePct: 0.07,
      capExReservePct: 0.05,
      landCostCr: 25,
      constructionCostPerSqft: 5500,
      approvalCostCr: 3,
      exitCapRate: 0.095,
      sellingCostPct: 0.02,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.50,
      debtRatePct: 0.115,
      loanTermYears: 8,
      moratoriumMonths: 12,
      discountRatePct: 0.16,
      loadingFactor: 1.20,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'HSR Layout',
      land_area_sqft: 25000,
      existing_fsi: 3.25,
    },
  },

  student_housing: {
    id: 'student_housing',
    label: 'Student Housing',
    family: 'income',
    underlyingAssetClass: 'residential_apartments',
    propertyType: 'residential_apartments',
    description:
      'Purpose-built student accommodation near universities. Annual lease cycles aligned with ' +
      'academic year. High occupancy near top campuses.',
    marketContext: 'Manipal / Bengaluru / Pune university clusters — ₹10k–18k/bed/mo.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'built_to_suit'],
    supportedExitStrategies: ['sale_to_institutional', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 100000,
      baseRentPerSqftMonth: 45,
      rentEscalationPct: 0.06,
      occupancyPct: 0.92,
      vacancyPct: 0.08,
      otherIncomePerSqft: 120,
      leaseUpPeriodQuarters: 2,
      propertyTaxPerSqftYr: 25,
      insurancePct: 0.015,
      propMgmtPct: 0.07,
      utilitiesPct: 0.05,
      maintenancePct: 0.06,
      capExReservePct: 0.04,
      landCostCr: 30,
      constructionCostPerSqft: 4800,
      approvalCostCr: 3,
      exitCapRate: 0.090,
      sellingCostPct: 0.02,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.55,
      debtRatePct: 0.11,
      loanTermYears: 10,
      moratoriumMonths: 12,
      discountRatePct: 0.15,
      loadingFactor: 1.15,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Yelahanka',
      land_area_sqft: 50000,
      existing_fsi: 2.75,
    },
  },

  senior_living: {
    id: 'senior_living',
    label: 'Senior Living',
    family: 'income',
    underlyingAssetClass: 'residential_apartments',
    propertyType: 'residential_apartments',
    description:
      'Assisted-living / retirement communities. Higher service component than apartments. ' +
      'Long tenancy, lower turnover. Healthcare partnerships common.',
    marketContext: 'Pune / Coimbatore / Bengaluru — Antara / Athulya / Columbia Pacific.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'jda_revenue_share'],
    supportedExitStrategies: ['sale_to_institutional', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 150000,
      baseRentPerSqftMonth: 55,
      rentEscalationPct: 0.07,
      occupancyPct: 0.88,
      vacancyPct: 0.12,
      otherIncomePerSqft: 220, // healthcare + F&B + housekeeping
      leaseUpPeriodQuarters: 6,
      propertyTaxPerSqftYr: 35,
      insurancePct: 0.02,
      propMgmtPct: 0.09,
      utilitiesPct: 0.06,
      maintenancePct: 0.07,
      capExReservePct: 0.04,
      landCostCr: 40,
      constructionCostPerSqft: 5200,
      approvalCostCr: 4,
      exitCapRate: 0.090,
      sellingCostPct: 0.025,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.50,
      debtRatePct: 0.115,
      loanTermYears: 10,
      moratoriumMonths: 18,
      discountRatePct: 0.15,
      loadingFactor: 1.25,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Sarjapur',
      land_area_sqft: 90000,
      existing_fsi: 2.5,
    },
  },

  build_to_rent: {
    id: 'build_to_rent',
    label: 'Build-to-Rent (BTR)',
    family: 'income',
    underlyingAssetClass: 'residential_apartments',
    propertyType: 'residential_apartments',
    description:
      'Purpose-built rental apartments — single-owner, professionally managed. Emerging asset ' +
      'class in India following global PRS / multifamily model.',
    marketContext: 'Bengaluru / Mumbai pilots — ₹40k–80k/unit/mo institutional rentals.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'forward_purchase', 'built_to_suit'],
    supportedExitStrategies: ['sale_to_institutional', 'reit_exit', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 280000,
      baseRentPerSqftMonth: 42,
      rentEscalationPct: 0.07,
      occupancyPct: 0.93,
      vacancyPct: 0.07,
      otherIncomePerSqft: 90,
      leaseUpPeriodQuarters: 4,
      propertyTaxPerSqftYr: 32,
      insurancePct: 0.01,
      propMgmtPct: 0.05,
      utilitiesPct: 0.04,
      maintenancePct: 0.05,
      capExReservePct: 0.04,
      landCostCr: 55,
      constructionCostPerSqft: 5200,
      approvalCostCr: 5,
      exitCapRate: 0.085,
      sellingCostPct: 0.02,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.55,
      debtRatePct: 0.105,
      loanTermYears: 12,
      moratoriumMonths: 18,
      discountRatePct: 0.14,
      loadingFactor: 1.25,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Sarjapur',
      land_area_sqft: 110000,
      existing_fsi: 3.0,
    },
  },

  logistics_parks: {
    id: 'logistics_parks',
    label: 'Logistics Parks',
    family: 'income',
    underlyingAssetClass: 'industrial_warehousing',
    propertyType: 'industrial_warehousing',
    description:
      'Multi-tenant Grade-A logistics campuses with dock-levellers, racking, multi-modal access. ' +
      'Anchored by 3PL / e-commerce tenants (Amazon / Flipkart / DHL).',
    marketContext: 'Bengaluru — Hoskote / Nelamangala / Hosur clusters ₹22–28/sqft/mo.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'forward_purchase'],
    supportedExitStrategies: ['sale_to_institutional', 'reit_exit', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 1200000, // multi-building campus
      baseRentPerSqftMonth: 23,
      rentEscalationPct: 0.05,
      occupancyPct: 0.94,
      vacancyPct: 0.06,
      otherIncomePerSqft: 50,
      leaseUpPeriodQuarters: 3,
      propertyTaxPerSqftYr: 12,
      insurancePct: 0.01,
      propMgmtPct: 0.02,
      utilitiesPct: 0.02,
      maintenancePct: 0.03,
      capExReservePct: 0.03,
      landCostCr: 80,
      constructionCostPerSqft: 2200,
      approvalCostCr: 6,
      exitCapRate: 0.080,
      sellingCostPct: 0.02,
      gstPct: 0,
      stampDutyPct: 0.066,
      debtLTV: 0.60,
      debtRatePct: 0.105,
      loanTermYears: 12,
      moratoriumMonths: 12,
      discountRatePct: 0.13,
      loadingFactor: 1.05,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Nelamangala',
      land_area_sqft: 1000000,
      existing_fsi: 1.25,
    },
  },

  flex_spaces: {
    id: 'flex_spaces',
    label: 'Flex / Managed Spaces',
    family: 'income',
    underlyingAssetClass: 'commercial_office',
    propertyType: 'commercial_office',
    description:
      'Managed-office / co-working — WeWork / Awfis / Smartworks model. Higher rent per sqft ' +
      'than headline office (operator margin) but higher churn, higher fit-out depreciation.',
    marketContext: 'Bengaluru — ₹13k–22k/seat/mo. Effective rent ~₹140–180/sqft/mo (= 1.4× headline).',
    supportedDealStructures: ['outright_purchase', 'sale_and_leaseback', 'platform_investment'],
    supportedExitStrategies: ['sale_to_institutional', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 80000,
      baseRentPerSqftMonth: 160, // operator-margin lift over headline
      rentEscalationPct: 0.05,
      occupancyPct: 0.85,
      vacancyPct: 0.15,
      otherIncomePerSqft: 300, // membership add-ons / events / printing
      leaseUpPeriodQuarters: 4,
      propertyTaxPerSqftYr: 50,
      insurancePct: 0.015,
      propMgmtPct: 0.06,
      utilitiesPct: 0.06,
      maintenancePct: 0.06,
      capExReservePct: 0.06, // fit-out churn
      landCostCr: 0, // tenant model — operates from leased space typically
      constructionCostPerSqft: 4500, // fit-out
      approvalCostCr: 1,
      exitCapRate: 0.105,
      sellingCostPct: 0.025,
      gstPct: 0,
      stampDutyPct: 0.066,
      debtLTV: 0.40,
      debtRatePct: 0.12,
      loanTermYears: 6,
      moratoriumMonths: 6,
      discountRatePct: 0.16,
      loadingFactor: 1.35,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Koramangala',
      land_area_sqft: 30000,
      existing_fsi: 3.25,
    },
  },

  sez_business_parks: {
    id: 'sez_business_parks',
    label: 'SEZ / Business Parks',
    family: 'income',
    underlyingAssetClass: 'commercial_office',
    propertyType: 'commercial_office',
    description:
      'SEZ (Special Economic Zone) IT/ITeS campuses. Pre-2020 SEZ benefits sunset; post-2020 ' +
      'DESH Bill regime. Multi-tower, campus-style. IT-tenant heavy.',
    marketContext: 'Bengaluru — Manyata / Bagmane / Embassy Tech ₹95–120/sqft/mo SEZ-blended.',
    supportedDealStructures: ['outright_purchase', 'platform_investment', 'forward_purchase'],
    supportedExitStrategies: ['sale_to_institutional', 'reit_exit', 'hold_to_lease'],
    projectDurationMonths: FIVE_YEAR_INCOME,
    inputDefaults: {
      saleableAreaSqft: 1500000, // multi-tower campus
      baseRentPerSqftMonth: 100,
      rentEscalationPct: 0.05,
      occupancyPct: 0.91,
      vacancyPct: 0.09,
      otherIncomePerSqft: 280,
      leaseUpPeriodQuarters: 6,
      propertyTaxPerSqftYr: 38,
      insurancePct: 0.01,
      propMgmtPct: 0.03,
      utilitiesPct: 0.04,
      maintenancePct: 0.05,
      capExReservePct: 0.04,
      landCostCr: 220,
      constructionCostPerSqft: 6500,
      approvalCostCr: 15,
      exitCapRate: 0.080,
      sellingCostPct: 0.02,
      gstPct: 0,
      stampDutyPct: 0.066,
      debtLTV: 0.60,
      debtRatePct: 0.105,
      loanTermYears: 15,
      moratoriumMonths: 24,
      discountRatePct: 0.135,
      loadingFactor: 1.35,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Hebbal',
      land_area_sqft: 600000,
      existing_fsi: 3.25,
    },
  },

  township: {
    id: 'township',
    label: 'Township Development',
    family: 'development',
    underlyingAssetClass: 'mixed_use',
    propertyType: 'mixed_use',
    description:
      'Integrated township — 100+ acre master plans with residential, retail, schools, hospitals. ' +
      'Phased over 8–12 years. Karnataka Township policy applies above 100 acres.',
    marketContext: 'Bengaluru — Prestige White Meadows / Brigade Cosmopolis / Sobha Dream.',
    supportedDealStructures: ['outright_purchase', 'jda_revenue_share', 'jda_area_share', 'platform_investment'],
    supportedExitStrategies: ['phased_sale', 'partial_sale_partial_hold'],
    projectDurationMonths: 96,
    inputDefaults: {
      saleableAreaSqft: 2500000, // master plan total
      sellingRatePerSqft: 8500,
      landCostCr: 280,
      constructionCostPerSqft: 4200,
      approvalCostCr: 35,
      escalationPct: 0.06,
      salesVelocityPct: 0.08, // phased absorption
      salesLagQuarters: 4,
      constructionLagQuarters: 3,
      customerCollectionPct: 0.80,
      marketingCostPct: 0.05,
      financeCostPct: 0.03,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      debtLTV: 0.50,
      debtRatePct: 0.115,
      loanTermYears: 10,
      moratoriumMonths: 24,
      discountRatePct: 0.16,
      developerMarginPct: 0.20,
      loadingFactor: 1.25,
      mixUseResidentialShare: 0.65,
      mixUseRetailShare: 0.10,
      mixUseOfficeShare: 0.15,
      mixUseHospitalityShare: 0.10,
    },
    propertyDefaults: {
      city: 'Bengaluru',
      micro_market: 'Devanahalli',
      land_area_sqft: 4500000,
      existing_fsi: 1.5,
    },
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Deal-structure registry — labels + which asset classes accept which
// ──────────────────────────────────────────────────────────────────────────
const DEAL_STRUCTURE_REGISTRY = {
  outright_purchase: {
    id: 'outright_purchase',
    label: 'Outright Purchase',
    description: 'Buyer pays full consideration upfront; takes 100% economic interest. Most common for income assets.',
  },
  jda_revenue_share: {
    id: 'jda_revenue_share',
    label: 'JDA — Revenue Share',
    description: 'Joint Development Agreement; landowner gets % of gross sales revenue.',
  },
  jda_area_share: {
    id: 'jda_area_share',
    label: 'JDA — Area Share',
    description: 'Joint Development Agreement; landowner gets % of built-up area allocated.',
  },
  development_management: {
    id: 'development_management',
    label: 'Development Management (DM)',
    description: 'Developer earns a management fee; no equity stake. Pure-service model.',
  },
  platform_investment: {
    id: 'platform_investment',
    label: 'Platform Investment',
    description: 'PE / institutional equity investment into an operating platform across multiple assets.',
  },
  forward_purchase: {
    id: 'forward_purchase',
    label: 'Forward Purchase',
    description: 'Pre-committed purchase at a future stabilised date; price locked at signing.',
  },
  built_to_suit: {
    id: 'built_to_suit',
    label: 'Built-to-Suit (BTS)',
    description: 'Developer constructs to a specific tenant\'s spec; long lease pre-committed.',
  },
  sale_and_leaseback: {
    id: 'sale_and_leaseback',
    label: 'Sale & Leaseback',
    description: 'Owner-occupier sells the asset and leases it back; capital release without operational disruption.',
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Exit-strategy registry — labels + applicability
// ──────────────────────────────────────────────────────────────────────────
const EXIT_STRATEGY_REGISTRY = {
  outright_sale: { id: 'outright_sale', label: 'Outright Sale', description: 'Sell the whole asset to a single buyer in a single transaction.' },
  phased_sale: { id: 'phased_sale', label: 'Phased Sale', description: 'Sell units / portions over multiple quarters as construction progresses.' },
  partial_sale_partial_hold: { id: 'partial_sale_partial_hold', label: 'Partial Sale + Partial Hold', description: 'Sell some units, retain others as rental income.' },
  sale_to_institutional: { id: 'sale_to_institutional', label: 'Sale to Institutional Buyer', description: 'Cap-rate-based exit to a domestic / foreign institutional investor.' },
  reit_exit: { id: 'reit_exit', label: 'REIT Listing', description: 'Contribute to a REIT in exchange for units; provides liquidity + tax efficiency.' },
  lrd_refinance: { id: 'lrd_refinance', label: 'LRD Refinance', description: 'Lease Rental Discounting — refinance against stabilised rental income.' },
  hold_to_lease: { id: 'hold_to_lease', label: 'Hold to Lease (Long-Term)', description: 'Retain ownership; harvest recurring rental income.' },
  hold_strategy: { id: 'hold_strategy', label: 'Hold Strategy', description: 'Hold for appreciation; no near-term exit (typical for raw land).' },
};

// ──────────────────────────────────────────────────────────────────────────
// Validator-compatibility maps
// ──────────────────────────────────────────────────────────────────────────
// buildWorkbook.js currently enforces a tight allowlist on deal-structure /
// exit-strategy values (line 1019-1020 of buildWorkbook.js). The Phase-1
// template library adds 4 new deal structures and 8 new exit strategies on
// the user-facing surface — we map them to the closest validator-allowed
// values when building the actual workbook context. Phase 2 = widen the
// allowlist + add standalone branches for the new structures.
const VALIDATOR_DEAL_STRUCTURE_MAP = {
  outright_purchase: 'outright_purchase',
  jda_revenue_share: 'jda_revenue_share',
  jda_area_share: 'jda_area_share',
  development_management: 'development_management',
  // Phase-2 stubs — map to closest allowed value for now.
  platform_investment: 'outright_purchase',
  forward_purchase: 'outright_purchase',
  built_to_suit: 'outright_purchase',
  sale_and_leaseback: 'outright_purchase',
};

const VALIDATOR_DEV_EXIT_MAP = {
  outright_sale: 'outright_progressive',
  phased_sale: 'outright_progressive',
  partial_sale_partial_hold: 'hold_post_completion',
  hold_strategy: 'hold_post_completion',
  // Income strategies on a dev template — fall through to bulk-completion
  // (closest dev-family equivalent of an institutional buyer transaction).
  sale_to_institutional: 'bulk_exit_completion',
  reit_exit: 'bulk_exit_completion',
  lrd_refinance: 'hold_post_completion',
  hold_to_lease: 'hold_post_completion',
};

const VALIDATOR_INCOME_EXIT_MAP = {
  sale_to_institutional: 'strategic_sale',
  reit_exit: 'reit_exit',
  lrd_refinance: 'refinance_hold',
  hold_to_lease: 'hold_to_perpetuity',
  hold_strategy: 'hold_to_perpetuity',
  // Dev strategies on an income template — closest fallbacks.
  outright_sale: 'strategic_sale',
  phased_sale: 'strategic_sale',
  partial_sale_partial_hold: 'hold_to_perpetuity',
};

// ──────────────────────────────────────────────────────────────────────────
// Template context builder
// ──────────────────────────────────────────────────────────────────────────
/**
 * Build a synthetic "blank template" context that feeds buildDealWorkbookV2.
 *
 * @param {string} assetClassId - one of ASSET_CLASS_REGISTRY keys
 * @param {string} dealStructureId - one of DEAL_STRUCTURE_REGISTRY keys
 * @param {string} [exitStrategyId] - optional exit strategy
 * @returns {object} context shaped like an exportContext that buildDealWorkbookV2 accepts
 * @throws {Error} if assetClassId or dealStructureId is invalid
 */
const buildBlankTemplateContext = (assetClassId, dealStructureId, exitStrategyId) => {
  const assetMeta = ASSET_CLASS_REGISTRY[assetClassId];
  if (!assetMeta) {
    const valid = Object.keys(ASSET_CLASS_REGISTRY).join(', ');
    throw new Error(`Unknown asset class "${assetClassId}". Valid: ${valid}`);
  }

  if (!assetMeta.supportedDealStructures.includes(dealStructureId)) {
    const valid = assetMeta.supportedDealStructures.join(', ');
    throw new Error(`Deal structure "${dealStructureId}" not supported for ${assetClassId}. Valid: ${valid}`);
  }

  const resolvedExit = exitStrategyId && assetMeta.supportedExitStrategies.includes(exitStrategyId)
    ? exitStrategyId
    : assetMeta.supportedExitStrategies[0];

  // Map user-facing structure / exit IDs onto the validator's allowed set
  // (see buildWorkbook.js line 1017-1020). The user-facing label is kept on
  // the deal record for display; the workbook itself uses the validator-
  // compatible value.
  const validatorStructure = VALIDATOR_DEAL_STRUCTURE_MAP[dealStructureId] || 'outright_purchase';
  const exitMap = assetMeta.family === 'income' ? VALIDATOR_INCOME_EXIT_MAP : VALIDATOR_DEV_EXIT_MAP;
  const validatorExit = exitMap[resolvedExit]
    || (assetMeta.family === 'income' ? 'strategic_sale' : 'outright_progressive');

  // Patch a couple of asset-class-specific blockers from the validator:
  // - JDA / development-management structures require landownerSharePct ∈ (0,1).
  //   Default to 0.40 (40% landowner share) — typical Bengaluru JDA economics.
  // - Income family requires baseRentPerSqftMonth > 0 even for hospitality
  //   (where ADR is the real driver). Seed a proxy value from the
  //   hospitality ADR if zero so the validator passes.
  // - Raw land requires sellRatePerSqft > 0 (per-sqft land selling rate).
  const patchedInputs = { ...assetMeta.inputDefaults };
  if (['jda_revenue_share', 'jda_area_share', 'development_management'].includes(validatorStructure)) {
    if (!(patchedInputs.landownerSharePct > 0 && patchedInputs.landownerSharePct < 1)) {
      patchedInputs.landownerSharePct = 0.40;
    }
  }
  if (assetMeta.family === 'income' && !(patchedInputs.baseRentPerSqftMonth > 0)) {
    // For hospitality, derive a rent-per-sqft-month proxy from the ADR.
    // (ADR × ~30 nights × occupancy / ~500 sqft per key). 75 is a reasonable
    // institutional benchmark for hospitality on a per-sqft basis.
    patchedInputs.baseRentPerSqftMonth = 75;
  }
  // The builder's `sellRatePerSqftFor()` (line 343) reads
  // `ctx.inputs.sellingRatePerSqft` — note the "-ing" suffix. Validator
  // also reads from the same getter via core.sellRatePerSqft. Mirror the
  // value into the right field name.
  if (assetMeta.underlyingAssetClass === 'raw_land' && !(patchedInputs.sellingRatePerSqft > 0)) {
    // Raw land sells per-acre or per-sqft. Use ₹1,800/sqft as a Bengaluru-fringe
    // converted-layout-ready benchmark (₹78L per cent / ~436 sqft).
    patchedInputs.sellingRatePerSqft = 1800;
  }

  // Templates are NOT linked to a real DB deal record; we pass a synthetic
  // deal + property pair. The builder reads model_params.inputs for the
  // operator-editable values and the deal-level fields for asset class /
  // structure / dates.
  const ctx = {
    deal: {
      id: `template-${assetClassId}-${dealStructureId}`,
      name: `${assetMeta.label} — ${DEAL_STRUCTURE_REGISTRY[dealStructureId].label} Template`,
      asset_class: assetMeta.underlyingAssetClass,
      property_type: assetMeta.propertyType,
      deal_type: validatorStructure,
      deal_structure: validatorStructure,
      exit_strategy: validatorExit,
      // Display-friendly labels (not used by validator, just for header /
      // sheet titles).
      deal_structure_display: DEAL_STRUCTURE_REGISTRY[dealStructureId].label,
      exit_strategy_display: EXIT_STRATEGY_REGISTRY[resolvedExit].label,
      city: assetMeta.propertyDefaults.city,
      state: 'Karnataka',
      project_duration_months: assetMeta.projectDurationMonths,
      model_params: {
        inputs: patchedInputs,
      },
    },
    property: {
      property_name: `${assetMeta.label} — Reference Template`,
      property_type: assetMeta.propertyType,
      ...assetMeta.propertyDefaults,
      saleable_area_sqft: patchedInputs.saleableAreaSqft,
    },
  };

  return ctx;
};

// ──────────────────────────────────────────────────────────────────────────
// Public catalog (for the frontend templates page)
// ──────────────────────────────────────────────────────────────────────────
const listTemplateCatalog = () => Object.values(ASSET_CLASS_REGISTRY).map((meta) => ({
  id: meta.id,
  label: meta.label,
  family: meta.family,
  description: meta.description,
  marketContext: meta.marketContext,
  supportedDealStructures: meta.supportedDealStructures.map((dsId) => ({
    id: dsId,
    label: DEAL_STRUCTURE_REGISTRY[dsId].label,
    description: DEAL_STRUCTURE_REGISTRY[dsId].description,
  })),
  supportedExitStrategies: meta.supportedExitStrategies.map((esId) => ({
    id: esId,
    label: EXIT_STRATEGY_REGISTRY[esId].label,
    description: EXIT_STRATEGY_REGISTRY[esId].description,
  })),
  projectDurationMonths: meta.projectDurationMonths,
  inputDefaults: meta.inputDefaults,
}));

module.exports = {
  ASSET_CLASS_REGISTRY,
  DEAL_STRUCTURE_REGISTRY,
  EXIT_STRATEGY_REGISTRY,
  buildBlankTemplateContext,
  listTemplateCatalog,
};
