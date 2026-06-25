'use strict';

// Audit #9/#21 — customer-export IC-opinion gate. A LOW-confidence AI opinion is
// withheld from customer-facing exports (gate, not label); medium/high render
// with their confidence label; a missing opinion is reported as unavailable.
// resolveCustomerIcOpinion is the single policy the DOCX renderer consumes.

const { resolveCustomerIcOpinion } = require('../src/services/export.insights.service');

describe('resolveCustomerIcOpinion — customer-export IC-opinion display policy', () => {
  const OPINION = 'Recommend proceeding subject to conditions. IRR 21% and 2.1x equity multiple are strong; title diligence is incomplete.';

  test('LOW confidence → withheld (opinion text is NOT exposed)', () => {
    const r = resolveCustomerIcOpinion({ available: true, ic_opinion: OPINION, confidence: 'low' });
    expect(r.mode).toBe('withheld');
    expect(r.text).toBeNull();
    expect(r.confidence).toBe('low');
  });

  test('MEDIUM confidence → render with the opinion + label', () => {
    const r = resolveCustomerIcOpinion({ available: true, ic_opinion: OPINION, confidence: 'medium' });
    expect(r.mode).toBe('render');
    expect(r.text).toBe(OPINION);
    expect(r.confidence).toBe('medium');
  });

  test('HIGH confidence → render', () => {
    const r = resolveCustomerIcOpinion({ available: true, ic_opinion: OPINION, confidence: 'high' });
    expect(r.mode).toBe('render');
    expect(r.text).toBe(OPINION);
  });

  test('no opinion (provider failed) → unavailable, with reason passed through', () => {
    const r = resolveCustomerIcOpinion({ available: false, ic_opinion: null, confidence: null, reason: 'Claude 429 rate limit; OpenAI not configured' });
    expect(r.mode).toBe('unavailable');
    expect(r.text).toBeNull();
    expect(r.reason).toMatch(/rate limit/);
  });

  test('empty / whitespace opinion → unavailable (never renders a blank stance)', () => {
    expect(resolveCustomerIcOpinion({ ic_opinion: '   ', confidence: 'high' }).mode).toBe('unavailable');
    expect(resolveCustomerIcOpinion({ ic_opinion: '', confidence: 'medium' }).mode).toBe('unavailable');
  });

  test('null / undefined envelope → unavailable (no throw)', () => {
    expect(resolveCustomerIcOpinion(null).mode).toBe('unavailable');
    expect(resolveCustomerIcOpinion(undefined).mode).toBe('unavailable');
  });

  test('a low-confidence opinion is withheld even though the text exists (the bug this closes)', () => {
    // Pre-fix the DOCX printed the opinion + "Confidence: low". Assert the policy
    // now suppresses the text so a weak stance cannot reach the customer report.
    const r = resolveCustomerIcOpinion({ ic_opinion: OPINION, confidence: 'low' });
    expect(r.text).toBeNull(); // the stance text never leaves the helper at low confidence
    expect(r.mode).toBe('withheld');
  });
});
