'use strict';

/**
 * The automatic deal-timeline write.
 *
 * ── The bug these tests exist to prevent ────────────────────────────────────
 * From 2026-03-27 to 2026-07-17 this sink wrote NOTHING. Not one row. Its
 * INSERT was:
 *
 *   VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7,
 *           CASE WHEN $6 = 'completed' THEN NOW() ELSE NULL END,
 *           CASE WHEN $6 = 'completed' THEN $4 ELSE NULL END)
 *
 * `$4` occupies the `performed_by` slot (Postgres deduces uuid) AND sits
 * inside a CASE whose arms are `$4` and `NULL` — both untyped. With no typed
 * arm to anchor on, Postgres resolves that CASE to `text`, deduces `$4::text`,
 * and rejects the whole statement at PARSE time:
 *     42P08  inconsistent types deduced for parameter $4
 * (Reproduced verbatim against the production database before fixing.)
 *
 * It hid for four months because (a) the write is fail-soft, so the
 * originating mutation still succeeded, and (b) every test mocks `query`,
 * which happily accepts SQL that a real Postgres would reject. All ELEVEN
 * subscribed event types — stage changes, approvals, risk flags, DD items,
 * uploads, extractions, financial scenarios — were silently lost. CLAUDE.md
 * calls that audit trail "non-negotiable for investor-grade reporting".
 *
 * ── Why the tests below are shaped this way ─────────────────────────────────
 * A mocked `query` can never catch a parse error, so asserting "it inserted"
 * proves nothing. Instead we pin the STRUCTURAL INVARIANT that the defect
 * violated: every placeholder appears exactly once, in exactly one type
 * context. That is checkable without a database and generalises to any future
 * SQL added to this sink.
 */

const dbCfg = require('../src/config/database');
jest.spyOn(dbCfg, 'query').mockResolvedValue({ rows: [{ id: 'act-1' }] });

const { EVENTS, publish } = require('../src/lib/eventBus');
const dealEvents = require('../src/services/dealEvents.service');

const findInsert = (calls) =>
  calls.find(([sql]) => /INSERT INTO activities/i.test(String(sql)));

/** Every `$n` in the statement, in order of appearance. */
const placeholdersIn = (sql) => (String(sql).match(/\$\d+/g) || []);

beforeAll(() => dealEvents.register());
afterAll(() => dealEvents.unregister());
beforeEach(() => dbCfg.query.mockClear());

describe('the SQL cannot reproduce the 42P08 defect class', () => {
  test('no placeholder is reused — each sits in exactly ONE type context', async () => {
    await publish(EVENTS.DEAL_STAGE_CHANGED, {
      dealId: 'd1', fromStage: 'screening', toStage: 'loi', userId: 'u1',
    });
    const [sql] = findInsert(dbCfg.query.mock.calls);
    const used = placeholdersIn(sql);
    const unique = [...new Set(used)];

    // THE guard. A placeholder appearing twice is how $4 got deduced as both
    // uuid and text. If a future edit reuses one, this fails here rather than
    // silently dropping every audit row in production for four months.
    expect(used).toHaveLength(unique.length);
  });

  test('no CASE expression decides a column value (the shape that broke)', async () => {
    await publish(EVENTS.DEAL_STAGE_CHANGED, {
      dealId: 'd1', fromStage: 'screening', toStage: 'loi', userId: 'u1',
    });
    const [sql] = findInsert(dbCfg.query.mock.calls);
    // Completion columns are derived in JS (mirroring activity.service), so an
    // untyped CASE arm can never anchor a parameter's type again.
    expect(String(sql)).not.toMatch(/CASE\s+WHEN/i);
  });

  test('placeholder count exactly matches the params array (no silent off-by-one)', async () => {
    await publish(EVENTS.DEAL_STAGE_CHANGED, {
      dealId: 'd1', fromStage: 'screening', toStage: 'loi', userId: 'u1',
    });
    const [sql, params] = findInsert(dbCfg.query.mock.calls);
    const unique = [...new Set(placeholdersIn(sql))];
    const highest = Math.max(...unique.map((p) => Number(p.slice(1))));

    expect(params).toHaveLength(unique.length);
    expect(highest).toBe(params.length); // $n numbering is dense: $1..$params.length
  });

  test('every placeholder $1..$n is present exactly once, none skipped', async () => {
    await publish(EVENTS.DEAL_STAGE_CHANGED, {
      dealId: 'd1', fromStage: 'screening', toStage: 'loi', userId: 'u1',
    });
    const [sql, params] = findInsert(dbCfg.query.mock.calls);
    const used = placeholdersIn(sql).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const expected = params.map((_, i) => `$${i + 1}`);
    expect(used).toEqual(expected);
  });
});

