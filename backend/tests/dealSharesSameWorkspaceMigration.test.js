'use strict';

/**
 * Static pins for database/migrations/20260806_deal_shares_same_workspace.sql.
 *
 * The nine `*_shared_read` policies punched through organisation scope on
 * deals, properties, documents, dd_items, approval_items, risk_flags,
 * activities, financials and deal_stage_history. They were correct in April
 * 2026, when the header of the migration that created them says every user had
 * their own workspace ("1:1 user:org mapping") and sharing was the only way two
 * humans could see one deal. Real multi-tenancy has since shipped, so
 * `deals_org_scope` already grants every member of a workspace full access —
 * leaving those nine as pure cross-tenant surface.
 *
 * If one of them is ever recreated, this test is the tripwire.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.resolve(
  __dirname, '..', '..', 'database', 'migrations', '20260806_deal_shares_same_workspace.sql',
);
const sql = fs.readFileSync(MIGRATION, 'utf8');
const executable = sql.replace(/^--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const SHARED_READ_POLICIES = [
  ['deals_shared_read', 'deals'],
  ['properties_shared_read', 'properties'],
  ['documents_shared_read', 'documents'],
  ['dd_items_shared_read', 'dd_items'],
  ['approval_items_shared_read', 'approval_items'],
  ['risk_flags_shared_read', 'risk_flags'],
  ['activities_shared_read', 'activities'],
  ['financials_shared_read', 'financials'],
  ['deal_stage_history_shared_read', 'deal_stage_history'],
];

describe('every cross-organisation share policy is dropped', () => {
  test.each(SHARED_READ_POLICIES)('%s is dropped from %s', (policy, table) => {
    expect(executable).toMatch(
      new RegExp(`DROP POLICY IF EXISTS\\s+${policy}\\s+ON\\s+${table};`, 'i'),
    );
  });

  test('all nine are covered — the set matches what 20260416 created', () => {
    const drops = executable.match(/DROP POLICY IF EXISTS/gi) || [];
    expect(drops).toHaveLength(SHARED_READ_POLICIES.length);
  });
});

describe('the sharing feature itself survives', () => {
  test('deal_shares and its own access policy are left alone', () => {
    // The table still records who a deal was pointed at; only the cross-org
    // read grant goes. Dropping deal_shares_access would break the feature.
    expect(executable).not.toMatch(/DROP\s+TABLE[\s\S]*deal_shares/i);
    expect(executable).not.toMatch(/DROP POLICY[\s\S]*deal_shares_access/i);
  });

  test('no policy is recreated — this migration only removes', () => {
    expect(executable).not.toMatch(/CREATE POLICY/i);
  });
});

describe('operational shape', () => {
  test('is wrapped in an explicit transaction and uses no CONCURRENTLY', () => {
    expect(executable).toMatch(/^\s*BEGIN;/m);
    expect(executable).toMatch(/^\s*COMMIT;/m);
    expect(executable).not.toMatch(/CONCURRENTLY/i);
  });

  test('ends with a verification query the operator can read as proof', () => {
    expect(executable).toMatch(/cross_org_share_policies_left/);
    expect(executable).toMatch(/cross_workspace_shares_remaining/);
  });

  test('the rollback is labelled as restoring the vulnerability, not as routine', () => {
    expect(sql).toMatch(/break-glass, not routine/i);
  });
});
