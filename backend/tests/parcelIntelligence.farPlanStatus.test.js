'use strict';

// Regulatory-credibility guard (2026-06-25). The served FAR-rule query
// (loadFarRules in parcelIntelligence.service.js) must only serve rules whose
// plan is currently IN FORCE. In production, `regulatory_data.far_rules` holds
// rows that are review_status='approved' yet belong to a WITHDRAWN plan (the old
// "RMP 2031 Draft" rows). Serving those as authoritative FAR is a credibility
// defect, so the query must exclude any non-operative plan_status.
//
// loadFarRules is module-internal, and the only other far_rules SELECT in the
// codebase is the admin review queue (a DIFFERENT file) which intentionally
// shows every status — so we assert on the served query's source here.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'parcelIntelligence.service.js'),
  'utf8',
);

describe('FAR rule serving excludes non-operative plans (regulatory credibility)', () => {
  // Isolate the loadFarRules SELECT: FROM regulatory_data.far_rules fr ... ORDER BY ...
  const match = SRC.match(/FROM regulatory_data\.far_rules fr[\s\S]*?ORDER BY[^`]*/);

  test('the served far_rules query exists and is the one we guard', () => {
    expect(match).toBeTruthy();
    expect(match[0]).toMatch(/review_status = 'approved'/);
  });

  test('it excludes withdrawn / superseded / draft plans', () => {
    const servedQuery = match[0];
    expect(servedQuery).toMatch(/plan_status/i);
    expect(servedQuery).toMatch(/'withdrawn'/);
    // COALESCE NULL -> 'operative' keeps org-authored manual rules (which carry
    // no plan_status) servable while excluding withdrawn/superseded/draft.
    expect(servedQuery).toMatch(/COALESCE\(fr\.plan_status,\s*'operative'\)/);
  });
});
