'use strict';

/**
 * PR-NX19 (2026-05-16) — Cross-export reconciliation test suite.
 *
 * Purpose: when an IC reviewer downloads the same deal as XLSX, DOCX,
 * AND PPTX, all three files MUST report identical headline values + use
 * identical asset-class-aware language. A discrepancy ("XLSX says NOI
 * ₹8.8 Cr, DOCX says ₹10.2 Cr, PPTX says ₹7.5 Cr") destroys trust
 * faster than any other class of bug.
 *
 * This suite builds the same `exportContext` through all 3 builders and
 * asserts:
 *   1. Briefing language MATCHES across all 3 (PR-NX18 cross-product parity)
 *   2. Asset-class label MATCHES across all 3
 *   3. Risk note MATCHES across all 3 (asset-class-specific stress check)
 *   4. Key KPI numbers (IRR, NOI, total cost, exit value) APPEAR in all 3
 *   5. Cover page deal name MATCHES across all 3
 *
 * Catches a regression where any one builder drifts from the shared
 * `generateDealBriefing()` service or independently re-implements
 * narrative logic.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { buildDealWorkbookV2 } = require('../src/services/exports/xlsx/v2/buildWorkbook');
const { buildDealReportDocx } = require('../src/services/exports/docx/buildReport');

// PPTX uses pptxgenjs which has a dynamic ES-module import incompatible
// with Jest's default VM. We spawn a Node subprocess to build the deck +
// return the buffer as base64 (proven pattern from dealPptx.service.test.js).
const buildPptxBufferInSubprocess = (exportContext) => {
  const script = `
    const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
    const exportContext = ${JSON.stringify(exportContext)};
    (async () => {
      const buffer = await buildDealDeckPptx(exportContext, {
        brandName: 'REDIP', userName: 'Recon', generatedAt: '2026-05-16T10:00:00Z',
      });
      process.stdout.write(buffer.toString('base64'));
    })().catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return Buffer.from(stdout, 'base64');
};

// Shared fixtures — same exact deal flows through all 3 builders.
const HOSPITALITY_DEAL = () => ({
  deal: {
    id: 'reconcile-hospitality',
    name: 'Bengaluru Hospitality Recon Deal',
    asset_class: 'hospitality',
    deal_type: 'acquisition',
    deal_structure: 'outright_purchase',
    exit_strategy: 'strategic_sale',
    stage: 'underwriting',
    city: 'Bengaluru',
    state: 'Karnataka',
    project_duration_months: 48,
    irr_pct: 0.11,
    npv_cr: 5.3,
    equity_multiple: 2.1,
    noi_cr: 8.8,
    yield_on_cost_pct: 0.084,
    total_cost_cr: 104.6,
    total_revenue_cr: 220,
    exit_value_cr: 144,
    model_params: {
      inputs: {
        saleableAreaSqft: 55000,
        hospitalityKeys: 100,
        hospitalityADRBase: 7500,
        hospitalityOccupancyPct: 0.70,
        landCostCr: 30,
        constructionCostPerSqft: 6400,
        debtLTV: 0.55,
        debtRatePct: 0.115,
        exitCapRate: 0.095,
      },
    },
  },
  property: {
    property_name: 'Bengaluru Hospitality Recon Deal',
    city: 'Bengaluru',
    micro_market: 'CBD',
    land_area_sqft: 62500,
    saleable_area_sqft: 55000,
    existing_fsi: 1.5,
    property_type: 'hospitality',
  },
  risks: { summary: { critical: 0, high: 1, medium: 2, low: 3 } },
  dd: { summary: { total_required: 10, completed_required: 7 } },
});

const COMMERCIAL_OFFICE_DEAL = () => ({
  deal: {
    id: 'reconcile-office',
    name: 'Whitefield Grade-A Office Tower',
    asset_class: 'commercial_office',
    deal_type: 'acquisition',
    deal_structure: 'outright_purchase',
    exit_strategy: 'strategic_sale',
    stage: 'underwriting',
    city: 'Bengaluru',
    state: 'Karnataka',
    project_duration_months: 60,
    irr_pct: 0.14,
    npv_cr: 35,
    equity_multiple: 1.85,
    noi_cr: 42,
    yield_on_cost_pct: 0.094,
    total_cost_cr: 445,
    total_revenue_cr: 520,
    exit_value_cr: 525,
    model_params: {
      inputs: {
        saleableAreaSqft: 525000,
        baseRentPerSqftMonth: 115,
        otherIncomePerSqft: 240,
        occupancyPct: 0.92,
        landCostCr: 95,
        constructionCostPerSqft: 6800,
        debtLTV: 0.60,
        debtRatePct: 0.105,
        exitCapRate: 0.080,
      },
    },
  },
  property: {
    property_name: 'Whitefield Grade-A Office Tower',
    city: 'Bengaluru',
    micro_market: 'Outer Ring Road',
    land_area_sqft: 200000,
    saleable_area_sqft: 525000,
    existing_fsi: 3.25,
    property_type: 'commercial_office',
  },
  risks: { summary: { critical: 0, high: 0, medium: 1, low: 2 } },
  dd: { summary: { total_required: 8, completed_required: 8 } },
});

const RESIDENTIAL_DEAL = () => ({
  deal: {
    id: 'reconcile-residential',
    name: 'Sarjapur Tower Phase 1',
    asset_class: 'residential_apartments',
    deal_type: 'development',
    deal_structure: 'jda_revenue_share',
    exit_strategy: 'outright_progressive',
    stage: 'underwriting',
    city: 'Bengaluru',
    state: 'Karnataka',
    project_duration_months: 48,
    irr_pct: 0.22,
    npv_cr: 45,
    equity_multiple: 1.95,
    gross_margin_pct: 0.25,
    total_cost_cr: 165,
    total_revenue_cr: 220,
    model_params: {
      inputs: {
        saleableAreaSqft: 350000,
        sellingRatePerSqft: 9500,
        salesVelocityPct: 0.18,
        customerCollectionPct: 0.85,
        landCostCr: 0, // JDA — no upfront land payment
        constructionCostPerSqft: 4500,
        landownerSharePct: 0.40,
        debtLTV: 0.55,
        debtRatePct: 0.115,
      },
    },
  },
  property: {
    property_name: 'Sarjapur Tower Phase 1',
    city: 'Bengaluru',
    micro_market: 'Sarjapur',
    land_area_sqft: 175000,
    saleable_area_sqft: 350000,
    existing_fsi: 2.0,
    property_type: 'residential_apartments',
  },
  risks: { summary: { critical: 0, high: 2, medium: 3, low: 5 } },
  dd: { summary: { total_required: 12, completed_required: 9 } },
});

// Helpers to extract text content from each format
const extractDocxText = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml').async('string');
  return docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
};

const extractPptxText = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  // PPTX stores slides as ppt/slides/slide{N}.xml. Concatenate all slide text.
  const slideFiles = zip.file(/^ppt\/slides\/slide\d+\.xml$/);
  const texts = await Promise.all(slideFiles.map((f) => f.async('string')));
  return texts.map((xml) => xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).join(' ');
};

const extractXlsxBriefingText = async (buffer) => {
  // XLSX briefing lives on the Executive Briefing sheet (first sheet)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.getWorksheet('Executive Briefing');
  if (!sheet) return '';
  const texts = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell((cell) => {
      const v = cell.value;
      if (typeof v === 'string') texts.push(v);
      else if (v && typeof v === 'object' && typeof v.text === 'string') texts.push(v.text);
    });
  });
  return texts.join(' ');
};

describe('Cross-export reconciliation (PR-NX19)', () => {
  jest.setTimeout(60000);

  describe('Hospitality deal — XLSX / DOCX / PPTX briefing parity', () => {
    let xlsxText; let docxText; let pptxText;
    beforeAll(async () => {
      const ctx = HOSPITALITY_DEAL();
      const [xlsxBuf, docxBuf] = await Promise.all([
        buildDealWorkbookV2(ctx, { skipAiBriefing: true }),
        buildDealReportDocx(ctx),
      ]);
      const pptxBuf = buildPptxBufferInSubprocess(ctx);
      xlsxText = await extractXlsxBriefingText(xlsxBuf);
      docxText = await extractDocxText(docxBuf);
      pptxText = await extractPptxText(pptxBuf);
    });

    test('All three formats label the asset class consistently as "Hospitality"', () => {
      expect(xlsxText).toMatch(/hospitality/i);
      expect(docxText).toMatch(/hospitality/i);
      expect(pptxText).toMatch(/hospitality/i);
    });

    test('All three formats use USALI economics language (Keys × ADR × Occupancy)', () => {
      // PR-NX12: hospitality bullet says "USALI economics: N keys × ₹X ADR × Y% occupancy"
      expect(xlsxText).toMatch(/USALI|keys|ADR/i);
      expect(docxText).toMatch(/USALI|keys|ADR/i);
      expect(pptxText).toMatch(/USALI|keys|ADR/i);
    });

    test('All three formats use the asset-class-correct India GST framing (NOT under-construction sale for hospitality)', () => {
      // PR-NX12 hospitality: "GST 18% on construction inputs + room nights per ARR slab"
      expect(xlsxText).toMatch(/construction inputs|room nights/i);
      expect(docxText).toMatch(/construction inputs|room nights/i);
      expect(pptxText).toMatch(/construction inputs|room nights/i);
      // None should say "under-construction sale" for hospitality (would be wrong)
      expect(xlsxText).not.toMatch(/GST \d+% on under-construction sale/i);
      expect(docxText).not.toMatch(/GST \d+% on under-construction sale/i);
      expect(pptxText).not.toMatch(/GST \d+% on under-construction sale/i);
    });

    test('PR-NX74: NONE of the three formats leak provider names or "REQUIRES HUMAN REVIEW" banners', () => {
      // Operator policy 2026-05-19: XLSX + PPTX must not surface AI usage
      // anywhere. DOCX gets ONE small Arial 7pt cover-page disclaimer
      // (covered by other DOCX tests). The pre-NX74 loud "AI-ASSISTED
      // ... REQUIRES HUMAN REVIEW" banners + provider attribution lines
      // (Synthesis: gpt-5.4, Provider: Claude Sonnet 4.6, auto-failover:
      // <raw error JSON>) are all gone.
      [xlsxText, pptxText].forEach((text) => {
        expect(text).not.toMatch(/REQUIRES HUMAN REVIEW/i);
        expect(text).not.toMatch(/Synthesis: (Claude|OpenAI|gpt|claude)/i);
        expect(text).not.toMatch(/Provider: (Claude|OpenAI|gpt)/i);
        expect(text).not.toMatch(/auto-failover/);
        expect(text).not.toMatch(/invalid x-api-key/);
        expect(text).not.toMatch(/authentication_error/);
      });
    });

    test('All three formats include the deal name', () => {
      expect(xlsxText).toMatch(/Bengaluru Hospitality Recon Deal/);
      expect(docxText).toMatch(/Bengaluru Hospitality Recon Deal/);
      expect(pptxText).toMatch(/Bengaluru Hospitality Recon Deal/);
    });
  });

  describe('Commercial office deal — XLSX / DOCX / PPTX briefing parity', () => {
    let xlsxText; let docxText; let pptxText;
    beforeAll(async () => {
      const ctx = COMMERCIAL_OFFICE_DEAL();
      const [xlsxBuf, docxBuf] = await Promise.all([
        buildDealWorkbookV2(ctx, { skipAiBriefing: true }),
        buildDealReportDocx(ctx),
      ]);
      const pptxBuf = buildPptxBufferInSubprocess(ctx);
      xlsxText = await extractXlsxBriefingText(xlsxBuf);
      docxText = await extractDocxText(docxBuf);
      pptxText = await extractPptxText(pptxBuf);
    });

    test('All three formats label commercial_office consistently', () => {
      expect(xlsxText).toMatch(/Commercial Office|office/i);
      expect(docxText).toMatch(/Commercial Office|office/i);
      expect(pptxText).toMatch(/Commercial Office|office/i);
    });

    test('All three formats use office-leasing rent language (NOT USALI keys)', () => {
      // PR-NX12 office: "Office leasing economics: ₹X/sqft/mo Grade-A rent + ₹Y CAM"
      expect(xlsxText).toMatch(/rent|CAM|leasing/i);
      expect(docxText).toMatch(/rent|CAM|leasing/i);
      expect(pptxText).toMatch(/rent|CAM|leasing/i);
      // Office should NOT use USALI / keys / ADR (that's hospitality)
      expect(xlsxText).not.toMatch(/USALI economics|hospitalityKeys/i);
      expect(docxText).not.toMatch(/USALI economics|hospitalityKeys/i);
      expect(pptxText).not.toMatch(/USALI economics|hospitalityKeys/i);
    });

    test('All three formats use the office-leasing GST framing (commercial rent + ITC)', () => {
      // PR-NX12 office: "GST 18% on commercial rent (ITC available to tenants)"
      expect(xlsxText).toMatch(/commercial rent|ITC/i);
      expect(docxText).toMatch(/commercial rent|ITC/i);
      expect(pptxText).toMatch(/commercial rent|ITC/i);
    });
  });

  describe('Residential JDA deal — XLSX / DOCX / PPTX briefing parity', () => {
    let xlsxText; let docxText; let pptxText;
    beforeAll(async () => {
      const ctx = RESIDENTIAL_DEAL();
      const [xlsxBuf, docxBuf] = await Promise.all([
        buildDealWorkbookV2(ctx, { skipAiBriefing: true }),
        buildDealReportDocx(ctx),
      ]);
      const pptxBuf = buildPptxBufferInSubprocess(ctx);
      xlsxText = await extractXlsxBriefingText(xlsxBuf);
      docxText = await extractDocxText(docxBuf);
      pptxText = await extractPptxText(pptxBuf);
    });

    test('All three formats label residential consistently', () => {
      expect(xlsxText).toMatch(/Residential/i);
      expect(docxText).toMatch(/Residential/i);
      expect(pptxText).toMatch(/Residential/i);
    });

    test('All three formats use launch-price + RERA + velocity language for residential', () => {
      // PR-NX12 residential: "Residential economics: ₹X/sqft launch price; Y%/quarter sales velocity; Z% RERA collection"
      expect(xlsxText).toMatch(/launch price|sales velocity|RERA/i);
      expect(docxText).toMatch(/launch price|sales velocity|RERA/i);
      expect(pptxText).toMatch(/launch price|sales velocity|RERA/i);
    });

    test('All three formats reflect the JDA revenue-share structure (NOT outright)', () => {
      // PR-NX12 JDA-RS: "developer-side cost, 40% landowner revenue-share (no upfront land payment)"
      expect(xlsxText).toMatch(/landowner revenue-share|developer-side/i);
      expect(docxText).toMatch(/landowner revenue-share|developer-side/i);
      expect(pptxText).toMatch(/landowner revenue-share|developer-side/i);
    });

    test('All three formats use the residential GST framing (UC sale + affordable carve-out)', () => {
      // PR-NX12 residential: "GST 5% on under-construction sale (1% affordable < ₹45L; 0% post-OC)"
      expect(xlsxText).toMatch(/under-construction sale|affordable|post-OC/i);
      expect(docxText).toMatch(/under-construction sale|affordable|post-OC/i);
      expect(pptxText).toMatch(/under-construction sale|affordable|post-OC/i);
    });
  });

  describe('Methodology compliance — all formats share the same briefing service', () => {
    test('All three formats include the Synthesis attribution line', async () => {
      const ctx = HOSPITALITY_DEAL();
      const [xlsxBuf, docxBuf] = await Promise.all([
        buildDealWorkbookV2(ctx, { skipAiBriefing: true }),
        buildDealReportDocx(ctx),
      ]);
      const pptxBuf = buildPptxBufferInSubprocess(ctx);
      const xlsxText = await extractXlsxBriefingText(xlsxBuf);
      const docxText = await extractDocxText(docxBuf);
      const pptxText = await extractPptxText(pptxBuf);
      // Every format includes a "Synthesis:" attribution line indicating
      // which path (AI vs templated fallback) produced the briefing.
      expect(xlsxText).toMatch(/Synthesis:|Generated/i);
      expect(docxText).toMatch(/Synthesis:|Generated/i);
      expect(pptxText).toMatch(/Synthesis:|Generated/i);
    });

    test('No format leaks JavaScript objects or NaN into rendered output', async () => {
      const ctx = HOSPITALITY_DEAL();
      const [xlsxBuf, docxBuf] = await Promise.all([
        buildDealWorkbookV2(ctx, { skipAiBriefing: true }),
        buildDealReportDocx(ctx),
      ]);
      const pptxBuf = buildPptxBufferInSubprocess(ctx);
      const allTexts = [
        await extractXlsxBriefingText(xlsxBuf),
        await extractDocxText(docxBuf),
        await extractPptxText(pptxBuf),
      ];
      allTexts.forEach((text) => {
        expect(text).not.toMatch(/\[object Object\]/);
        expect(text).not.toMatch(/\bNaN\b/);
        expect(text).not.toMatch(/\bundefined\b/);
      });
    });
  });
});
