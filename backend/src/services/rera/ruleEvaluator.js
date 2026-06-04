'use strict';

/**
 * ruleEvaluator — a tiny, zero-dependency, deterministic predicate evaluator
 * for the Karnataka RERA rule engine (Phase 4 / V1 substrate).
 *
 * A predicate is `{ field, op, value }`. It is evaluated against a flat
 * context object. The evaluator is *tri-valued*:
 *   - `true`  : the predicate holds
 *   - `false` : the predicate is known not to hold
 *   - `null`  : the input is unknown, so the answer is unknown (never throws)
 *
 * Numeric comparisons (`gt/gte/lt/lte`) on a missing/non-numeric field return
 * `null` (unknown), so applicability logic can stay conservative instead of
 * silently treating "unknown area" as "below threshold". `exists` / `truthy`
 * are meaningful on absence and return `false` (known) when the field is empty.
 *
 * Every evaluation carries a human-readable `text` so the engine can show the
 * operator *why* a rule fired (the `rule_trace`) — e.g. "land area 1,200 sqm > 500".
 */

const OPS = Object.freeze({
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  nin: (a, b) => Array.isArray(b) && !b.includes(a),
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  exists: (a) => a !== null && a !== undefined && a !== '',
  truthy: (a) => Boolean(a),
});

const NUMERIC_OPS = new Set(['gt', 'gte', 'lt', 'lte']);
const PRESENCE_OPS = new Set(['exists', 'truthy']);

const OP_PHRASE = Object.freeze({
  eq: 'is', neq: 'is not', in: 'is one of', nin: 'is not one of',
  gt: '>', gte: '≥', lt: '<', lte: '≤', exists: 'is present', truthy: 'is set',
});

const isPresent = (v) => v !== null && v !== undefined && v !== '';

const prettyField = (field) =>
  String(field || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();

const describe = (pred, actual) => {
  const field = prettyField(pred && pred.field);
  if (!pred || !pred.op) return 'invalid rule';
  if (pred.op === 'exists') return `${field} is present`;
  if (pred.op === 'truthy') return `${field} is set`;
  const value = Array.isArray(pred.value) ? pred.value.join(' / ') : pred.value;
  const shownActual = isPresent(actual) ? ` (have: ${actual})` : '';
  return `${field} ${OP_PHRASE[pred.op] || pred.op} ${value}${shownActual}`;
};

/**
 * Evaluate one predicate. Returns { result: true|false|null, known, text, field }.
 */
const evaluatePredicate = (pred, ctx) => {
  const fn = pred && OPS[pred.op];
  const actual = ctx && pred ? ctx[pred.field] : undefined;
  if (!fn) {
    return { result: null, known: false, text: 'invalid rule', field: pred && pred.field, actual };
  }

  // Presence checks are meaningful on absence.
  if (PRESENCE_OPS.has(pred.op)) {
    const result = fn(actual);
    return { result, known: true, text: describe(pred, actual), field: pred.field, actual };
  }

  // Numeric comparisons need a finite number; unknown → unknown.
  if (NUMERIC_OPS.has(pred.op)) {
    if (!isPresent(actual) || !Number.isFinite(Number(actual))) {
      return { result: null, known: false, text: describe(pred, actual), field: pred.field, actual };
    }
  }

  let result = false;
  try {
    result = Boolean(fn(actual, pred.value));
  } catch {
    result = false;
  }
  return { result, known: true, text: describe(pred, actual), field: pred.field, actual };
};

/**
 * Evaluate an array of predicates as an AND. Returns:
 *   { passed: bool, anyUnknown: bool, trace: [evaluatePredicate results] }
 * `passed` is true only when every predicate is strictly `true`.
 */
const evaluateAll = (predicates, ctx) => {
  const list = Array.isArray(predicates) ? predicates : [];
  const trace = list.map((p) => evaluatePredicate(p, ctx));
  const passed = trace.every((t) => t.result === true);
  const anyUnknown = trace.some((t) => t.result === null);
  return { passed, anyUnknown, trace };
};

module.exports = {
  OPS,
  evaluatePredicate,
  evaluateAll,
  // exported for tests
  describe,
  isPresent,
};
