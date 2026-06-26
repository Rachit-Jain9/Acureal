'use strict';

// Deterministic pipeline-velocity math, pinned against a synthetic
// deal_stage_history fixture + a fixed `asOf`. Exercises: a full linear path,
// a dead-then-revived deal (non-monotonic history), single-sample stages
// (insufficient-data gating), and open current segments (excluded from dwell
// medians). Pure compose — no DB.

const {
  composePipelineVelocity,
  buildTimeline,
  median,
} = require('../src/services/pipelineVelocity.service');

const ev = (deal_id, from_stage, to_stage, changed_at) => ({ deal_id, from_stage, to_stage, changed_at });
const ASOF = new Date('2026-06-30T00:00:00Z');

const DEALS = [
  { id: 'A', name: 'Alpha', stage: 'underwriting', created_at: '2026-01-01T00:00:00Z' },
  { id: 'B', name: 'Bravo', stage: 'dead', created_at: '2026-02-01T00:00:00Z' },
  { id: 'C', name: 'Charlie', stage: 'screening', created_at: '2026-03-01T00:00:00Z' },
  { id: 'D', name: 'Delta', stage: 'sourced', created_at: '2026-06-01T00:00:00Z' },
];
const EVENTS = new Map([
  ['A', [
    ev('A', 'sourced', 'screening', '2026-01-11T00:00:00Z'),
    ev('A', 'screening', 'site_visit', '2026-01-21T00:00:00Z'),
    ev('A', 'site_visit', 'loi', '2026-01-31T00:00:00Z'),
    ev('A', 'loi', 'due_diligence', '2026-02-10T00:00:00Z'),
    ev('A', 'due_diligence', 'underwriting', '2026-02-25T00:00:00Z'),
  ]],
  ['B', [
    ev('B', 'sourced', 'screening', '2026-02-09T00:00:00Z'),
    ev('B', 'screening', 'site_visit', '2026-02-19T00:00:00Z'),
    ev('B', 'site_visit', 'dead', '2026-03-01T00:00:00Z'),
  ]],
  ['C', [
    ev('C', 'sourced', 'screening', '2026-03-13T00:00:00Z'),
    ev('C', 'screening', 'dead', '2026-03-20T00:00:00Z'),
    ev('C', 'dead', 'sourced', '2026-04-01T00:00:00Z'),
    ev('C', 'sourced', 'screening', '2026-04-15T00:00:00Z'),
  ]],
  // D: no history — single open genesis segment at its created_at.
]);

const out = composePipelineVelocity(DEALS, EVENTS, ASOF);
const stage = (list, key, s) => list.find((x) => x[key] === s);

describe('median helper', () => {
  test('odd / even / empty', () => {
    expect(median([7, 10, 10])).toBe(10);
    expect(median([8, 10, 12, 14])).toBe(11);
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
  });
});

describe('buildTimeline', () => {
  test('a deal with no events is one open genesis segment at created_at', () => {
    const segs = buildTimeline(DEALS[3], [], ASOF);
    expect(segs).toHaveLength(1);
    expect(segs[0].stage).toBe('sourced');
    expect(segs[0].exitedAt).toBeNull();
    expect(Math.round(segs[0].days)).toBe(29); // 2026-06-01 → 2026-06-30
  });

  test('genesis stage = the first transition\'s from_stage, entered at created_at', () => {
    const segs = buildTimeline(DEALS[0], EVENTS.get('A'), ASOF);
    expect(segs[0].stage).toBe('sourced');
    expect(Math.round(segs[0].days)).toBe(10); // sourced dwell
    expect(segs[segs.length - 1].stage).toBe('underwriting');
    expect(segs[segs.length - 1].exitedAt).toBeNull();
  });
});

describe('funnel — furthest-reached, dedupes revivals', () => {
  test('reached counts each deal once up to its furthest stage', () => {
    expect(stage(out.funnel, 'stage', 'sourced').reached).toBe(4);
    expect(stage(out.funnel, 'stage', 'screening').reached).toBe(3); // A,B,C (C revived but counted once)
    expect(stage(out.funnel, 'stage', 'site_visit').reached).toBe(2);
    expect(stage(out.funnel, 'stage', 'loi').reached).toBe(1);
    expect(stage(out.funnel, 'stage', 'underwriting').reached).toBe(1);
    expect(stage(out.funnel, 'stage', 'ic_review').reached).toBe(0);
  });

  test('conversion to next stage', () => {
    expect(stage(out.funnel, 'stage', 'sourced').conversion_to_next_pct).toBe(75); // 3/4
    expect(stage(out.funnel, 'stage', 'screening').conversion_to_next_pct).toBe(66.7); // 2/3
    expect(stage(out.funnel, 'stage', 'underwriting').conversion_to_next_pct).toBe(0); // 0/1
    expect(stage(out.funnel, 'stage', 'closed').conversion_to_next_pct).toBeNull(); // terminal
  });
});

