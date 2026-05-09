/**
 * Audit service — immutable, HMAC-signed log of every persisted financial
 * computation.
 *
 * Writes to `deal_events` (see database/migrations/20260422_deal_events.sql).
 * The table has org-scoped RLS that grants SELECT + INSERT only, so rows
 * cannot be mutated from application credentials once written.
 *
 * Public surface
 * ──────────────
 *   recordEvent({ dealId, eventType, engineVersion, assetClass,
 *                 inputs, outputs, actorId, metadata })
 *     → persists one signed row, returns the row
 *
 *   listEvents(dealId, { limit })
 *     → most-recent-first signed event history for a deal
 *
 *   getEvent(eventId)
 *     → single row by id
 *
 *   verifyEvent(event) / replayEvent(event)
 *     → cryptographic verification (verifyEvent) and optional kernel
 *       re-execution from the stored inputs (replayEvent)
 *
 * The signature binds (inputs_hash, outputs_hash, engine_version) with the
 * server-side secret `DEAL_EVENTS_HMAC_KEY`. If the key is rotated, every
 * subsequent signature will stop verifying against old rows — which is the
 * correct behavior for an append-only audit store (operator rotates, old
 * rows flip to "unverifiable", historical truth is preserved in the
 * inputs/outputs JSON for forensic replay).
 */

'use strict';

const crypto = require('crypto');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// ── Stable stringify ─────────────────────────────────────────────────────────
//
// `JSON.stringify` does not guarantee key ordering, so two semantically equal
// objects can serialize differently depending on insertion order. For hashing
// and signing we must use a deterministic, order-independent representation.
//
// This implementation:
//   - sorts object keys alphabetically at every nesting level
//   - preserves array order (arrays are semantically ordered)
//   - normalizes `undefined` → dropped (matches JSON.stringify behavior)
//   - throws on circular refs rather than truncating silently

const stableStringify = (value) => {
  const seen = new WeakSet();
  const serialize = (v) => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'null';
      return JSON.stringify(v);
    }
    if (typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'bigint') return JSON.stringify(v.toString());
    if (Array.isArray(v)) {
      return `[${v.map((item) => serialize(item)).join(',')}]`;
    }
    if (typeof v === 'object') {
      if (seen.has(v)) throw new Error('Cannot stable-stringify value with circular reference');
      seen.add(v);
      const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
      const body = keys.map((k) => `${JSON.stringify(k)}:${serialize(v[k])}`).join(',');
      return `{${body}}`;
    }
    // functions, symbols — treat like JSON does (omit)
    return 'null';
  };
  return serialize(value);
};

const sha256 = (input) => {
  const payload = typeof input === 'string' ? input : stableStringify(input);
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
};

// ── HMAC signing ─────────────────────────────────────────────────────────────

const SIGNATURE_DELIMITER = '|';

/**
 * Resolve the audit HMAC key from the environment. We accept either
 * `DEAL_EVENTS_HMAC_KEY` (preferred) or `AUDIT_HMAC_KEY` (legacy alias) to
 * avoid breaking operators who picked a name before this code landed.
 *
 * In development/test we fall back to a stable dev key so local flows don't
 * crash; the fallback is logged once so operators can't ship it by accident.
 */
let warnedAboutDevKey = false;
const DEV_FALLBACK_KEY = 'redip-dev-audit-key-not-for-production';

const getHmacKey = () => {
  const key = process.env.DEAL_EVENTS_HMAC_KEY || process.env.AUDIT_HMAC_KEY;
  if (key && key.trim().length >= 16) return key.trim();

  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  if (env === 'production') {
    throw createError(
      'DEAL_EVENTS_HMAC_KEY is not configured. Refusing to sign audit events with a dev key in production.',
      500,
    );
  }
  if (!warnedAboutDevKey) {
    warnedAboutDevKey = true;
    console.warn('[audit.service] DEAL_EVENTS_HMAC_KEY not set — using dev fallback. DO NOT DEPLOY LIKE THIS.');
  }
  return DEV_FALLBACK_KEY;
};

const buildSignaturePayload = (inputsHash, outputsHash, engineVersion) => (
  [inputsHash, outputsHash, engineVersion].join(SIGNATURE_DELIMITER)
);

const signEvent = ({ inputsHash, outputsHash, engineVersion }) => {
  const key = getHmacKey();
  return crypto
    .createHmac('sha256', key)
    .update(buildSignaturePayload(inputsHash, outputsHash, engineVersion), 'utf8')
    .digest('hex');
};

// ── Hashing helpers ──────────────────────────────────────────────────────────

const hashInputs = (inputs) => sha256(inputs ?? {});
const hashOutputs = (outputs) => sha256(outputs ?? {});

