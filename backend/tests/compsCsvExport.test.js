'use strict';

// Smoke tests for the two new filtered CSV export routes:
//   • GET /exports/comps               (verified-comps database)
//   • GET /api/comps-review-queue/export.csv (review queue)
//
// We mount the real route handlers against mocked services and dispatch
// via `app.handle` (no supertest dependency). The CSV escaping primitive
// is already covered by csv-export.test.js; these tests focus on
// filter passthrough, content-type, and the column shape of the output.

jest.mock('../src/services/comps.service', () => ({
  getCompsForExport: jest.fn(),
}));
jest.mock('../src/services/compsReviewQueue.service', () => {
  const queryQueueForExport = jest.fn();
  return {
    queryQueueForExport,
    // The route file pulls other names; stub them with no-ops so
    // requiring the module doesn't blow up.
    listQueue: jest.fn(),
    getQueueRow: jest.fn(),
    processQueueRow: jest.fn(),
    processPendingBatch: jest.fn(),
    processPendingBatchAcrossOrgs: jest.fn(),
    applyReviewerEdits: jest.fn(),
    approveAndCommit: jest.fn(),
    reject: jest.fn(),
    bulkApprove: jest.fn(),
    bulkReject: jest.fn(),
    bulkReassign: jest.fn(),
    manualUpload: jest.fn(),
  };
});

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'auth-user-1', role: 'admin', name: 'Test', email: 't@x.io' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

// upload middleware imports multer; stub so requiring the route file
// doesn't hit a real disk store. We don't exercise that path.
jest.mock('../src/middleware/upload', () => ({
  uploadSingle: () => (_req, _res, next) => next(),
}));

const express = require('express');
const compsService = require('../src/services/comps.service');
const queueService = require('../src/services/compsReviewQueue.service');
const exportRoutes = require('../src/routes/export.routes');
const queueRoutes = require('../src/routes/compsReviewQueue.routes');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/exports', exportRoutes);
  app.use('/api/comps-review-queue', queueRoutes);
  return app;
};

const dispatch = async (app, url) =>
  new Promise((resolve) => {
    const headers = {};
    const req = { method: 'GET', url, headers: {}, query: {}, user: undefined };
    // Parse query string into req.query manually.
    const qs = url.split('?')[1];
    if (qs) {
      for (const [k, v] of new URLSearchParams(qs).entries()) {
        req.query[k] = v;
      }
    }
    const res = {
      statusCode: 200,
      _body: '',
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      getHeader: (k) => headers[k.toLowerCase()],
      status(code) { this.statusCode = code; return this; },
      send(body) { this._body = body; resolve({ statusCode: this.statusCode, headers, body }); },
      json(body) { this._body = body; resolve({ statusCode: this.statusCode, headers, body }); },
      end(body) { this._body = body || this._body; resolve({ statusCode: this.statusCode, headers, body: this._body }); },
    };
    app.handle(req, res, (err) => {
      if (err) resolve({ statusCode: 500, headers, body: err.message });
      else resolve({ statusCode: 404, headers, body: 'not found' });
    });
  });

