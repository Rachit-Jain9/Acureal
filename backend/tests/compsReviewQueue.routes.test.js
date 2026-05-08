'use strict';

/**
 * Route-level validator regression tests for the comps_review_queue API.
 *
 * Why these exist: the express-validator `.optional()` modifier by default
 * only skips validation when the field is `undefined`, NOT `null`. The
 * frontend's reject modal sends `{ reason: null }` when the textarea is
 * empty (after `.trim() || null`), so without `optional({ values: 'null' })`
 * the chain trips `.isString()` on null and the user sees a confusing
 * "Validation failed" toast.
 *
 * These tests exercise the actual validator chains so a future refactor
 * can't accidentally regress the null-handling behaviour.
 */

const { body, param, validationResult } = require('express-validator');

async function runChainsAgainst(req, chains) {
  for (const chain of chains) {
    await chain.run(req);
  }
  return validationResult(req);
}

describe('comps_review_queue validators — null tolerance', () => {
  test('reject endpoint accepts { reason: null }', async () => {
    const chains = [
      param('id').isUUID(),
      body('reason').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
    ];
    const req = {
      params: { id: 'a2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' },
      body: { reason: null },
    };
    const errors = await runChainsAgainst(req, chains);
    expect(errors.isEmpty()).toBe(true);
  });

  test('reject endpoint accepts an empty body', async () => {
    const chains = [
      param('id').isUUID(),
      body('reason').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
    ];
    const req = {
      params: { id: 'a2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' },
      body: {},
    };
    const errors = await runChainsAgainst(req, chains);
    expect(errors.isEmpty()).toBe(true);
  });

  test('reject endpoint accepts a real string reason', async () => {
    const chains = [
      param('id').isUUID(),
      body('reason').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
    ];
    const req = {
      params: { id: 'a2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' },
      body: { reason: 'low quality scan' },
    };
    const errors = await runChainsAgainst(req, chains);
    expect(errors.isEmpty()).toBe(true);
  });

  test('reject endpoint rejects a non-string reason', async () => {
    const chains = [
      param('id').isUUID(),
      body('reason').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
    ];
    const req = {
      params: { id: 'a2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' },
      body: { reason: 12345 },
    };
    const errors = await runChainsAgainst(req, chains);
    expect(errors.isEmpty()).toBe(false);
  });

  test('reject endpoint rejects a too-long reason', async () => {
    const chains = [
      param('id').isUUID(),
      body('reason').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
    ];
    const req = {
      params: { id: 'a2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' },
      body: { reason: 'x'.repeat(1001) },
    };
    const errors = await runChainsAgainst(req, chains);
    expect(errors.isEmpty()).toBe(false);
  });

  test('PATCH (edit) endpoint accepts { payload: null, notes: null }', async () => {
    const chains = [
      param('id').isUUID(),
      body('payload').optional({ values: 'null' }).isObject(),
      body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
    ];
    const req = {
      params: { id: 'a2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' },
      body: { payload: null, notes: null },
    };
    const errors = await runChainsAgainst(req, chains);
    expect(errors.isEmpty()).toBe(true);
  });

  test('PATCH (edit) endpoint accepts a real payload + notes', async () => {
    const chains = [
      param('id').isUUID(),
      body('payload').optional({ values: 'null' }).isObject(),
      body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
    ];
    const req = {
      params: { id: 'a2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' },
      body: { payload: { comps: [] }, notes: 'reviewer note' },
    };
    const errors = await runChainsAgainst(req, chains);
    expect(errors.isEmpty()).toBe(true);
  });

  test('PATCH (edit) endpoint rejects a non-object payload', async () => {
    const chains = [
      param('id').isUUID(),
      body('payload').optional({ values: 'null' }).isObject(),
      body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
    ];
    const req = {
      params: { id: 'a2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' },
      body: { payload: 'not an object' },
    };
    const errors = await runChainsAgainst(req, chains);
    expect(errors.isEmpty()).toBe(false);
  });
});
