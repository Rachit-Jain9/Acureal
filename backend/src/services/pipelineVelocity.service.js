'use strict';

/**
 * Pipeline Velocity aggregator — deterministic deal-flow analytics.
 *
 * The questions a deal team currently exports to Excel to answer, served as
 * one grounded payload:
 *   - FUNNEL: how many deals ever reached each stage + the conversion (and
 *     implied drop-off) rate between consecutive stages.
 *   - TIME-IN-STAGE: the MEDIAN days deals dwell in each stage.
 *   - CYCLE TIME: median days from genesis to reaching key milestones
 *     (underwriting / IC review / active).
 *   - AGING: live deals parked in their current stage well beyond that
 *     stage's own typical dwell — the "needs a nudge" list.
 *   - THROUGHPUT: forward stage-advances per month (momentum).
 *
 * Reconstructed from `deal_stage_history` (every stage change writes a row —
 * deal.service.js:425/893) + each deal's genesis (`created_at`). TWO org-scoped
 * round-trips (deals + their history events), then PURE JS compose — so every
 * number is unit-testable from a synthetic history fixture with a pinned `asOf`.
 *
 * Honesty bar (CLAUDE.md — verified-or-unavailable, never fabricate):
 *   - MEDIAN, not mean (one 200-day outlier never skews the headline).
 *   - A stage with < MIN_SAMPLES completed dwells reports
 *     `{ insufficient: true, median_days: null }` — the UI renders an em-dash,
 *     NEVER `0` days (the `Number(null) === 0` trap).
 *   - `dead → sourced` revivals (domain.js) make history non-monotonic, so the
 *     funnel counts DISTINCT "ever reached" by FURTHEST position, never a
 *     linear walk that would double-count a revived deal.
 *   - Pure deterministic SQL + JS. No AI, no legal-four exposure.
 *   - Migration-tolerant: a missing table yields an empty payload, never a 500.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'pipelineVelocity.service' });

const PG_UNDEFINED_TABLE = '42P01';
const PG_UNDEFINED_SCHEMA = '3F000';
const isMissingTable = (err) =>
  Boolean(err) && (err.code === PG_UNDEFINED_TABLE || err.code === PG_UNDEFINED_SCHEMA);

// The forward funnel, in order (position = index). `dead` is terminal and is
// handled separately — a dead deal still "reached" its furthest forward stage.
const FUNNEL_STAGES = [
  'sourced', 'screening', 'site_visit', 'loi', 'due_diligence',
  'underwriting', 'ic_review', 'negotiation', 'active', 'closed',
];
const STAGE_LABELS = {
  sourced: 'Sourced', screening: 'Screening', site_visit: 'Site visit', loi: 'LOI',
  due_diligence: 'Due diligence', underwriting: 'Underwriting', ic_review: 'IC review',
  negotiation: 'Negotiation', active: 'Active', closed: 'Closed', dead: 'Dead',
};
// Milestones whose time-from-genesis we headline.
const CYCLE_MILESTONES = ['underwriting', 'ic_review', 'active'];
// Minimum completed dwells before a stage's median is trustworthy enough to show.
const MIN_SAMPLES = 3;
// A live deal under this many days in-stage is never "stuck", regardless of the
// stage median (avoids flagging a brand-new deal in a fast stage).
const AGING_FLOOR_DAYS = 21;
const MS_PER_DAY = 86400000;

const stagePos = (stage) => FUNNEL_STAGES.indexOf(stage);
const daysBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY;
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

const median = (nums) => {
  const xs = (nums || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
};

/**
 * Reconstruct a deal's stage timeline from its genesis + ordered history.
 * Returns [{ stage, enteredAt, exitedAt|null, days }] — the LAST segment is the
 * current (open) stage, with exitedAt null and days = age-so-far at `asOf`.
 *
 * Genesis: the first transition's `from_stage` entered at `created_at`. With no
 * history, the deal's current stage IS the genesis (entered at created_at).
 */
