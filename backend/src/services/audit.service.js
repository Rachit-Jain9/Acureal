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
const log = require('../lib/logger').child({ module: 'audit' });

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
}, exec = query) => {
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

  const result = await exec(
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

/**
 * Load every signed financial event for a deal, oldest→newest, WITH the stored
 * input/output JSON needed to re-verify each signature. Chronological order so
 * the chain reads first-computation → latest.
 */
const listEventsForVerification = async (dealId) => {
  const result = await query(
    `SELECT id, deal_id, actor_id, event_type, engine_version, asset_class,
            inputs_hash, outputs_hash, signature, inputs_json, outputs_json,
            created_at
       FROM deal_events
      WHERE deal_id = $1
      ORDER BY created_at ASC, id ASC`,
    [dealId],
  );
  return result.rows;
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
// Stored audit JSON can be damaged (interrupted write, DB corruption, a manual
// edit). Parse defensively so a SyntaxError never escapes the documented
// "never throws on verify failure" contract as an opaque 500.
const safeParseStored = (value) => {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const verifyEvent = (event) => {
  const stored = safeParseStored(event.inputs_json);
  const storedOut = safeParseStored(event.outputs_json);
  if (stored === null || storedOut === null) {
    // Honor the no-throw contract: report a clean verify failure for an
    // unparseable stored payload rather than bubbling a SyntaxError.
    return {
      ok: false,
      checks: { inputsHashMatches: false, outputsHashMatches: false, signatureMatches: false },
      recomputedInputsHash: null,
      recomputedOutputsHash: null,
      error: 'stored payload unparseable',
    };
  }

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

  const storedInputs = safeParseStored(event.inputs_json);
  const storedOutputs = safeParseStored(event.outputs_json);
  if (storedInputs === null) {
    // Unparseable stored inputs — cannot replay. Fail cleanly (no throw).
    return { ok: false, reason: 'unparseable_payload', message: 'stored inputs could not be parsed' };
  }

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

// ── Whole-deal chain verification ────────────────────────────────────────────

/**
 * Is the HMAC signing key resolvable? In production this is false only when
 * DEAL_EVENTS_HMAC_KEY is unset — in which case signatures can't be checked and
 * the UI must say so honestly ("key unavailable") rather than reporting every
 * row as tampered. In dev/test a stable fallback key is always available.
 */
const isSignatureKeyAvailable = () => {
  try {
    getHmacKey();
    return true;
  } catch {
    return false;
  }
};

// The event types that carry replayable kernel inputs (a computation, not a
// pure snapshot/export). Used to pick the latest event worth re-running.
const REPLAYABLE_EVENT_TYPES = new Set([
  'calculate_and_save',
  'scenario_recompute',
  'sensitivity_run',
  'manual_replay',
]);

/**
 * Verify a deal's ENTIRE signed computation history in one pass — the "verify
 * our numbers yourself" primitive behind the Audit tab's Integrity panel.
 *
 * For every signed financial event it re-hashes the stored inputs/outputs and
 * re-checks the HMAC signature (via verifyEvent), then optionally re-runs the
 * deterministic kernel against the most recent computation to prove the current
 * numbers still reproduce from first principles.
 *
 * Pure read-side; never throws on a verification miss — a tampered or
 * key-rotated row is reported as `ok:false`, not an exception. Returns a
 * compact per-event result list (for the UI's cascade) plus roll-ups.
 *
 * @param {string} dealId
 * @param {{ replayLatest?: boolean }} opts
 */
const verifyChain = async (dealId, { replayLatest = true } = {}) => {
  const rows = await listEventsForVerification(dealId);
  const keyAvailable = isSignatureKeyAvailable();

  const events = rows.map((row) => {
    const v = verifyEvent(row);
    return {
      id: row.id,
      event_type: row.event_type,
      engine_version: row.engine_version,
      created_at: row.created_at,
      ok: v.ok,
      checks: v.checks,
    };
  });

  const total = events.length;
  const verified = events.filter((e) => e.ok).length;
  const failed = total - verified;
  const engineVersions = [...new Set(rows.map((r) => r.engine_version).filter(Boolean))];

  // The quotable reference for the latest committed computation. Derived from
  // the rows already loaded above rather than re-queried, so the string this
  // panel shows and the string an export stamps can never drift apart — that
  // identity is the whole point of the reference.
  const latestComputationRow = [...rows]
    .reverse()
    .find((r) => r.event_type === 'calculate_and_save') || null;
  const latestSensitivityRow = [...rows]
    .reverse()
    .find((r) => r.event_type === 'sensitivity_run') || null;
  const latestComputation = latestComputationRow
    ? {
      event_id: latestComputationRow.id,
      ref: formatComputationRef({
        engineVersion: latestComputationRow.engine_version,
        outputsHash: latestComputationRow.outputs_hash,
        computedAt: latestComputationRow.created_at,
      }),
      engine_version: latestComputationRow.engine_version || null,
      inputs_hash: latestComputationRow.inputs_hash || null,
      outputs_hash: latestComputationRow.outputs_hash || null,
      computed_at: latestComputationRow.created_at,
      signed: keyAvailable,
      sensitivity_may_be_newer: Boolean(
        latestSensitivityRow
        && new Date(latestSensitivityRow.created_at) > new Date(latestComputationRow.created_at),
      ),
    }
    : null;

  // Re-run the kernel on the most recent replayable event so the panel can
  // claim more than "the signature is intact" — it can claim "the numbers
  // themselves reproduce". Walk newest→oldest (rows are oldest→newest).
  let replay = null;
  if (replayLatest) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (REPLAYABLE_EVENT_TYPES.has(rows[i].event_type)) {
        const r = replayEvent(rows[i]);
        replay = {
          attempted: true,
          ok: r.ok === true,
          event_id: rows[i].id,
          event_type: rows[i].event_type,
          created_at: rows[i].created_at,
          reason: r.reason || null,
        };
        break;
      }
    }
  }

  return {
    deal_id: dealId,
    generated_at: new Date().toISOString(),
    total_events: total,
    verified,
    failed,
    all_verified: total > 0 && failed === 0,
    key_available: keyAvailable,
    engine_versions: engineVersions,
    first_at: rows.length ? rows[0].created_at : null,
    last_at: rows.length ? rows[rows.length - 1].created_at : null,
    latest_computation: latestComputation,
    events,
    replay,
  };
};

// ── Computation reference ────────────────────────────────────────────────────

/**
 * A short, quotable identifier for the deal's latest committed kernel
 * computation — the thing a reader can cite when asking "which run produced
 * these numbers?".
 *
 * NAMING: deliberately NOT "snapshot". That word already means three unrelated
 * things in this repo (the IC-memo LLM prompt-cache hash,
 * parcel_intelligence_snapshots, and the rent-roll register snapshots).
 * A fourth meaning — on an investor-facing document — is how the wrong hash
 * ends up printed. It is a "computation reference" everywhere: code and copy.
 *
 * FORMAT: `kernel-v2 · 7f3a91c4e2b8 · 2026-07-20`
 *   engine version — which kernel produced it
 *   12 hex of outputs_hash — content-addressed, so two identical computations
 *     yield the same ref and any changed figure yields a different one
 *   date — human orientation
 * The full deal_events UUID rides alongside in the payload for exact lookup,
 * but is never printed on a customer document: 36 opaque characters reads as a
 * leaked database key, and it is not content-addressed.
 *
 * WHAT THIS REF DOES AND DOES NOT COVER — the honesty boundary that must
 * survive every future edit:
 *   • COVERED: the figures in `flattenOutputsForAudit` — kpis, costs, revenue,
 *     areas, engineVersion.
 *   • NOT COVERED: cash-flow schedules, the capital stack, the proforma and
 *     the sensitivity matrix. Those are replay-DERIVABLE from the signed
 *     inputs, which is a weaker and different claim than being signed.
 *   • `sensitivity_matrix` is additionally mutated by runSensitivity OUTSIDE
 *     any calculate_and_save, so an exported tornado can be NEWER than the
 *     referenced computation — hence `sensitivity_may_be_newer`.
 * Copy built on this MUST NOT claim "every number in this document is signed".
 */
const COMPUTATION_REF_HASH_CHARS = 12;

const formatComputationRef = ({ engineVersion, outputsHash, computedAt }) => {
  if (!outputsHash) return null;
  const day = computedAt ? new Date(computedAt).toISOString().slice(0, 10) : null;
  return [
    engineVersion || 'kernel',
    String(outputsHash).slice(0, COMPUTATION_REF_HASH_CHARS),
    day,
  ].filter(Boolean).join(' · ');
};

/**
 * Resolve the latest COMMITTED computation for a deal. Returns null when the
 * deal has never been calculated — callers must degrade to "not computed yet"
 * rather than inventing a reference.
 */
const getLatestComputationRef = async (dealId) => {
  const result = await query(
    `SELECT e.id, e.event_type, e.engine_version, e.inputs_hash, e.outputs_hash,
            e.created_at,
            -- A sensitivity_run writes financials.sensitivity_matrix OUTSIDE
            -- calculate_and_save, so a tornado on screen can post-date the
            -- referenced computation. Read it from the signed event log rather
            -- than a financials timestamp: same table, already indexed, and it
            -- is the exact fact we mean.
            (SELECT MAX(s.created_at)
               FROM deal_events s
              WHERE s.deal_id = e.deal_id
                AND s.event_type = 'sensitivity_run') AS latest_sensitivity_at
       FROM deal_events e
      WHERE e.deal_id = $1
        AND e.event_type = 'calculate_and_save'
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1`,
    [dealId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const sensitivityAt = row.latest_sensitivity_at || null;
  return {
    event_id: row.id,
    ref: formatComputationRef({
      engineVersion: row.engine_version,
      outputsHash: row.outputs_hash,
      computedAt: row.created_at,
    }),
    engine_version: row.engine_version || null,
    inputs_hash: row.inputs_hash || null,
    outputs_hash: row.outputs_hash || null,
    computed_at: row.created_at,
    // Never hardcoded: without the HMAC key nothing can honestly be called
    // "signed", and the UI must say so instead of asserting an unverifiable claim.
    signed: isSignatureKeyAvailable(),
    // True when the tornado/sensitivity output on screen post-dates the
    // referenced computation (runSensitivity writes outside calculate_and_save).
    sensitivity_may_be_newer: Boolean(
      sensitivityAt && new Date(sensitivityAt) > new Date(row.created_at),
    ),
  };
};

/**
 * Record that a document was exported carrying a given computation reference.
 *
 * Completes a promise the codebase already made and never kept: 'export_snapshot'
 * has been an allowed event type with a wired UI label and ZERO producers, so
 * the timeline could never answer "what did we actually send the IC, and which
 * computation was in it?".
 *
 * FAIL-OPEN, ALWAYS. Exports are HTTP GETs; recording turns them into write
 * paths, and an audit write must never be the reason a user cannot download
 * their report. Every failure is logged and swallowed.
 */
const recordExportSnapshot = async ({ dealId, format, computationRef, actorId = null }) => {
  try {
    if (!dealId || !format) return null;
    return await recordEvent({
      dealId,
      eventType: 'export_snapshot',
      // Mirrors the referenced computation's engine so the row is self-describing
      // even if the reference itself is absent.
      engineVersion: computationRef?.engine_version || 'kernel-v2',
      actorId,
      inputs: {
        format,
        computation_ref: computationRef?.ref || null,
        source_event_id: computationRef?.event_id || null,
      },
      outputs: {
        outputs_hash: computationRef?.outputs_hash || null,
      },
      metadata: {
        format,
        // An export of an uncalculated deal is a real, loggable state — not an
        // error — and the null reference says so honestly.
        stamped: Boolean(computationRef?.ref),
      },
    });
  } catch (err) {
    log.warn('export_snapshot_record_failed', { dealId, format, error: err.message });
    return null;
  }
};

module.exports = {
  recordEvent,
  recordExportSnapshot,
  listEvents,
  listEventsForVerification,
  getLatestComputationRef,
  formatComputationRef,
  getEvent,
  verifyEvent,
  replayEvent,
  verifyChain,
  isSignatureKeyAvailable,
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
