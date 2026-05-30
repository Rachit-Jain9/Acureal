'use strict';

/**
 * Tests for the constrained AI narrator (PR-4).
 *
 * The narrator wraps `aiRouter.runAIWithSchema` with a Zod enum on the verb
 * + length bounds on the prose + a forbidden-phrase guard. We test those
 * three guardrails directly (don't need a live AI call) and verify the
 * orchestrator's interaction with the narrator hook.
 */

// Mock the aiRouter at the require level so the narrator's runAIWithSchema
// call is intercepted without hitting any provider SDK. The `mock` prefix
// on the factory's variable name is the only allowed pattern for referencing
// helpers inside a jest.mock() factory (Jest hoists mocks above imports).
jest.mock('../src/services/ai/aiRouter', () => ({
  __esModule: false,
  runAIWithSchema: jest.fn(),
}));

const aiRouter = require('../src/services/ai/aiRouter');
const {
  narrateCard,
  narrationSchema,
  FORBIDDEN_PHRASES,
  containsForbiddenPhrase,
  buildPrompt,
} = require('../src/services/recommendation/recommendationNarrator');

beforeEach(() => {
  aiRouter.runAIWithSchema.mockReset();
  // Default env: narrator enabled.
  delete process.env.RECOMMENDATION_NARRATOR_ENABLED;
});

