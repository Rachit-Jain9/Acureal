'use strict';

/**
 * Unit tests for the K-RERA Readiness DOCX exporter.
 *
 * The exporter is deterministic — same readiness input produces a structurally
 * identical Word document. Tests assert:
 *   - returns a non-empty Buffer (real DOCX zip output)
 *   - cover page text shows up in the document content (via Packer.toBuffer
 *     deterministic shape — we unzip the buffer and assert document.xml
 *     contains expected substrings)
 *   - not-applicable path still produces a valid (smaller) buffer
 */

const { buildReraReadinessDocx } = require('../src/services/exports/docx/buildReraReadiness');
const { composeReadiness } = require('../src/services/karnatakaReraReadiness.service');
const JSZip = require('jszip');

// Helper: unzip a DOCX buffer and return the document.xml content as a string.
const extractDocumentXml = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) return null;
  return file.async('string');
};

describe('buildReraReadinessDocx', () => {
  test('returns a non-empty Buffer for an applicable deal', async () => {
    const readiness = composeReadiness({
      assetClass: 'residential_apartments',
      approvals: [],
      documents: [],
      dealName: 'Jigani Apartments',
    });
    const buffer = await buildReraReadinessDocx(readiness, {
      brandName: 'REDIP',
      userName: 'Rachit Jain',
      generatedAt: '2026-05-26T18:00:00Z',
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(2000); // realistic minimum DOCX size
  });

  test('cover page surfaces deal name + brand', async () => {
    const readiness = composeReadiness({
      assetClass: 'residential_apartments',
      dealName: 'Whitefield Heights',
    });
    const buffer = await buildReraReadinessDocx(readiness, { brandName: 'REDIP' });
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Whitefield Heights');
    expect(xml).toContain('REDIP');
    // Cover page uses the full "Karnataka RERA Readiness Pack" headline.
    expect(xml).toContain('Karnataka RERA Readiness Pack');
  });

  test('surfaces the CLAUDE.md disclaimer prominently', async () => {
    const readiness = composeReadiness({
      assetClass: 'residential_apartments',
      dealName: 'Test Deal',
    });
    const buffer = await buildReraReadinessDocx(readiness);
    const xml = await extractDocumentXml(buffer);
    // The disclaimer text appears in the cover banner + footer + Scope page.
    // We check for unique sub-phrases that don't span apostrophes (which the
    // docx library may split into separate runs).
    expect(xml).toContain('Important');
    expect(xml).toContain('compliance verdict');
    expect(xml).toContain('Scope &amp; Disclaimer');
  });

  test('includes per-bucket section headers', async () => {
    const readiness = composeReadiness({
      assetClass: 'residential_apartments',
      dealName: 'Test Deal',
    });
    const buffer = await buildReraReadinessDocx(readiness);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Application &amp; Declaration');
    expect(xml).toContain('Title &amp; Ownership');
    expect(xml).toContain('Plan &amp; Approvals');
    expect(xml).toContain('Escrow');
    expect(xml).toContain('Professional Certificates');
  });

  test('top gaps section appears when there are missing items', async () => {
    const readiness = composeReadiness({
      assetClass: 'residential_apartments',
      dealName: 'Test Deal',
    });
    const buffer = await buildReraReadinessDocx(readiness);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Top Gaps');
    expect(xml).toContain('Critical');
  });

  test('not-applicable asset class returns a short document with the reason', async () => {
    // raw_land is exempt by nature (held / sold as-is, not a unit-sale project).
    // (commercial_office is intentionally NOT used here any more — under the
    // corrected statutory logic a commercial unit-sale can be in scope.)
    const readiness = composeReadiness({
      assetClass: 'raw_land',
      dealName: 'North Bengaluru Land Parcel',
    });
    const buffer = await buildReraReadinessDocx(readiness);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Not applicable');
    expect(xml).toContain('Raw land');
    // Smaller document — no bucket sections
    expect(xml).not.toContain('Application &amp; Declaration');
  });

  test('throws on null readiness payload', async () => {
    await expect(buildReraReadinessDocx(null)).rejects.toThrow(/readiness payload is required/);
  });

  test('handles deal with rich approvals + docs (Jigani-shaped fixture)', async () => {
    const readiness = composeReadiness({
      assetClass: 'residential_apartments',
      dealName: 'Jigani Apartments',
      approvals: [
        { id: 1, approval_type: 'fire_noc', name: 'Fire NOC (KFES)', is_validated: true },
        { id: 2, approval_type: 'khata', name: 'Khata Certificate', is_uploaded: true },
        { id: 3, approval_type: 'building_plan', name: 'Sanctioned Building Plan', is_available: true },
      ],
      documents: [
        { id: 'd1', name: 'Title_Deed.pdf' },
        { id: 'd2', name: 'EC_30yr.pdf' },
      ],
    });
    const buffer = await buildReraReadinessDocx(readiness, {
      brandName: 'REDIP',
      userName: 'Rachit Jain',
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(5000); // larger document with multiple rows
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Jigani Apartments');
    expect(xml).toContain('Verified'); // Fire NOC verified
    expect(xml).toContain('Available'); // Sanctioned plan available
  });

  test('surfaces applicability, fatal blockers, fee estimate and milestone (cockpit fields)', async () => {
    const readiness = {
      applicable: true,
      asset_class: 'residential_apartments',
      deal_name: 'Cockpit Deal',
      applicability: {
        status: 'in_scope',
        reason: 'land area exceeds 500 sqm',
        rule_trace: [{ text: 'land area 1200 sqm > 500 sqm', result: true }],
      },
      overall: {
        completeness_pct: 40, readiness_tier: 'blocked', is_blocked: true,
        by_status: { verified: 0, uploaded: 0, available: 0, pending: 0, missing: 1 },
        total_items: 1,
        blockers: [{ item_id: 'commencement_certificate', item_label: 'Building Commencement Certificate (BCC)' }],
      },
      buckets: [{
        id: 'plan_approvals', label: 'Plan & Approvals', description: 'Plan + CC.',
        completeness_pct: 0, bucket_status: 'missing', total_items: 1,
        items: [{
          id: 'commencement_certificate', label: 'Building Commencement Certificate (BCC)',
          description: 'Issued after the sanctioned plan.', weight: 5, is_blocker: true,
          evidence: { status: 'missing', source: null }, status_label: 'Missing',
          recommended_action: 'Apply for the BCC at the planning authority.',
          official_source: { label: 'Karnataka RERA portal', url: 'https://rera.karnataka.gov.in/' },
        }],
      }],
      gaps: [{ item_id: 'commencement_certificate', item_label: 'Building Commencement Certificate (BCC)', bucket_label: 'Plan & Approvals', weight: 5, severity: 'critical', recommended_action: 'Apply for the BCC.' }],
      fee_estimate: { fee_inr: 12000, category_label: 'Group housing', last_verified: '2026-06-04', source_url: 'https://rera.karnataka.gov.in/', is_overridden: false },
      milestone: { phase: 'registration', derived_from: 'Core plan approval is on file.' },
      disclaimer: 'This is an organisation aid... not a RERA compliance verdict.',
    };
    const buffer = await buildReraReadinessDocx(readiness);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Applicability, Fee &amp; Milestone');
    expect(xml).toContain('In scope');
    expect(xml).toContain('Fatal Blockers');
    expect(xml).toContain('Building Commencement Certificate (BCC)');
    expect(xml).toContain('Estimate only');
    expect(xml).toContain('Blocked'); // cover tier
  });
});
