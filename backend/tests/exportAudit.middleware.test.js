'use strict';

/**
 * Export audit ledger (2026-07-31).
 *
 * `export_events` shipped 2026-05-17, three docs describe it as "records
 * every export" — and it held zero rows, because no code ever inserted one.
 * Nobody could answer "who downloaded which investor package". These tests
 * pin the middleware that closes that gap:
 *
 *   • an attachment response → exactly one ledger row, correct org/user/deal/
 *     format/bytes, tenant context re-entered for RLS;
 *   • a non-attachment response, an error response, an unrecognised format →
 *     NO row (and no thrown accounting error breaking the download);
 *   • handler enrichment (ai_used / cost / metadata) rides into the row.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

const express = require('express');
const { query } = require('../src/config/database');
const { getRequestContext } = require('../src/lib/requestContext');
const { exportAudit, resolveFormat } = require('../src/middleware/exportAudit');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const DEAL = '33333333-3333-4333-8333-333333333333';

// The middleware inserts in the background; give the event loop a beat.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const auditInserts = () =>
  query.mock.calls.filter(([sql]) => /INSERT INTO export_events/i.test(sql));

// The repo has no supertest, and this middleware needs REAL response
// semantics — a hand-rolled res has no 'finish' event and no genuine
// write/end chain, which is exactly what is under test. So: a real Express
// server on an ephemeral port, exercised with Node's global fetch.
const makeApp = (handler) => {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: USER, organization_id: ORG };
    next();
  });
  app.use(exportAudit);
  app.get('/deals/:dealId/export', handler);
  app.get('/plain', handler);
  return app;
};

let server = null;
const serve = (app) =>
  new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${server.address().port}`));
  });

afterEach(() => new Promise((resolve) => {
  if (server) server.close(() => { server = null; resolve(); });
  else resolve();
}));

beforeEach(() => jest.clearAllMocks());

describe('resolveFormat', () => {
  it('prefers the filename extension', () => {
    expect(resolveFormat('attachment; filename="acureal-deal.pptx"', 'application/octet-stream')).toBe('pptx');
  });
  it('falls back to the content type when no filename is set', () => {
    expect(resolveFormat('attachment', 'text/csv; charset=utf-8')).toBe('csv');
    expect(resolveFormat('attachment', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
  });
  it('returns null for formats the ledger cannot hold', () => {
    expect(resolveFormat('attachment; filename="dump.zip"', 'application/zip')).toBeNull();
  });
});

describe('exportAudit middleware', () => {
  it('records an attachment download with org, user, deal, format and real byte count', async () => {
    const body = 'Deal Name,Stage\nSarjapur,diligence\n';
    const app = makeApp((req, res) => {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="acureal-deals.csv"');
      res.send(body);
    });

    const base = await serve(app);
    expect((await fetch(`${base}/deals/${DEAL}/export`)).status).toBe(200);
    await settle();

    const inserts = auditInserts();
    expect(inserts).toHaveLength(1);
    const [, params] = inserts[0];
    expect(params[0]).toBe(ORG);            // organization_id
    expect(params[1]).toBe(USER);           // user_id
    expect(params[2]).toBe(DEAL);           // deal_id from the route param
    expect(params[3]).toBe('csv');          // format
    expect(params[4]).toBe(false);          // ai_used defaults false
    expect(params[7]).toBe(Buffer.byteLength(body)); // counted, not claimed
  });

  it('re-enters the tenant context so the RLS-checked insert can succeed', async () => {
    let contextAtInsert = null;
    query.mockImplementation(async (sql) => {
      if (/INSERT INTO export_events/i.test(sql)) contextAtInsert = { ...getRequestContext() };
      return { rows: [] };
    });

    const app = makeApp((req, res) => {
      res.setHeader('Content-Disposition', 'attachment; filename="x.pdf"');
      res.setHeader('Content-Type', 'application/pdf');
      res.send(Buffer.from('%PDF-1.4'));
    });

    const base = await serve(app);
    expect((await fetch(`${base}/deals/${DEAL}/export`)).status).toBe(200);
    await settle();

    expect(contextAtInsert).toMatchObject({ organizationId: ORG, userId: USER });
  });

  it('handler enrichment (AI usage, cost, metadata) rides into the row', async () => {
    const app = makeApp((req, res) => {
      res.locals.exportAudit = {
        aiUsed: true,
        aiCostUsd: 0.042,
        metadata: { variant: 'investor_pack' },
      };
      res.setHeader('Content-Disposition', 'attachment; filename="pack.docx"');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.send(Buffer.from('docx-bytes'));
    });

    const base = await serve(app);
    expect((await fetch(`${base}/deals/${DEAL}/export`)).status).toBe(200);
    await settle();

    const [, params] = auditInserts()[0];
    expect(params[3]).toBe('docx');
    expect(params[4]).toBe(true);
    expect(params[5]).toBe(0.042);
    expect(JSON.parse(params[8])).toMatchObject({ variant: 'investor_pack' });
  });

  it('a plain JSON response is not an export — no row', async () => {
    const app = makeApp((req, res) => res.json({ success: true }));
    const base = await serve(app);
    expect((await fetch(`${base}/plain`)).status).toBe(200);
    await settle();
    expect(auditInserts()).toHaveLength(0);
  });

  it('a failed export is not recorded as a delivery', async () => {
    const app = makeApp((req, res) => {
      res.setHeader('Content-Disposition', 'attachment; filename="x.csv"');
      res.status(500).send('generation failed');
    });
    const base = await serve(app);
    expect((await fetch(`${base}/deals/${DEAL}/export`)).status).toBe(500);
    await settle();
    expect(auditInserts()).toHaveLength(0);
  });

  it('a ledger-insert failure never disturbs the download', async () => {
    query.mockRejectedValue(new Error('db down'));
    const app = makeApp((req, res) => {
      res.setHeader('Content-Disposition', 'attachment; filename="x.csv"');
      res.setHeader('Content-Type', 'text/csv');
      res.send('a,b\n');
    });
    const base = await serve(app);
    const res = await fetch(`${base}/deals/${DEAL}/export`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('a,b\n');
    await settle();
  });
});
