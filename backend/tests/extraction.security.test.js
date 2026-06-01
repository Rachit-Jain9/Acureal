'use strict';

/**
 * Regression guard for the extraction cross-tenant fix (2026-06-01, P0).
 *
 * The app connects as a BYPASSRLS Postgres role, so the RLS policies on
 * document_extractions / deals do NOT protect the app path — the explicit
 * `organization_id = current_organization_id()` filter is the ONLY cross-tenant
 * guard. These tests pin that filter onto the read + write SQL so it can't
 * silently regress.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock('../src/services/evidenceIngestion.service', () => ({
  ingestExtraction: jest.fn(async () => ({})),
  ingestRegulatoryFields: jest.fn(async () => ({})),
}));
jest.mock('../src/services/embeddings.service', () => ({
  indexDocumentText: jest.fn(async () => ({})),
}));

const { query } = require('../src/config/database');
const extractionService = require('../src/services/extraction.service');
const ddService = require('../src/services/dd.service');

const ORG_FILTER = /organization_id\s*=\s*current_organization_id\(\)/;

describe('extraction.service — cross-org guards (BYPASSRLS app role)', () => {
  beforeEach(() => query.mockReset());

  test('getExtractionByDocument scopes the read to the caller org', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'e1' }] });
    await extractionService.getExtractionByDocument('doc-1');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/document_extractions/);
    expect(query.mock.calls[0][0]).toMatch(ORG_FILTER);
  });

  test('applyCorrections scopes the existing-row lookup → cross-org id returns null (404), never updates', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // no row visible to this org
    const out = await extractionService.applyCorrections('e-other-org', { a: 1 }, 'user-1');
    expect(out).toBeNull();
    expect(query).toHaveBeenCalledTimes(1); // SELECT only; UPDATE never ran
    expect(query.mock.calls[0][0]).toMatch(ORG_FILTER);
  });

  test('applyCorrections scopes the UPDATE to the caller org', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ human_corrections: {}, correction_history: [] }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] }); // UPDATE
    await extractionService.applyCorrections('e1', { a: 1 }, 'user-1');
    const updateCall = query.mock.calls.find((c) => /UPDATE document_extractions/.test(c[0]));
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toMatch(ORG_FILTER);
  });
});

describe('dd.service.seedForDeal — cross-org guard on the asset-class default lookup', () => {
  beforeEach(() => query.mockReset());

  test('the deal lookup (when asset class / structure are explicitly null) is org-scoped', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ asset_class: 'commercial_office', deal_structure: 'outright' }] }) // deals SELECT
      .mockResolvedValueOnce({ rows: [] }) // dedup SELECT
      .mockResolvedValueOnce({ rows: [] }); // INSERT ... RETURNING
    await ddService.seedForDeal('deal-1', null, null);
    const dealLookup = query.mock.calls.find((c) => /FROM deals WHERE id/.test(c[0]));
    expect(dealLookup).toBeTruthy();
    expect(dealLookup[0]).toMatch(ORG_FILTER);
  });
});