describe('time-in-stage — median over completed dwells, gates small N', () => {
  test('sufficient stages report a median; open segments are excluded', () => {
    const sourced = stage(out.time_in_stage, 'stage', 'sourced');
    expect(sourced.sample_size).toBe(4); // A,B,C-1st,C-2nd (D is open → excluded)
    expect(sourced.median_days).toBe(11);
    expect(sourced.insufficient).toBe(false);

    const screening = stage(out.time_in_stage, 'stage', 'screening');
    expect(screening.sample_size).toBe(3); // A,B,C-1st (C-2nd is the open current segment)
    expect(screening.median_days).toBe(10);
  });

  test('a stage with < MIN_SAMPLES dwells is insufficient with null median (never 0)', () => {
    const sv = stage(out.time_in_stage, 'stage', 'site_visit');
    expect(sv.sample_size).toBe(2);
    expect(sv.insufficient).toBe(true);
    expect(sv.median_days).toBeNull();
  });
});

describe('cycle time + aging + throughput + headline', () => {
  test('cycle time to a thin milestone is insufficient (null, not 0)', () => {
    const uw = out.cycle_time.find((c) => c.milestone === 'underwriting');
    expect(uw.reached_count).toBe(1);
    expect(uw.insufficient).toBe(true);
    expect(uw.median_days).toBeNull();
  });

  test('aging lists live deals parked beyond their stage typical, longest first', () => {
    expect(out.aging.map((a) => a.deal_id)).toEqual(['A', 'C', 'D']);
    expect(out.aging[0].days_in_stage).toBe(125); // A in underwriting
    // dead deal B is never in the aging list
    expect(out.aging.some((a) => a.deal_id === 'B')).toBe(false);
  });

  test('throughput is a 6-month series of intra-funnel advances (revival not counted)', () => {
    expect(out.throughput).toHaveLength(6);
    expect(out.throughput[out.throughput.length - 1].month).toBe('Jun 2026');
    expect(out.throughput.reduce((s, m) => s + m.advances, 0)).toBe(9);
  });

  test('headline summarises the pipeline honestly', () => {
    expect(out.headline.total_deals).toBe(4);
    expect(out.headline.live_deals).toBe(3); // A,C,D (B dead)
    expect(out.headline.dead_deals).toBe(1);
    expect(out.headline.aging_count).toBe(3);
    expect(out.headline.median_days_to_active).toBeNull(); // none reached active
    expect(out.headline.biggest_dropoff.from_stage).toBe('screening'); // lowest conv among reached>=3
    expect(out.headline.biggest_dropoff.conversion_pct).toBe(66.7);
  });
});

describe('archived deals — historical reach yes, current/aging/live no', () => {
  const deals = [
    { id: 'E', name: 'Echo', stage: 'underwriting', created_at: '2026-01-01T00:00:00Z', is_archived: true },
    { id: 'F', name: 'Foxtrot', stage: 'screening', created_at: '2026-06-01T00:00:00Z', is_archived: false },
  ];
  const events = new Map([
    ['E', [
      ev('E', 'sourced', 'screening', '2026-01-05T00:00:00Z'),
      ev('E', 'screening', 'site_visit', '2026-01-10T00:00:00Z'),
      ev('E', 'site_visit', 'loi', '2026-01-15T00:00:00Z'),
      ev('E', 'loi', 'due_diligence', '2026-01-20T00:00:00Z'),
      ev('E', 'due_diligence', 'underwriting', '2026-01-25T00:00:00Z'),
    ]],
  ]);
  const r = composePipelineVelocity(deals, events, ASOF);

  test('an archived deal still counts toward historical funnel reach', () => {
    expect(stage(r.funnel, 'stage', 'underwriting').reached).toBe(1); // E
    expect(stage(r.funnel, 'stage', 'screening').reached).toBe(2); // E + F
  });

  test('an archived deal is excluded from current distribution / aging / live count', () => {
    expect(stage(r.funnel, 'stage', 'underwriting').current).toBe(0); // E archived
    expect(stage(r.funnel, 'stage', 'screening').current).toBe(1); // only F is live
    expect(r.aging.some((a) => a.deal_id === 'E')).toBe(false);
    expect(r.headline.live_deals).toBe(1); // only F
    expect(r.headline.total_deals).toBe(2); // both analysed historically
  });
});

describe('empty + migration-tolerant', () => {
  test('no deals → valid zeroed payload, never a throw', () => {
    const empty = composePipelineVelocity([], new Map(), ASOF);
    expect(empty.headline.total_deals).toBe(0);
    expect(empty.funnel.every((f) => f.reached === 0)).toBe(true);
    expect(empty.aging).toEqual([]);
    expect(empty.throughput).toHaveLength(6);
  });
});
