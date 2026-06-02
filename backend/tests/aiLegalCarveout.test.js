'use strict';

// CLAUDE.md hard rule: AI must never assert/narrate the four legal lanes
// (title chain, encumbrance, RERA registration, statutory approvals). The
// IC-opinion payload used to hand the model a `rera_registered` boolean, and
// the prompt only banned *inventing* legal status — not narrating one it was
// handed (audit 2026-06-01, P2).
const { buildPayload, SYSTEM_PROMPT } = require('../src/services/export.insights.service');

describe('IC-opinion AI — legal-lane carve-out', () => {
  test('buildPayload never hands the model a RERA registration status', () => {
    const payload = buildPayload({
      deal: {
        name: 'Whitefield Tower',
        asset_class: 'commercial_office',
        rera_number: 'PRM/KA/RERA/1251/446/PR/123',
      },
      ddCounts: {},
      riskCounts: {},
      financials: null,
      benchmarks: [],
      topRiskFlags: [],
      topDdItems: [],
      cashFlowSummary: null,
    });
    expect(payload.deal).not.toHaveProperty('rera_registered');
    // Nothing RERA-shaped should reach the model from the deal block.
    expect(JSON.stringify(payload)).not.toMatch(/rera/i);
  });

  test('SYSTEM_PROMPT forbids narrating the legal lanes, not only inventing them', () => {
    expect(SYSTEM_PROMPT).toMatch(/never assert or narrate/i);
    expect(SYSTEM_PROMPT).toMatch(/RERA/);
    expect(SYSTEM_PROMPT).toMatch(/title|encumbrance/i);
  });
});