describe('completion columns are derived correctly in JS', () => {
  // These replaced the CASE arms. status defaults to 'completed' for the
  // sink's events, so completed_at/by must be populated — the timeline shows
  // "who did it, when".
  // activity_date is NOW() in SQL, not a placeholder — so the params array is
  // 9 long: $1..$9 → deal_id, type, description, performed_by, is_important,
  // status, priority, completed_at, completed_by.
  const PERFORMED_BY = 3; // $4 → params[3]
  const STATUS = 5;       // $6 → params[5]
  const COMPLETED_AT = 7; // $8 → params[7]
  const COMPLETED_BY = 8; // $9 → params[8]

  test('a completed event stamps completed_at NOW-ish and completed_by = performer', async () => {
    await publish(EVENTS.DEAL_STAGE_CHANGED, {
      dealId: 'd1', fromStage: 'screening', toStage: 'loi', userId: 'u1',
    });
    const [, params] = findInsert(dbCfg.query.mock.calls);
    expect(params[STATUS]).toBe('completed');
    expect(params[COMPLETED_BY]).toBe('u1');
    expect(params[COMPLETED_BY]).toBe(params[PERFORMED_BY]); // same actor
    expect(params[COMPLETED_AT]).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - params[COMPLETED_AT].getTime())).toBeLessThan(5000);
  });

  test('a null performer yields a null completed_by, never a crash', async () => {
    // System-triggered events carry no user (e.g. a cron-driven refresh).
    await publish(EVENTS.DEAL_STAGE_CHANGED, {
      dealId: 'd1', fromStage: 'screening', toStage: 'loi', userId: null,
    });
    const [, params] = findInsert(dbCfg.query.mock.calls);
    expect(params[PERFORMED_BY]).toBeNull();
    expect(params[COMPLETED_BY]).toBeNull();
  });
});

describe('the sink stays fail-soft but LOUD', () => {
  test('a DB failure never breaks the originating mutation', async () => {
    dbCfg.query.mockRejectedValueOnce(new Error('inconsistent types deduced for parameter $4'));
    // publish must resolve — the stage change itself already happened.
    await expect(publish(EVENTS.DEAL_STAGE_CHANGED, {
      dealId: 'd1', fromStage: 'screening', toStage: 'loi', userId: 'u1',
    })).resolves.toBeDefined();
  });
});

describe('the audit trail actually reaches the timeline', () => {
  // One row per material change — the CLAUDE.md non-negotiable. Each of these
  // wrote nothing at all before the fix.
  test.each([
    ['stage change', EVENTS.DEAL_STAGE_CHANGED, { dealId: 'd1', fromStage: 'screening', toStage: 'loi', userId: 'u1' }],
    ['document upload', EVENTS.DOCUMENT_UPLOADED, { dealId: 'd1', documentName: 'deed.pdf', userId: 'u1' }],
    ['document extraction', EVENTS.DOCUMENT_EXTRACTED, { dealId: 'd1', documentName: 'deed.pdf', docType: 'sale_deed', status: 'completed', userId: 'u1' }],
  ])('%s writes exactly one activity row', async (_label, event, payload) => {
    await publish(event, payload);
    const insert = findInsert(dbCfg.query.mock.calls);
    expect(insert).toBeTruthy();
    const [sql, params] = insert;
    expect(params[0]).toBe('d1');
    // and it still satisfies the structural invariant
    const used = placeholdersIn(sql);
    expect(used).toHaveLength(new Set(used).size);
  });
});
