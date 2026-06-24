'use strict';

/**
 * Legal-four + closed-verb backstop on the customer-facing IC / doc-insights
 * envelopes (correctness audit 2026-06-23, #7/#8).
 *
 * `coerceInsightsEnvelope` (Executive-Summary IC opinion + top_risks + next_steps)
 * and `coerceDocInsightsEnvelope` (cross-document findings) both feed the customer
 * DOCX. Before this wiring they ran only `neutralizeStanceText` (absolute verbs)
 * on SOME fields — top_risks / next_steps were unguarded entirely, and neither
 * coercer stripped a narrated statutory verdict ("title is clear", "RERA-
 * compliant", "approval will be granted"), one of CLAUDE.md's four legal lanes.
 *
 * Both now route every AI string through the shared `sanitizeAiProse`. The util
 * itself is unit-tested in aiLegalProseGuard.test.js; here we assert the
 * envelopes actually CALL it on every customer-facing field.
 */

const {
  coerceInsightsEnvelope,
  coerceDocInsightsEnvelope,
} = require('../src/services/export.insights.service');
const { LEGAL_REDACTION_MARKER } = require('../src/utils/aiLegalProseGuard');

describe('export.insights — legal-four guard on customer envelopes', () => {
  describe('coerceInsightsEnvelope (IC opinion / top_risks / next_steps)', () => {
    test('strips a statutory verdict from the IC opinion, keeps the rest', () => {
      const env = coerceInsightsEnvelope({
        ic_opinion: 'The deal screens well. Title is clear and unencumbered.',
        confidence: 'high',
      });
      expect(env.ic_opinion).toContain(LEGAL_REDACTION_MARKER);
      expect(env.ic_opinion).not.toMatch(/title is clear/i);
      expect(env.ic_opinion).toContain('screens well');
    });

    test('scrubs a legal verdict inside top_risks detail (previously unguarded)', () => {
      const env = coerceInsightsEnvelope({
        top_risks: [{ title: 'RERA status', detail: 'The project is RERA-compliant.' }],
        confidence: 'medium',
      });
      expect(env.top_risks[0].detail).not.toMatch(/RERA-compliant/i);
      expect(env.top_risks[0].detail).toContain(LEGAL_REDACTION_MARKER);
      expect(env.top_risks[0].title).toBe('RERA status');
    });

    test('scrubs a statutory assertion inside a next_step (previously unguarded)', () => {
      const env = coerceInsightsEnvelope({
        next_steps: ['Confirm pricing since approval will be granted shortly.'],
        confidence: 'low',
      });
      expect(env.next_steps[0]).not.toMatch(/approval will be granted/i);
    });

    test('rewrites an absolute IC verb leading the opinion', () => {
      const env = coerceInsightsEnvelope({ ic_opinion: 'Approve the deal at the asking price.' });
      expect(env.ic_opinion).not.toMatch(/\bApprove\b/);
    });

    test('passes clean institutional prose through unchanged', () => {
      const clean = 'Land cost is 28% of GDV, above the 25% Bengaluru target.';
      const env = coerceInsightsEnvelope({ ic_opinion: clean, confidence: 'high' });
      expect(env.ic_opinion).toBe(clean);
    });
  });

  describe('coerceDocInsightsEnvelope (cross-document findings)', () => {
    test('scrubs statutory verdicts + absolute verbs across summary and finding fields', () => {
      const env = coerceDocInsightsEnvelope({
        summary_paragraph: 'Documents are consistent. Title is clear and unencumbered.',
        findings: [
          {
            title: 'Title chain',
            description: 'The project is RERA-compliant.',
            recommendation: 'Approve the khata transfer.',
            severity: 'high',
          },
        ],
        confidence: 'medium',
      });
      expect(env.summary_paragraph).not.toMatch(/title is clear/i);
      expect(env.summary_paragraph).toContain(LEGAL_REDACTION_MARKER);
      expect(env.findings[0].description).not.toMatch(/RERA-compliant/i);
      expect(env.findings[0].recommendation).not.toMatch(/\bApprove\b/);
      // Non-prose fields are untouched.
      expect(env.findings[0].severity).toBe('high');
    });
  });
});
