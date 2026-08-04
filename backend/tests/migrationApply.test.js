'use strict';

const {
  sanitizeForTxnScan,
  classifyTransactionShape,
  hasConcurrently,
  planAction,
  applyVersionFor,
} = require('../scripts/migration-apply');

describe('migration-apply pure helpers', () => {
  describe('sanitizeForTxnScan', () => {
    test('strips line and block comments', () => {
      const out = sanitizeForTxnScan('-- BEGIN in a comment\nSELECT 1; /* COMMIT here */');
      expect(out).not.toMatch(/BEGIN/);
      expect(out).not.toMatch(/COMMIT/);
    });

    test('strips dollar-quoted bodies, including tagged ones', () => {
      const sql = 'CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN RETURN; END $fn$ LANGUAGE plpgsql;';
      expect(sanitizeForTxnScan(sql)).not.toMatch(/\bBEGIN\b/);
    });

    test('strips single-quoted literals with doubled quotes', () => {
      const sql = "INSERT INTO t (x) VALUES ('BEGIN it''s COMMIT');";
      const out = sanitizeForTxnScan(sql);
      expect(out).not.toMatch(/BEGIN/);
      expect(out).not.toMatch(/COMMIT/);
    });
  });

  describe('classifyTransactionShape', () => {
    test('plain DDL with no transaction control is bare', () => {
      expect(classifyTransactionShape('CREATE TABLE t (id int);')).toBe('bare');
    });

    test('a DO block whose body says BEGIN is still bare', () => {
      const sql = 'DO $$ BEGIN IF NOT EXISTS (SELECT 1) THEN RAISE NOTICE \'x\'; END IF; END $$;';
      expect(classifyTransactionShape(sql)).toBe('bare');
    });

    test('the repo convention — one outer BEGIN…COMMIT — is wrapped', () => {
      const sql = '-- header\nBEGIN;\nCREATE TABLE t (id int);\nCOMMIT;\n';
      expect(classifyTransactionShape(sql)).toBe('wrapped');
    });

    test('a wrapped file containing a definer function stays wrapped', () => {
      const sql = 'BEGIN;\nCREATE OR REPLACE FUNCTION f() RETURNS int AS $x$ BEGIN RETURN 1; END $x$ LANGUAGE plpgsql;\nCOMMIT;';
      expect(classifyTransactionShape(sql)).toBe('wrapped');
    });

    test('two transactions are complex', () => {
      expect(classifyTransactionShape('BEGIN; SELECT 1; COMMIT; BEGIN; SELECT 2; COMMIT;')).toBe('complex');
    });

    test('savepoints and rollbacks are complex', () => {
      expect(classifyTransactionShape('BEGIN; SAVEPOINT a; ROLLBACK TO a; COMMIT;')).toBe('complex');
      expect(classifyTransactionShape('BEGIN; SELECT 1; ROLLBACK;')).toBe('complex');
    });

    test('START TRANSACTION counts as the opener', () => {
      expect(classifyTransactionShape('START TRANSACTION; SELECT 1; COMMIT;')).toBe('wrapped');
    });
  });

  describe('hasConcurrently', () => {
    test('detects CREATE INDEX CONCURRENTLY', () => {
      expect(hasConcurrently('CREATE INDEX CONCURRENTLY idx ON t (a);')).toBe(true);
    });

    test('ignores the word inside comments and strings', () => {
      expect(hasConcurrently('-- never use CONCURRENTLY here\nSELECT 1;')).toBe(false);
      expect(hasConcurrently("INSERT INTO notes VALUES ('CONCURRENTLY');")).toBe(false);
    });
  });

  describe('planAction', () => {
    test('maps every verdict per the contract', () => {
      expect(planAction('RECORDED')).toBe('SKIP');
      expect(planAction('LIVE, UNRECORDED')).toBe('RECORD');
      expect(planAction('NOT APPLIED')).toBe('APPLY');
      expect(planAction('PARTIAL')).toBe('HALT');
      expect(planAction('UNVERIFIABLE')).toBe('NEEDS --only');
    });

    test('an explicitly named seed file becomes applicable', () => {
      expect(planAction('UNVERIFIABLE', { only: true })).toBe('APPLY');
      // …but naming a PARTIAL file never overrides the human decision.
      expect(planAction('PARTIAL', { only: true })).toBe('HALT');
    });

    test('an unknown verdict fails closed', () => {
      expect(planAction('SOMETHING NEW')).toBe('HALT');
    });
  });

  describe('applyVersionFor', () => {
    test('formats as UTC YYYYMMDDHHMMSS', () => {
      const used = new Set();
      const v = applyVersionFor(new Date(Date.UTC(2026, 7, 4, 17, 30, 5)), used);
      expect(v).toBe('20260804173005');
      expect(used.has(v)).toBe(true);
    });

    test('bumps by a second while colliding — the ledger keys on version', () => {
      const used = new Set(['20260804173005', '20260804173006']);
      const v = applyVersionFor(new Date(Date.UTC(2026, 7, 4, 17, 30, 5)), used);
      expect(v).toBe('20260804173007');
    });
  });
});
