'use strict';

const { sanitizeAiProse, LEGAL_REDACTION_MARKER } = require('../src/utils/aiLegalProseGuard');

describe('aiLegalProseGuard.sanitizeAiProse — legal-four + absolute-verb backstop', () => {
  test('strips a "title is clear" verdict, keeps the rest', () => {
    const r = sanitizeAiProse('The site is well located. Title is clear and unencumbered. IRR is 18%.');
    expect(r.legalRemoved).toBe(1);
    expect(r.flagged).toBe(true);
    expect(r.text).toContain(LEGAL_REDACTION_MARKER);
    expect(r.text).not.toMatch(/title is clear/i);
    expect(r.text).toContain('well located');
    expect(r.text).toContain('IRR is 18%');
  });

  test('strips RERA-compliant and "approval will be granted" assertions', () => {
    const r = sanitizeAiProse('The project is RERA-compliant. Approval will be granted shortly.');
    expect(r.legalRemoved).toBe(2);
    expect(r.text).not.toMatch(/RERA-compliant/i);
    expect(r.text).not.toMatch(/approval will be granted/i);
  });

  test('rewrites a sentence-leading absolute IC stance verb to the dictionary', () => {
    const r = sanitizeAiProse('Approve the deal at the asking price.');
    expect(r.stanceRewritten).toBe(true);
    expect(r.flagged).toBe(true);
    expect(r.text).not.toMatch(/\bApprove\b/);
    expect(r.text).toMatch(/Proceed/);
  });

  test('passes clean institutional prose through unchanged', () => {
    const clean = 'Land cost is 28% of GDV, above the 25% Bengaluru target. Base-case IRR is 16.4%.';
    const r = sanitizeAiProse(clean);
    expect(r.flagged).toBe(false);
    expect(r.legalRemoved).toBe(0);
    expect(r.stanceRewritten).toBe(false);
    expect(r.text).toBe(clean);
  });

  test('does not strip the legitimate "clear title chain" diligence phrasing', () => {
    const r = sanitizeAiProse('Confirm a clear title chain during diligence.');
    expect(r.legalRemoved).toBe(0);
    expect(r.text).toContain('clear title chain');
  });

  test('empty / non-string input is safe', () => {
    expect(sanitizeAiProse('').flagged).toBe(false);
    expect(sanitizeAiProse(null).flagged).toBe(false);
    expect(sanitizeAiProse(undefined).flagged).toBe(false);
  });
});
