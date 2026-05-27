'use strict';

/**
 * Unit tests for the IC Readiness DOCX exporter.
 */

const { buildIcReadinessDocx } = require('../src/services/exports/docx/buildIcReadiness');
const { composeReadiness } = require('../src/services/icReadiness.service');
const JSZip = require('jszip');

const extractDocumentXml = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) return null;
  return file.async('string');
};

const mkReadiness = (overrides = {}) =>
  composeReadiness({
    deal: { asset_class: 'residential_apartments', name: 'Jigani Apartments' },
    ...overrides,
  });

describe('buildIcReadinessDocx', () => {
  test('returns a non-empty Buffer for a fully-loaded deal', async () => {
    const readiness = mkReadiness();
    const buffer = await buildIcReadinessDocx(readiness, {
      brandName: 'REDIP', userName: 'Rachit Jain', generatedAt: '2026-05-27T03:30:00Z',
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(2000);
  });

  test('cover page surfaces deal name + IC Readiness Pack title', async () => {
    const readiness = mkReadiness();
    const buffer = await buildIcReadinessDocx(readiness, { brandName: 'REDIP' });
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Jigani Apartments');
    expect(xml).toContain('REDIP');
    expect(xml).toContain('IC Readiness Pack');
  });

  test('IC-specific disclaimer wording is surfaced', async () => {
    const readiness = mkReadiness();
    const buffer = await buildIcReadinessDocx(readiness);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Important');
    expect(xml).toContain('Investment Committee');
    expect(xml).toContain('Scope &amp; Disclaimer');
  });

  test('includes per-bucket section headers for all 7 IC buckets', async () => {
    const readiness = mkReadiness();
    const buffer = await buildIcReadinessDocx(readiness);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Financial Underwriting');
    expect(xml).toContain('Title &amp; Legal');
    expect(xml).toContain('Statutory Approvals');
    expect(xml).toContain('Market &amp; Comps');
    expect(xml).toContain('Promoter &amp; Execution');
    expect(xml).toContain('Risk &amp; Diagnosis');
    expect(xml).toContain('Document Hygiene');
  });

  test('Top Gaps section appears with critical severity', async () => {
    const readiness = mkReadiness();
    const buffer = await buildIcReadinessDocx(readiness);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Top Gaps');
    expect(xml).toContain('Critical');
  });

  test('empty readiness payload returns a short "not enough data" doc', async () => {
    // Force an empty payload so buckets.length === 0
    const buffer = await buildIcReadinessDocx({ overall: null, buckets: [], gaps: [], deal_name: 'Test' });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Not enough data yet');
    expect(xml).not.toContain('Financial Underwriting');
  });

  test('throws on null readiness payload', async () => {
    await expect(buildIcReadinessDocx(null)).rejects.toThrow(/readiness payload is required/);
  });

  test('Jigani-shaped end-to-end produces a meaningful document', async () => {
    const readiness = composeReadiness({
      deal: { name: 'Jigani Apartments', asset_class: 'residential_apartments' },
      financial: {
        summary: {
          irr_pct: 13.58,
          model_params: {
            costs: { totalCr: 442, landCr: 80, constructionCr: 280 },
            revenue: { totalRevenueCr: 637 },
            kpis: { irr: 13.58, dscr: 4.77, extras: { dscr: 4.77 } },
          },
        },
        scenarios: { base: { kpis: { irr: 13.58 } } },
      },
      approvals: [
        { id: 1, approval_type: 'fire_noc', name: 'Fire NOC (KFES)', is_required: true, is_available: true },
        { id: 2, approval_type: 'khata', name: 'Khata Certificate', is_required: true, is_validated: true },
      ],
      documents: [{ id: 'd1', name: 'Title_Deed.pdf' }],
      promoter: { profile: { promoter_name: 'Prestige' }, assessment: { posture: 'unverified' } },
      comps_count: 0,
    });
    const buffer = await buildIcReadinessDocx(readiness, { brandName: 'REDIP', userName: 'Rachit Jain' });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(5000);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Jigani Apartments');
    expect(xml).toContain('Verified');
  });
});