// ── Event recording ──────────────────────────────────────────────────────────

const SUPPORTED_EVENT_TYPES = new Set([
  'calculate_and_save',
  'scenario_recompute',
  'sensitivity_run',
  'manual_replay',
  'graph_snapshot',
  'export_snapshot',
]);

/**
 * Persist an immutable, signed audit row for a financial computation.
 *
 * Fails closed: if signing throws (e.g. missing prod HMAC key), no row is
 * written. Callers should catch and decide whether the underlying operation
 * should roll back (recommended for `calculate_and_save`) or proceed
 * without an audit entry (recommended for `scenario_recompute` reads).
 */
const recordEvent = async ({
  dealId,
  eventType,
  engineVersion,
  assetClass = null,
  inputs,
  outputs,
  actorId = null,
  metadata = {},
}) => {
  if (!dealId) throw createError('recordEvent: dealId is required', 400);
  if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType)) {
    throw createError(`recordEvent: unsupported eventType "${eventType}"`, 400);
  }
  if (!engineVersion) throw createError('recordEvent: engineVersion is required', 400);
  if (inputs == null || typeof inputs !== 'object') {
    throw createError('recordEvent: inputs must be an object', 400);
  }
  if (outputs == null || typeof outputs !== 'object') {
    throw createError('recordEvent: outputs must be an object', 400);
  }

  const inputsHash = hashInputs(inputs);
  const outputsHash = hashOutputs(outputs);
  const signature = signEvent({ inputsHash, outputsHash, engineVersion });

  const result = await query(
    `INSERT INTO deal_events (
       deal_id, organization_id, actor_id,
       event_type, engine_version, asset_class,
       inputs_hash, outputs_hash, signature,
       inputs_json, outputs_json, metadata
     ) VALUES (
       $1,
       (SELECT organization_id FROM deals WHERE id = $1),
       $2,
       $3, $4, $5,
       $6, $7, $8,
       $9, $10, $11
     )
     RETURNING id, deal_id, organization_id, actor_id, event_type,
               engine_version, asset_class, inputs_hash, outputs_hash,
               signature, metadata, created_at`,
    [
      dealId,
      actorId,
      eventType,
      engineVersion,
      assetClass,
      inputsHash,
      outputsHash,
      signature,
      JSON.stringify(inputs),
      JSON.stringify(outputs),
      JSON.stringify(metadata || {}),
    ],
  );

  return result.rows[0];
};

// ── Event reads ──────────────────────────────────────────────────────────────