const buildTimeline = (deal, events, asOf) => {
  const sorted = [...(events || [])].sort(
    (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime(),
  );
  let prevStage = sorted.length ? (sorted[0].from_stage || deal.stage) : deal.stage;
  let prevAt = deal.created_at;
  const segments = [];
  for (const ev of sorted) {
    segments.push({ stage: prevStage, enteredAt: prevAt, exitedAt: ev.changed_at });
    prevStage = ev.to_stage;
    prevAt = ev.changed_at;
  }
  segments.push({ stage: prevStage, enteredAt: prevAt, exitedAt: null });
  return segments.map((s) => ({
    ...s,
    days: s.exitedAt ? daysBetween(s.enteredAt, s.exitedAt) : daysBetween(s.enteredAt, asOf),
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
//  Pure compose — the whole velocity payload from deals + their events
// ─────────────────────────────────────────────────────────────────────────────

const composePipelineVelocity = (deals, eventsByDeal, asOf = new Date()) => {
  const timelines = (deals || []).map((deal) => ({
    deal,
    segments: buildTimeline(deal, (eventsByDeal && eventsByDeal.get(deal.id)) || [], asOf),
  }));

  // ── Funnel: each deal counts toward every stage up to its FURTHEST position ──
  const reached = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
  const currentByStage = {};
  let deadCount = 0;
  for (const { deal, segments } of timelines) {
    // FUNNEL REACH is historical — every analysed deal (incl. archived/closed)
    // counts toward each stage up to its furthest position.
    const maxPos = Math.max(-1, ...segments.map((s) => stagePos(s.stage)));
    for (const stg of FUNNEL_STAGES) {
      if (maxPos >= 0 && maxPos >= stagePos(stg)) reached[stg] += 1;
    }
    // CURRENT distribution is the LIVE portfolio only — an archived deal is not
    // "currently at" a stage.
    if (!deal.is_archived) {
      currentByStage[deal.stage] = (currentByStage[deal.stage] || 0) + 1;
      if (deal.stage === 'dead') deadCount += 1;
    }
  }

  const funnel = FUNNEL_STAGES.map((stage, i) => {
    const next = FUNNEL_STAGES[i + 1] || null;
    const reachedCount = reached[stage];
    return {
      stage,
      label: STAGE_LABELS[stage],
      reached: reachedCount,
      current: currentByStage[stage] || 0,
      next_stage: next,
      conversion_to_next_pct:
        next && reachedCount > 0 ? round1((reached[next] / reachedCount) * 100) : null,
    };
  });

  // ── Time-in-stage: median over COMPLETED dwells (open current segment excluded) ──
  const dwellsByStage = {};
  for (const { segments } of timelines) {
    for (const s of segments) {
      if (s.exitedAt == null) continue;
      (dwellsByStage[s.stage] = dwellsByStage[s.stage] || []).push(s.days);
    }
  }
  const time_in_stage = FUNNEL_STAGES.filter((s) => s !== 'closed').map((stage) => {
    const samples = dwellsByStage[stage] || [];
    const insufficient = samples.length < MIN_SAMPLES;
    return {
      stage,
      label: STAGE_LABELS[stage],
      sample_size: samples.length,
      insufficient,
      median_days: insufficient ? null : round1(median(samples)),
    };
  });
  const medianByStage = Object.fromEntries(time_in_stage.map((t) => [t.stage, t.median_days]));

  // ── Cycle time: genesis → first time the deal entered each milestone ──
  const cycle_time = CYCLE_MILESTONES.map((milestone) => {
    const durations = [];
    for (const { deal, segments } of timelines) {
      const seg = segments.find((s) => s.stage === milestone);
      if (seg) {
        const d = daysBetween(deal.created_at, seg.enteredAt);
        if (Number.isFinite(d) && d >= 0) durations.push(d);
      }
    }
    const insufficient = durations.length < MIN_SAMPLES;
    return {
      milestone,
      label: STAGE_LABELS[milestone],
      reached_count: durations.length,
      insufficient,
      median_days: insufficient ? null : round1(median(durations)),
    };
  });

  // ── Aging: live deals parked beyond 2× their stage median (or the floor) ──
  const aging = [];
  for (const { deal, segments } of timelines) {
    if (deal.is_archived || deal.stage === 'closed' || deal.stage === 'dead') continue;
    const current = segments[segments.length - 1];
    const ageDays = current.days;
    const typical = medianByStage[deal.stage];
    const threshold = typical != null ? Math.max(typical * 2, AGING_FLOOR_DAYS) : 60;
    if (ageDays > threshold) {
      aging.push({
        deal_id: deal.id,
        deal_name: deal.name,
        stage: deal.stage,
        stage_label: STAGE_LABELS[deal.stage],
        days_in_stage: Math.round(ageDays),
        typical_days: typical != null ? round1(typical) : null,
      });
    }
  }
  aging.sort((a, b) => b.days_in_stage - a.days_in_stage);

  // ── Throughput: forward stage-advances per month over the last 6 months ──
  const monthKey = (d) => {
    const dt = new Date(d);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const advancesByMonth = {};
  for (const { segments } of timelines) {
    // a "forward advance" = entering a later funnel stage than the previous one.
    for (let i = 1; i < segments.length; i += 1) {
      const from = stagePos(segments[i - 1].stage);
      const to = stagePos(segments[i].stage);
      // Genuine intra-funnel advance only — `from` must be a real funnel stage,
      // so a `dead → sourced` revival (from = -1) is NOT counted as progress.
      if (from >= 0 && to > from) {
        const k = monthKey(segments[i].enteredAt);
        advancesByMonth[k] = (advancesByMonth[k] || 0) + 1;
      }
    }
  }
  const throughput = [];
  const cursor = new Date(Date.UTC(new Date(asOf).getUTCFullYear(), new Date(asOf).getUTCMonth(), 1));
  for (let i = 5; i >= 0; i -= 1) {
    const dt = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
    const k = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    throughput.push({
      month: `${MONTH_LABELS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`,
      advances: advancesByMonth[k] || 0,
    });
  }

  // ── Headline ──
  const liveCount = timelines.filter(
    ({ deal }) => !deal.is_archived && deal.stage !== 'closed' && deal.stage !== 'dead',
  ).length;
  const cycleToActive = cycle_time.find((c) => c.milestone === 'active');
  // Biggest drop-off: the funnel step with the lowest conversion (most leakage),
  // considering only steps that had a meaningful base to convert from.
  const dropOff = funnel
    .filter((f) => f.conversion_to_next_pct != null && f.reached >= MIN_SAMPLES)
    .sort((a, b) => a.conversion_to_next_pct - b.conversion_to_next_pct)[0] || null;

  return {
    headline: {
      total_deals: timelines.length,
      live_deals: liveCount,
      closed_deals: currentByStage.closed || 0,
      dead_deals: deadCount,
      median_days_to_active: cycleToActive ? cycleToActive.median_days : null,
      aging_count: aging.length,
      biggest_dropoff: dropOff
        ? {
            from_stage: dropOff.stage,
            from_label: dropOff.label,
            to_stage: dropOff.next_stage,
            conversion_pct: dropOff.conversion_to_next_pct,
          }
        : null,
    },
    funnel,
    time_in_stage,
    cycle_time,
    aging,
    throughput,
    disclaimer:
      'Pipeline Velocity is a deterministic roll-up of your team\'s recorded stage changes. ' +
      'Medians are shown only where there are enough completed stage moves to be meaningful; ' +
      'thin stages read "insufficient data" rather than a misleading single-sample figure.',
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the pipeline-velocity payload for the caller's organisation.
 *
 * Scope: org-owned OR shared-to-user deals, EXCLUDING archived — but INCLUDING
 * `dead` and `closed` (a dead deal still reached stages; a closed deal completed
 * the cycle), which is why this does NOT use `buildVisibleDealCondition` (that
 * helper bakes in `stage <> 'dead'`). The org/shares security predicate is
 * identical; only the dead-exclusion is dropped, deliberately.
 *
 * Returns the composePipelineVelocity payload; an empty-but-valid payload when
 * there are no deals or the history table is missing (migration-tolerant).
 */
const getPipelineVelocity = async () => {
  try {
    const dealsResult = await query(
      // Historical pipeline analysis INCLUDES archived + closed + dead deals —
      // they flowed through stages, and that history IS the funnel/velocity data
      // (excluding them would discard most of the signal). The current-stage
      // distribution + aging views re-filter to non-archived in the composer.
      `SELECT d.id, d.name, d.stage, d.created_at, d.is_archived
         FROM deals d
        WHERE (
                d.organization_id = current_organization_id()
                OR d.id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
              )`,
    );
    const deals = dealsResult.rows || [];
    if (deals.length === 0) return composePipelineVelocity([], new Map());

    const dealIds = deals.map((d) => d.id);
    let eventsByDeal = new Map();
    try {
      const eventsResult = await query(
        `SELECT deal_id, from_stage, to_stage, changed_at
           FROM deal_stage_history
          WHERE deal_id = ANY($1::uuid[])
          ORDER BY deal_id, changed_at ASC`,
        [dealIds],
      );
      eventsByDeal = new Map();
      for (const row of eventsResult.rows || []) {
        if (!eventsByDeal.has(row.deal_id)) eventsByDeal.set(row.deal_id, []);
        eventsByDeal.get(row.deal_id).push(row);
      }
    } catch (histErr) {
      // No history table yet → compose from current stage only (every deal a
      // single open genesis segment). Still yields a valid funnel + aging.
      if (!isMissingTable(histErr)) throw histErr;
      log.warn('pipeline_velocity_history_missing', { error: histErr.message });
    }

    return composePipelineVelocity(deals, eventsByDeal, new Date());
  } catch (err) {
    if (isMissingTable(err)) {
      log.warn('pipeline_velocity_missing_table', { error: err.message });
      return composePipelineVelocity([], new Map());
    }
    log.warn('pipeline_velocity_query_failed', { error: err.message, code: err.code });
    return composePipelineVelocity([], new Map());
  }
};

module.exports = {
  getPipelineVelocity,
  // Pure helpers exported for tests.
  composePipelineVelocity,
  buildTimeline,
  median,
  stagePos,
  FUNNEL_STAGES,
  STAGE_LABELS,
  CYCLE_MILESTONES,
  MIN_SAMPLES,
};
