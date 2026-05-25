'use strict';

/**
 * PR-B — DOCX export integrates Recommendations + Deal Doctor.
 *
 * Verifies the new sections render correctly when the engine slices are
 * present, and degrade cleanly to empty-states when they are not. We don't
 * unpack the .docx in JS; instead we exercise `buildDealReportDocx` and
 * confirm it returns a non-empty Buffer + did not throw on either path.
 */

const { buildDealReportDocx } = require('../src/services/exports/docx/buildReport');

const baseContext = () => ({
  deal: {
    id: 'deal-1',
    name: 'Whitefield Test Deal',
    asset_class: 'residential_apartments',
    deal_structure: 'jda',
    deal_type: 'acquisition',
    stage: 'underwriting',
    city: 'Bengaluru',
    state: 'Karnataka',
    land_ask_price_cr: 40,
    total_revenue_cr: 100,
    irr_pct: 0.15,
    npv_cr: 12,
    model_params: {
      kpis: { irr: 0.15, npv: 12, totalRevenue: 100, totalCost: 80 },
    },
  },
  property: { land_area_sqft: 46000 },
  hasFinancialModel: true,
  durationYears: 4,
  effectiveDate: '2026-01-01',
  generatedAt: '2026-05-25T00:00:00Z',
  assumptions: {},
  cashFlows: [],
  sensitivity: null,
  dd: { summary: {}, items: [] },
  risks: { summary: {}, items: [], recommendation: null, narrative: null },
  market: { nearbyComps: [], cityComps: [], benchmarks: {}, cityBenchmarks: [], aiAugment: {} },
  approvals: { summary: {}, items: [] },
  documents: [],
});

describe('DOCX export — Recommendations + Deal Doctor sections', () => {
  test('renders empty-state copy when the engine produced no cards', async () => {
    const ctx = baseContext();
    ctx.recommendations = {
      recommendations: [],
      signals: [],
      summary: { total: 0, by_severity: { critical: 0, high: 0, medium: 0, low: 0 } },
      snapshot_hash: 'abc123',
      generated_at: '2026-05-25T00:00:00Z',
      narrator_status: 'skipped',
    };
    ctx.deal_doctor = {
      findings: [],
      groups: [],
      finding_count: 0,
      signal_count: 0,
      summary: { total: 0, by_severity: { critical: 0, high: 0, medium: 0, low: 0 } },
      generated_at: '2026-05-25T00:00:00Z',
    };
    const buffer = await buildDealReportDocx(ctx);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  test('renders cards when recommendations are present', async () => {
    const ctx = baseContext();
    ctx.recommendations = {
      recommendations: [
        {
          id: 'land-cost-share-high',
          verb: 'Recommend',
          topic: 'land_price',
          topic_label: 'Land price',
          severity: 5,
          headline: 'Recommend re-pricing land. Land cost is 38% of GDV — above the 30% target.',
          detail: 'Alternative structures may restore returns.',
          evidence: [
            { ref: 'kernel:landCr', label: 'Land cost ₹40 Cr' },
            { ref: 'kernel:revenue', label: 'GDV ₹100 Cr' },
          ],
          signals: ['land_cost_share_of_gdv'],
          ai_narratable: true,
        },
        {
          id: 'rera-registration-missing',
          verb: 'Flag',
          topic: 'legal_rera',
          topic_label: 'Legal — RERA',
          severity: 5,
          headline: 'Flag — RERA registration not on file.',
          detail: 'Marketing restricted under Karnataka RERA Section 3.',
          evidence: [{ ref: 'approvals:list', label: 'No RERA approval item' }],
          signals: ['rera_registration_missing'],
          ai_narratable: false,
        },
      ],
      signals: [],
      summary: { total: 2, by_severity: { critical: 2, high: 0, medium: 0, low: 0 } },
      snapshot_hash: 'abc123',
      generated_at: '2026-05-25T00:00:00Z',
      narrator_status: 'skipped',
    };
    ctx.deal_doctor = {
      findings: [
        {
          id: 'land-cost-diverges-from-gdv-share',
          verb: 'Diverges',
          topic: 'land_price',
          severity: 5,
          finding: 'Land cost diverges materially from typical underwriting.',
          why_it_matters: 'Elevated ratio compresses the buffer.',
          evidence: [],
          signals: [],
          ai_narratable: true,
        },
      ],
      groups: [{
        key: 'underwriting',
        label: 'Underwriting',
        ai_narratable: true,
        findings: [
          {
            id: 'land-cost-diverges-from-gdv-share',
            verb: 'Diverges',
            topic: 'land_price',
            severity: 5,
            finding: 'Land cost diverges materially from typical underwriting.',
            why_it_matters: 'Elevated ratio compresses the buffer.',
            ai_narratable: true,
          },
        ],
      }],
      finding_count: 1,
      signal_count: 1,
      summary: { total: 1, by_severity: { critical: 1, high: 0, medium: 0, low: 0 } },
      generated_at: '2026-05-25T00:00:00Z',
    };
    const buffer = await buildDealReportDocx(ctx);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  test('renders even when the slices are entirely absent (degrades to empty-states)', async () => {
    const ctx = baseContext();
    // recommendations + deal_doctor not present on the context
    const buffer = await buildDealReportDocx(ctx);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