beforeEach(() => {
  jest.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// /exports/comps
// ──────────────────────────────────────────────────────────────────────────

describe('GET /exports/comps', () => {
  test('returns text/csv with header row + a data row', async () => {
    compsService.getCompsForExport.mockResolvedValueOnce([
      {
        project_name: 'Whitefield Heights',
        developer: 'Acme',
        city: 'Bengaluru',
        locality: 'Whitefield',
        project_type: 'residential',
        bhk_config: '3BHK',
        carpet_area_sqft: 1450,
        super_builtup_area_sqft: 1820,
        rate_per_sqft: 9200,
        rate_per_sqft_min: 8800,
        rate_per_sqft_max: 9500,
        total_units: 220,
        launch_year: 2024,
        possession_year: 2026,
        rera_number: 'PRM/KA/RERA/1/2024',
        is_verified: true,
        source: 'broker',
        created_at: '2026-01-15T03:00:00Z',
      },
    ]);
    const app = buildApp();
    const { statusCode, headers, body } = await dispatch(app, '/exports/comps');
    expect(statusCode).toBe(200);
    expect(headers['content-type']).toMatch(/text\/csv/i);
    const lines = String(body).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Project,Developer,City/);
    expect(lines[1]).toContain('Whitefield Heights');
    expect(lines[1]).toContain('9200');
    expect(lines[1]).toContain(',yes,'); // is_verified
    expect(lines[1]).toContain('2026-01-15');
  });

  test('passes filter query params through to compsService.getCompsForExport', async () => {
    compsService.getCompsForExport.mockResolvedValueOnce([]);
    const app = buildApp();
    await dispatch(app, '/exports/comps?city=Bengaluru&projectType=residential&minRate=5000&launchYear=2024');
    const filters = compsService.getCompsForExport.mock.calls[0][0];
    expect(filters).toMatchObject({
      city: 'Bengaluru',
      projectType: 'residential',
      minRate: '5000',
      launchYear: '2024',
    });
  });

  test('caps via maxRows option (5000)', async () => {
    compsService.getCompsForExport.mockResolvedValueOnce([]);
    const app = buildApp();
    await dispatch(app, '/exports/comps');
    const opts = compsService.getCompsForExport.mock.calls[0][1];
    expect(opts).toMatchObject({ maxRows: 5000 });
  });

  test('returns header-only CSV when filtered set is empty', async () => {
    compsService.getCompsForExport.mockResolvedValueOnce([]);
    const app = buildApp();
    const { body } = await dispatch(app, '/exports/comps');
    const lines = String(body).split('\n');
    expect(lines).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// /api/comps-review-queue/export.csv
// ──────────────────────────────────────────────────────────────────────────

describe('GET /api/comps-review-queue/export.csv', () => {
  test('returns text/csv with header row + a data row', async () => {
    queueService.queryQueueForExport.mockResolvedValueOnce([
      {
        id: 'r-1',
        source: 'email_broker_quote',
        source_meta: { subject: 'Whitefield Q1', from: 'broker@a.com', attachment_name: 'wfQ1.pdf' },
        raw_doc_url: '',
        status: 'pending_review',
        confidence_scores: { _overall: 0.85 },
        committed_comp_ids: ['c-1', 'c-2'],
        reviewed_at: null,
        committed_at: null,
        created_at: '2026-05-09T10:00:00Z',
        updated_at: '2026-05-09T10:00:00Z',
        assigned_to: 'u-1',
        assignee: { id: 'u-1', name: 'Rachit Jain', email: 'r@x.io' },
      },
    ]);
    const app = buildApp();
    const { statusCode, headers, body } = await dispatch(app, '/api/comps-review-queue/export.csv');
    expect(statusCode).toBe(200);
    expect(headers['content-type']).toMatch(/text\/csv/i);
    expect(headers['content-disposition']).toMatch(/redip-comps-queue-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = String(body).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Subject,Source,Status/);
    expect(lines[1]).toContain('Whitefield Q1');
    expect(lines[1]).toContain('Rachit Jain');
    expect(lines[1]).toContain('85%'); // confidence
    expect(lines[1]).toContain(',2,'); // committed comp count
  });

  test('?assignedToMe=true plumbs req.user.id as currentUserId', async () => {
    queueService.queryQueueForExport.mockResolvedValueOnce([]);
    const app = buildApp();
    await dispatch(app, '/api/comps-review-queue/export.csv?assignedToMe=true');
    const filtersArg = queueService.queryQueueForExport.mock.calls[0][0];
    expect(filtersArg).toMatchObject({
      assignedToMe: true,
      currentUserId: 'auth-user-1',
    });
  });

  test('passes status + source filters through', async () => {
    queueService.queryQueueForExport.mockResolvedValueOnce([]);
    const app = buildApp();
    await dispatch(
      app,
      '/api/comps-review-queue/export.csv?status=pending_review&source=email_broker_quote',
    );
    const filtersArg = queueService.queryQueueForExport.mock.calls[0][0];
    expect(filtersArg.status).toBe('pending_review');
    expect(filtersArg.source).toBe('email_broker_quote');
  });

  test('returns header-only CSV when filtered set is empty', async () => {
    queueService.queryQueueForExport.mockResolvedValueOnce([]);
    const app = buildApp();
    const { body } = await dispatch(app, '/api/comps-review-queue/export.csv');
    const lines = String(body).split('\n');
    expect(lines).toHaveLength(1);
  });

  test('escapes commas in subject lines', async () => {
    queueService.queryQueueForExport.mockResolvedValueOnce([
      {
        id: 'r-1',
        source: 'email_other',
        source_meta: { subject: 'Acme, Plot "B"' },
        status: 'pending_review',
        confidence_scores: {},
        committed_comp_ids: [],
        created_at: '2026-05-09T10:00:00Z',
      },
    ]);
    const app = buildApp();
    const { body } = await dispatch(app, '/api/comps-review-queue/export.csv');
    const lines = String(body).split('\n');
    expect(lines[1]).toContain('"Acme, Plot ""B"""');
  });
});
