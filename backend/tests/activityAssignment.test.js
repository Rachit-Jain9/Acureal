'use strict';

// Activity assignment (2026-07-09): activities carry an optional assigned_to —
// "who should follow through" — distinct from performed_by (who logged it).
// These tests pin the service contract: the assignee is validated as a visible
// active workspace member (RLS-scoped lookup), persisted on INSERT/UPDATE, and
// surfaced as assigned_to_name.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const activityService = require('../src/services/activity.service');

const DEAL_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNEE_ID = '22222222-2222-4222-8222-222222222222';
const PERFORMER_ID = '33333333-3333-4333-8333-333333333333';

describe('activity assignment', () => {
  beforeEach(() => query.mockReset());

  it('logActivity persists a validated assignee and returns assigned_to_name', async () => {
    query
      // ensureDealExists
      .mockResolvedValueOnce({ rows: [{ id: DEAL_ID }] })
      // resolveAssignee — the RLS-scoped member lookup
      .mockResolvedValueOnce({ rows: [{ id: ASSIGNEE_ID, name: 'Priya' }] })
      // INSERT
      .mockResolvedValueOnce({
        rows: [{ id: 'act-1', deal_id: DEAL_ID, assigned_to: ASSIGNEE_ID }],
      })
      // performer name
      .mockResolvedValueOnce({ rows: [{ name: 'Rachit' }] })
      // deals.updated_at touch
      .mockResolvedValueOnce({ rows: [] });

    const activity = await activityService.logActivity(
      DEAL_ID, 'meeting', 'Site walkthrough with promoter', PERFORMER_ID,
      null, null, false, 'open', 'medium', ASSIGNEE_ID
    );

    // The assignee lookup is parameterised and filters to active users.
    const assigneeCall = query.mock.calls[1];
    expect(assigneeCall[0]).toMatch(/FROM users WHERE id = \$1 AND is_active = TRUE/);
    expect(assigneeCall[1]).toEqual([ASSIGNEE_ID]);

    // INSERT carries assigned_to as the 12th param.
    const insertCall = query.mock.calls[2];
    expect(insertCall[0]).toMatch(/assigned_to/);
    expect(insertCall[1][11]).toBe(ASSIGNEE_ID);

    expect(activity.assigned_to_name).toBe('Priya');
  });

  it('logActivity rejects an assignee who is not a visible active member', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: DEAL_ID }] }) // deal exists
      .mockResolvedValueOnce({ rows: [] });               // assignee invisible (other org / inactive)

    await expect(
      activityService.logActivity(
        DEAL_ID, 'meeting', 'x', PERFORMER_ID,
        null, null, false, 'open', 'medium', ASSIGNEE_ID
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    // Nothing may be inserted after a failed assignee validation.
    const insertAttempted = query.mock.calls.some(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO activities')
    );
    expect(insertAttempted).toBe(false);
  });

  it('logActivity without an assignee inserts NULL and skips the lookup', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: DEAL_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 'act-2', assigned_to: null }] }) // INSERT
      .mockResolvedValueOnce({ rows: [{ name: 'Rachit' }] })
      .mockResolvedValueOnce({ rows: [] });

    const activity = await activityService.logActivity(
      DEAL_ID, 'note', 'Plain log entry', PERFORMER_ID
    );

    const insertCall = query.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO activities/);
    expect(insertCall[1][11]).toBeNull();
    expect(activity.assigned_to_name).toBeNull();
  });

  it('updateActivity clears assignment when assignedTo is empty, keeps it when omitted', async () => {
    const existing = {
      id: 'act-3',
      activity_type: 'meeting',
      description: 'd',
      activity_date: new Date('2026-07-01'),
      next_follow_up: null,
      is_important: false,
      status: 'open',
      priority: 'medium',
      completed_at: null,
      completed_by: null,
      performed_by: PERFORMER_ID,
      assigned_to: ASSIGNEE_ID,
    };

    // Case 1: assignedTo: '' → cleared (UPDATE param 10 is null).
    query
      .mockResolvedValueOnce({ rows: [existing] })                 // ensureActivityEditable
      .mockResolvedValueOnce({ rows: [{ ...existing, assigned_to: null }] }); // UPDATE
    await activityService.updateActivity('act-3', { assignedTo: '' }, PERFORMER_ID, 'admin');
    let updateCall = query.mock.calls.find((c) => c[0].includes('UPDATE activities'));
    expect(updateCall[1][9]).toBeNull();

    // Case 2: assignedTo omitted → existing assignment preserved.
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValueOnce({ rows: [existing] });
    await activityService.updateActivity('act-3', { priority: 'high' }, PERFORMER_ID, 'admin');
    updateCall = query.mock.calls.find((c) => c[0].includes('UPDATE activities'));
    expect(updateCall[1][9]).toBe(ASSIGNEE_ID);
  });
});