const listEvents = async (dealId, { limit = 50, includeOutputs = false } = {}) => {
  const clampedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  // The Audit tab on the deal page diffs consecutive events to surface
  // which KPIs changed (IRR, revenue, cost, etc.). Doing that on the
  // backend is cheap (one extra column), and avoids 50× round-trips
  // from the UI to fetch each event's outputs separately. Default OFF
  // so existing callers don't pay for the larger payload.
  const outputsCol = includeOutputs ? ', outputs_json' : '';
  const result = await query(
    `SELECT id, deal_id, organization_id, actor_id,
            event_type, engine_version, asset_class,
            inputs_hash, outputs_hash, signature,
            metadata, created_at${outputsCol}
       FROM deal_events
      WHERE deal_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [dealId, clampedLimit],
  );
  return result.rows;
};

/**
 * Pull a small set of KPI fields out of `outputs_json` for the audit-tab
 * timeline. Lives in the audit service (not the UI) so the diff math
 * stays deterministic JS per CLAUDE.md hard rule.
 *
 * Returns null when the row didn't carry an outputs_json (legacy event)
 * or when none of the expected fields were present.
 */
const summarizeEventOutputs = (outputs) => {
  if (!outputs || typeof outputs !== 'object') return null;
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const summary = {
    irr_pct:           num(outputs.irr_pct ?? outputs.irr),
    npv_cr:            num(outputs.npv_cr ?? outputs.npv),
    total_revenue_cr:  num(outputs.total_revenue_cr ?? outputs.totalRevenueCr ?? outputs.total_revenue),
    total_cost_cr:     num(outputs.total_cost_cr ?? outputs.totalCostCr ?? outputs.total_cost),
    gross_profit_cr:   num(outputs.gross_profit_cr ?? outputs.grossProfitCr),
    gross_margin_pct:  num(outputs.gross_margin_pct ?? outputs.grossMarginPct),
    equity_multiple:   num(outputs.equity_multiple ?? outputs.equityMultiple),
    residual_land_value_cr: num(outputs.residual_land_value_cr ?? outputs.residualLandValueCr),
  };
  // If literally nothing came through, return null so the UI knows there's
  // no comparable summary for this row.
  const hasAny = Object.values(summary).some((v) => v !== null);
  return hasAny ? summary : null;
};

const getEvent = async (eventId) => {
  const result = await query(
    `SELECT *
       FROM deal_events
      WHERE id = $1`,
    [eventId],
  );
  if (result.rows.length === 0) throw createError('Audit event not found.', 404);
  return result.rows[0];
};

// ── Verification + replay ────────────────────────────────────────────────────

/**
 * Cryptographically verify a stored event:
 *   1. Re-hash inputs_json → must equal stored inputs_hash
 *   2. Re-hash outputs_json → must equal stored outputs_hash
 *   3. HMAC(inputs_hash|outputs_hash|engine_version) with the current key
 *      must equal stored signature
 *
 * Returns { ok, checks } — each check reports pass/fail so callers can show
 * operators exactly which layer tripped. Never throws on verify failure;
 * callers decide whether a mismatch is fatal.
 */
const verifyEvent = (event) => {
  const stored = typeof event.inputs_json === 'string'
    ? JSON.parse(event.inputs_json)
    : event.inputs_json;
  const storedOut = typeof event.outputs_json === 'string'
    ? JSON.parse(event.outputs_json)
    : event.outputs_json;

  const recomputedInputsHash = hashInputs(stored);
  const recomputedOutputsHash = hashOutputs(storedOut);

  let expectedSignature = null;
  try {
    expectedSignature = signEvent({
      inputsHash: event.inputs_hash,
      outputsHash: event.outputs_hash,
      engineVersion: event.engine_version,
    });
  } catch (_err) {
    // key unavailable — treat as signature failure
    expectedSignature = null;
  }

  const checks = {
    inputsHashMatches: recomputedInputsHash === event.inputs_hash,
    outputsHashMatches: recomputedOutputsHash === event.outputs_hash,
    signatureMatches: expectedSignature != null
      && timingSafeEq(expectedSignature, event.signature),
  };
  return {
    ok: checks.inputsHashMatches && checks.outputsHashMatches && checks.signatureMatches,
    checks,
    recomputedInputsHash,
    recomputedOutputsHash,
  };
};

const timingSafeEq = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
};

/**
 * Re-run the kernel against the stored inputs and compare the re-computed
 * outputs to the stored outputs. Useful for proving that a given deal's
 * numbers can still be reproduced from first principles under the current
 * engine version.
 *
 * A replay can PASS the output comparison even when `verifyEvent` fails
 * (e.g. HMAC key rotated) — that's the point: the deterministic kernel is
 * the ultimate authority.
 */
const replayEvent = (event) => {
  // Lazy require to avoid a circular module graph (kernel.service →
  // financial.service → audit.service → kernel.service).
  // eslint-disable-next-line global-require
  const { computeFullFinancials } = require('../engines/kernel.service');

  const storedInputs = typeof event.inputs_json === 'string'
    ? JSON.parse(event.inputs_json)
    : event.inputs_json;
  const storedOutputs = typeof event.outputs_json === 'string'
    ? JSON.parse(event.outputs_json)
    : event.outputs_json;

  // skipSensitivity + skipGraph keep the replay cheap; the golden numbers
  // live in the flat KPI / cost / revenue maps that the original save
  // hashed. Individual sites can set these in stored.inputs if they need
  // the extra data back.
  const replayInputs = { ...storedInputs, skipSensitivity: true, skipGraph: true };
  let replayed;
  try {
    replayed = computeFullFinancials(replayInputs);
  } catch (err) {
    return {
      ok: false,
      reason: 'kernel_error',
      message: err.message,
    };
  }

  const replayOutputs = flattenOutputsForAudit(replayed);
  const replayOutputsHash = hashOutputs(replayOutputs);
  const originalOutputsHash = event.outputs_hash;

  return {
    ok: replayOutputsHash === originalOutputsHash,
    replayOutputsHash,
    originalOutputsHash,
    storedOutputs,
    replayOutputs,
  };
};

/**
 * Canonical shape used for hashing outputs. Keeps replay deterministic
 * regardless of which compute path produced the numbers — always pass the
 * result of `computeFullFinancials` through this before hashing.
 */
const flattenOutputsForAudit = (computed) => ({
  kpis: computed.kpis || {},
  costs: computed.costs || {},
  revenue: computed.revenue || {},
  areas: computed.areas || {},
  engineVersion: computed.engineVersion || 'kernel-v2',
});

module.exports = {
  recordEvent,
  listEvents,
  getEvent,
  verifyEvent,
  replayEvent,
  flattenOutputsForAudit,
  summarizeEventOutputs,
  // Exported for unit tests + other services that need identical hashing.
  _internal: {
    stableStringify,
    sha256,
    hashInputs,
    hashOutputs,
    signEvent,
    SUPPORTED_EVENT_TYPES,
  },
};