// ─────────────────────────────────────────────────────────────────────────────
// Verb dictionary enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('narrationSchema', () => {
  test('accepts every allowed verb', () => {
    for (const verb of ['Recommend', 'Consider', 'Re-examine', 'Flag', 'Stress-test']) {
      const result = narrationSchema.safeParse({
        verb,
        headline: 'A sufficiently long headline string for validation.',
        detail: 'A sufficiently long detail string for validation purposes.',
      });
      expect(result.success).toBe(true);
    }
  });

  test('rejects forbidden absolute verbs', () => {
    for (const verb of ['Buy', 'Reject', 'Approve', 'Decline', 'Clear', 'Pass']) {
      const result = narrationSchema.safeParse({
        verb,
        headline: 'A sufficiently long headline string for validation.',
        detail: 'A sufficiently long detail string for validation purposes.',
      });
      expect(result.success).toBe(false);
    }
  });

  test('rejects too-short headlines / details (cheap hedging)', () => {
    expect(
      narrationSchema.safeParse({
        verb: 'Recommend',
        headline: 'too short',
        detail: 'A sufficiently long detail string for validation purposes.',
      }).success,
    ).toBe(false);
  });

  test('rejects too-long headlines / details (model rant prevention)', () => {
    expect(
      narrationSchema.safeParse({
        verb: 'Recommend',
        headline: 'x'.repeat(300),
        detail: 'A sufficiently long detail string for validation purposes.',
      }).success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Forbidden-phrase guard
// ─────────────────────────────────────────────────────────────────────────────

describe('containsForbiddenPhrase', () => {
  const forbidden = [
    'I highly recommend you buy this deal.',
    'You should not invest in this opportunity.',
    'This title is clear and unencumbered.',
    'The project is RERA-compliant.',
    'This title is fine.',
    'We guarantee strong returns.',
    'guaranteed upside',
    'Definitely a great buy.',
  ];

  for (const text of forbidden) {
    test(`flags "${text}"`, () => {
      expect(containsForbiddenPhrase(text)).toBe(true);
    });
  }

  const allowed = [
    'Recommend re-pricing land or restructuring to revenue-share.',
    'Re-examine the absorption assumption against the verified-comp band.',
    'Flag — saleable area mismatch between the input and the extracted area statement.',
    'Stress-test debt-service coverage at the comp-median absorption rate.',
    'Consider a tighter capital stack — equity multiple is below target.',
  ];
  for (const text of allowed) {
    test(`allows "${text}"`, () => {
      expect(containsForbiddenPhrase(text)).toBe(false);
    });
  }

  test('returns false for non-string input', () => {
    expect(containsForbiddenPhrase(null)).toBe(false);
    expect(containsForbiddenPhrase(undefined)).toBe(false);
    expect(containsForbiddenPhrase(42)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  test('includes the card verb, topic, headline, detail, and evidence', () => {
    const card = {
      id: 'land-cost-share-high',
      verb: 'Recommend',
      topic: 'land_price',
      topic_label: 'Land price',
      severity: 4,
      headline: 'Recommend re-pricing land. Land cost is 38% of GDV.',
      detail: 'Project economics carry an elevated land-cost ratio.',
      evidence: [
        { ref: 'kernel:landCr', label: 'Land cost ₹40 Cr' },
        { ref: 'kernel:revenue', label: 'GDV ₹100 Cr' },
      ],
    };
    const prompt = buildPrompt(card, {
      workspace: { deal: { asset_class: 'residential_apartments', deal_structure: 'jda', stage: 'underwriting' } },
    });
    expect(prompt).toMatch(/Recommend/);
    expect(prompt).toMatch(/Land price/);
    expect(prompt).toMatch(/land cost is 38% of GDV/i);
    expect(prompt).toMatch(/residential_apartments/);
    expect(prompt).toMatch(/jda/);
    expect(prompt).toMatch(/Land cost ₹40 Cr/);
    expect(prompt).toMatch(/kernel:landCr/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// narrateCard — orchestration
// ─────────────────────────────────────────────────────────────────────────────

const makeCard = (overrides = {}) => ({
  id: 'land-cost-share-high',
  verb: 'Recommend',
  topic: 'land_price',
  topic_label: 'Land price',
  severity: 4,
  headline: 'Recommend re-pricing land. Land cost is 38.0% of GDV.',
  detail: 'Project economics carry an elevated land-cost ratio.',
  ai_narratable: true,
  evidence: [{ ref: 'kernel:landCr', label: 'Land cost ₹40 Cr' }],
  signals: ['land_cost_share_of_gdv'],
  ...overrides,
});

describe('narrateCard', () => {
  test('returns null for legal-carve-out cards without calling the AI', async () => {
    const card = makeCard({ ai_narratable: false, topic: 'legal_rera' });
    const out = await narrateCard(card);
    expect(out).toBeNull();
    expect(aiRouter.runAIWithSchema).not.toHaveBeenCalled();
  });

  test('returns null when narration is disabled by env flag', async () => {
    process.env.RECOMMENDATION_NARRATOR_ENABLED = 'false';
    const card = makeCard();
    const out = await narrateCard(card);
    expect(out).toBeNull();
    expect(aiRouter.runAIWithSchema).not.toHaveBeenCalled();
  });

  test('returns the narrated headline + detail on success', async () => {
    aiRouter.runAIWithSchema.mockResolvedValueOnce({
      result: {
        verb: 'Recommend',
        headline: 'Recommend re-pricing the land — current quote pushes land share of GDV above 38%, well above the 30% target.',
        detail: 'Alternative deal structures (revenue-share capped, area-share with corpus) preserve developer IRR without a renegotiation.',
      },
      callId: 'ai-call-1',
    });
    const out = await narrateCard(makeCard());
    expect(out).not.toBeNull();
    expect(out.headline).toMatch(/Recommend re-pricing the land/);
    expect(out.detail).toMatch(/alternative deal structures/i);
  });

  test('rejects when the model returns a different verb than the candidate', async () => {
    aiRouter.runAIWithSchema.mockResolvedValueOnce({
      result: {
        verb: 'Consider', // candidate is 'Recommend' — must reject
        headline: 'Consider re-pricing the land or restructuring the deal terms before proceeding to IC.',
        detail: 'A few alternative deal structures could preserve developer IRR without a price renegotiation.',
      },
      callId: 'ai-call-2',
    });
    const out = await narrateCard(makeCard());
    expect(out).toBeNull();
  });

  test('rejects when the narration contains a forbidden phrase', async () => {
    aiRouter.runAIWithSchema.mockResolvedValueOnce({
      result: {
        verb: 'Recommend',
        headline: 'We guarantee strong returns if you re-price the land before underwriting.',
        detail: 'A few alternative deal structures could preserve developer IRR without a renegotiation.',
      },
      callId: 'ai-call-3',
    });
    const out = await narrateCard(makeCard());
    expect(out).toBeNull();
  });

  test('rejects when the narration asserts a legal conclusion (forbidden across topics)', async () => {
    aiRouter.runAIWithSchema.mockResolvedValueOnce({
      result: {
        verb: 'Recommend',
        headline: 'Recommend re-pricing the land — title is clear and the structure is straightforward.',
        detail: 'A few alternative deal structures could preserve developer IRR without a price renegotiation.',
      },
      callId: 'ai-call-4',
    });
    const out = await narrateCard(makeCard());
    expect(out).toBeNull();
  });

  test('returns null when the AI router throws — never cascades', async () => {
    aiRouter.runAIWithSchema.mockRejectedValueOnce(new Error('boom'));
    const out = await narrateCard(makeCard());
    expect(out).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Response-cache gating — narration of an unchanged card must be keyed so the
// router can serve a cache hit (no SDK round-trip) on a deal revisit. This is
// what keeps AI off the hot deal-workspace read path for the common case.
// ─────────────────────────────────────────────────────────────────────────────

describe('narrateCard — response cache descriptor', () => {
  const okResult = {
    result: {
      verb: 'Recommend',
      headline: 'Recommend re-pricing the land — current quote pushes land share of GDV above 38%, well above target.',
      detail: 'Alternative deal structures (revenue-share capped, area-share with corpus) preserve developer IRR here.',
    },
    callId: 'ai-call-cache',
  };

  test('passes a content-addressed cache descriptor to the router', async () => {
    aiRouter.runAIWithSchema.mockResolvedValueOnce(okResult);
    await narrateCard(makeCard());
    expect(aiRouter.runAIWithSchema).toHaveBeenCalledTimes(1);
    const { cache } = aiRouter.runAIWithSchema.mock.calls[0][0];
    expect(cache).toBeTruthy();
    expect(typeof cache.inputSha256).toBe('string');
    expect(cache.inputSha256).toHaveLength(64); // sha256 hex digest
    expect(typeof cache.promptSha256).toBe('string');
    expect(cache.promptVersion).toBeTruthy();
  });

  test('unchanged card → identical key (cache hit); changed content → new key (re-narrate)', async () => {
    aiRouter.runAIWithSchema.mockResolvedValue(okResult);
    await narrateCard(makeCard());
    await narrateCard(makeCard()); // byte-identical card + context
    await narrateCard(
      makeCard({ headline: 'Recommend a distinctly different action for this materially different card.' }),
      { workspace: { deal: { asset_class: 'commercial_office', deal_structure: 'outright', stage: 'sourcing' } } },
    );

    const keyA = aiRouter.runAIWithSchema.mock.calls[0][0].cache.inputSha256;
    const keyB = aiRouter.runAIWithSchema.mock.calls[1][0].cache.inputSha256;
    const keyC = aiRouter.runAIWithSchema.mock.calls[2][0].cache.inputSha256;
    expect(keyA).toBe(keyB); // same input → same key → router returns the cached narration
    expect(keyC).not.toBe(keyA); // changed input → different key → fresh narration
  });
});
