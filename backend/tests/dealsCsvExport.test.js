'use strict';

// Smoke test for the deals CSV export route handler. We don't have
// supertest available, so we mount an express app that wires the
// real route handler against a mocked dealService — enough to
// verify the assignedToMe → assignedTo transform plumbs correctly,
// the column order is stable, and the response is text/csv.
//
// The CSV escaping primitive (`escapeCsvField`) is already covered by
// `csv-export.test.js`. This file focuses on the route shape.

jest.mock('../src/services/deal.service', () => ({
  getDeals: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'auth-user-1', role: 'admin', name: 'Test', email: 't@x.io' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const dealService = require('../src/services/deal.service');
const exportRoutes = require('../src/routes/export.routes');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/exports', exportRoutes);
  return app;
};

const requestCsv = async (app, query = {}) => {
  // Walk the express router stack manually — no supertest. We build a
  // tiny mock req/res that captures status, headers, and the response
  // body, then dispatch via app.handle.
  const url = `/exports/deals/csv${
    Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : ''
  }`;
  return new Promise((resolve) => {
    const headers = {};
    const req = {
      method: 'GET',
      url,
      headers: {},
      query,
      user: undefined,
    };
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
};

beforeEach(() => {
  jest.clearAllMocks();
});

const sampleRow = (overrides = {}) => ({
  name: 'Whitefield Plot 22',
  deal_type: 'land_purchase',
  stage: 'underwriting',
  priority: 'high',
  asset_class: 'residential_apartments',
  deal_structure: 'outright',
  property_name: 'Whitefield Plot 22',
  city: 'Bengaluru',
  state: 'Karnataka',
  property_type: 'land',
  land_area_sqft: 130680,
  land_ask_price_cr: 12.5,
  negotiated_price_cr: 11.8,
  total_revenue_cr: 75.0,
  total_cost_cr: 42.5,
  gross_profit_cr: 32.5,
  gross_margin_pct: 43.3,
  irr_pct: 22.4,
  npv_cr: 14.5,
  equity_multiple: 1.85,
  assigned_to_name: 'Rachit Jain',
  rera_number: 'PR/KA/RERA/1234/2026',
  is_archived: false,
  created_at: '2026-04-15T10:00:00Z',
  updated_at: '2026-05-09T10:00:00Z',
  ...overrides,
});

describe('GET /exports/deals/csv', () => {
  test('returns text/csv with header row + data rows', async () => {
    dealService.getDeals.mockResolvedValueOnce({
      data: [sampleRow(), sampleRow({ name: 'Hebbal Mixed Use', city: 'Bengaluru' })],
    });
    const app = buildApp();
    const { statusCode, headers, body } = await requestCsv(app);
    expect(statusCode).toBe(200);
    expect(headers['content-type']).toMatch(/text\/csv/i);
    expect(headers['content-disposition']).toMatch(/acureal-deals-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = String(body).split('\n');
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[0]).toMatch(/^Deal Name,Type,Stage/);
    expect(lines[1]).toContain('Whitefield Plot 22');
    expect(lines[1]).toContain('22.4'); // IRR raw number
    expect(lines[1]).toContain('Rachit Jain');
  });

  test('?assignedToMe=true plumbs req.user.id into dealService.getDeals as assignedTo', async () => {
    dealService.getDeals.mockResolvedValueOnce({ data: [] });
    const app = buildApp();
    await requestCsv(app, { assignedToMe: 'true' });
    expect(dealService.getDeals).toHaveBeenCalled();
    const filtersArg = dealService.getDeals.mock.calls[0][0];
    expect(filtersArg.assignedTo).toBe('auth-user-1');
  });

  test('explicit ?assignedTo=<uuid> wins over assignedToMe', async () => {
    dealService.getDeals.mockResolvedValueOnce({ data: [] });
    const app = buildApp();
    await requestCsv(app, { assignedToMe: 'true', assignedTo: 'other-user-99' });
    const filtersArg = dealService.getDeals.mock.calls[0][0];
    expect(filtersArg.assignedTo).toBe('other-user-99');
  });

  test('escapes commas and quotes in deal names', async () => {
    dealService.getDeals.mockResolvedValueOnce({
      data: [sampleRow({ name: 'Acme, Plot "B"' })],
    });
    const app = buildApp();
    const { body } = await requestCsv(app);
    const lines = String(body).split('\n');
    expect(lines[1]).toContain('"Acme, Plot ""B"""');
  });

  test('formats dates as YYYY-MM-DD', async () => {
    dealService.getDeals.mockResolvedValueOnce({
      data: [sampleRow({ created_at: '2026-01-15T03:00:00Z', updated_at: '2026-05-09T10:00:00Z' })],
    });
    const app = buildApp();
    const { body } = await requestCsv(app);
    const dataRow = String(body).split('\n')[1];
    expect(dataRow).toContain('2026-01-15');
    expect(dataRow).toContain('2026-05-09');
  });

  test('renders archived flag as yes/no', async () => {
    dealService.getDeals.mockResolvedValueOnce({
      data: [sampleRow({ is_archived: true })],
    });
    const app = buildApp();
    const { body } = await requestCsv(app);
    const dataRow = String(body).split('\n')[1];
    expect(dataRow).toContain(',yes,');
  });

  test('returns header-only CSV when filtered set is empty', async () => {
    dealService.getDeals.mockResolvedValueOnce({ data: [] });
    const app = buildApp();
    const { body } = await requestCsv(app);
    const lines = String(body).split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Deal Name,Type,Stage/);
  });

  test('caps result at 5000 rows via dealService pagination arg', async () => {
    dealService.getDeals.mockResolvedValueOnce({ data: [] });
    const app = buildApp();
    await requestCsv(app);
    const paginationArg = dealService.getDeals.mock.calls[0][1];
    expect(paginationArg).toMatchObject({ limit: 5000 });
  });
});
