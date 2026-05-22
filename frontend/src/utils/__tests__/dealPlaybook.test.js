import { describe, it, expect } from 'vitest';
import { buildPlaybook, STAGE_PLAYBOOK } from '../dealPlaybook';

describe('buildPlaybook', () => {
  it('returns null when the deal has no usable stage', () => {
    expect(buildPlaybook(null)).toBeNull();
    expect(buildPlaybook({})).toBeNull();
    expect(buildPlaybook({ stage: 'not_a_stage' })).toBeNull();
  });

  it('a bare sourced deal has every step pending and 0% progress', () => {
    const pb = buildPlaybook({ stage: 'sourced' });
    expect(pb.stage).toBe('sourced');
    expect(pb.total).toBe(STAGE_PLAYBOOK.sourced.length);
    expect(pb.done).toBe(0);
    expect(pb.pct).toBe(0);
    expect(pb.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('a fully-captured sourced deal has every step done at 100%', () => {
    const pb = buildPlaybook({
      stage: 'sourced',
      land_ask_price_cr: 18,
      land_area_sqft: 50000,
      asset_class: 'plotted_development',
      deal_structure: 'outright',
      property_id: 'prop-1',
      readiness_summary: { document_count: 3 },
    });
    expect(pb.done).toBe(pb.total);
    expect(pb.pct).toBe(100);
    expect(pb.steps.find((s) => s.id === 'first_docs').detail).toMatch(/3 on file/);
  });

  it('grades a due_diligence deal from its readiness rollup', () => {
    const pb = buildPlaybook({
      stage: 'due_diligence',
      readiness_summary: {
        dd_completion_pct: 95,
        pending_deal_breakers: 2,
        approval_completion_pct: 40,
        document_count: 6,
      },
    });
    const byId = Object.fromEntries(pb.steps.map((s) => [s.id, s]));
    expect(byId.dd_progress.status).toBe('done'); // 95 >= 90
    expect(byId.deal_breakers.status).toBe('pending');
    expect(byId.deal_breakers.detail).toMatch(/2 unresolved/);
    expect(byId.approvals.status).toBe('pending'); // 40 < 90
    expect(byId.approvals.detail).toMatch(/40% validated/);
    expect(byId.docs.status).toBe('done');
  });

  it('marks the IC step done only at Investor-Grade readiness', () => {
    const notReady = buildPlaybook({
      stage: 'ic_review',
      readiness_summary: { status: 'work_in_progress', readiness_pct: 70 },
    });
    const icStep = (pb) => pb.steps.find((s) => s.id === 'ic_ready');
    expect(icStep(notReady).status).toBe('pending');
    expect(icStep(notReady).detail).toMatch(/70% ready/);

    const ready = buildPlaybook({
      stage: 'ic_review',
      readiness_summary: { status: 'ic_ready' },
    });
    expect(icStep(ready).status).toBe('done');
  });

  it('detects a site-visit activity by its type', () => {
    const pb = buildPlaybook({
      stage: 'site_visit',
      recent_activities: [{ activity_type: 'site_visit' }],
    });
    expect(pb.steps.find((s) => s.id === 'visit_logged').status).toBe('done');
  });

  it('flags terminal stages', () => {
    expect(buildPlaybook({ stage: 'closed' }).terminal).toBe(true);
    expect(buildPlaybook({ stage: 'dead' }).terminal).toBe(true);
    expect(buildPlaybook({ stage: 'underwriting' }).terminal).toBe(false);
  });

  it('never throws on a malformed deal field', () => {
    expect(() =>
      buildPlaybook({ stage: 'due_diligence', readiness_summary: 'not-an-object' }),
    ).not.toThrow();
  });
});
