'use strict';

/**
 * Tests for aiMarketContext.service.js (PR-NX67).
 *
 * Mocks the AI router + provider registry so tests run synchronously without
 * hitting Claude or OpenAI. Asserts:
 *   - Envelope shape per section.
 *   - English-only enforcement.
 *   - Cascade behavior (Claude primary → OpenAI fallback → unavailable).
 *   - Defensive payload checks (no locality / city → unavailable).
 *   - Env-flag kill switch (AI_MARKET_CONTEXT_ENABLED=false).
 *   - generateAllSections returns all 5 sections in one envelope.
 *   - Unknown sections rejected.
 */

jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(() => ({ claude: true, gpt_compatible: true, gemini: false })),
}));
jest.mock('../src/services/ai/aiRouter', () => ({
  runAI: jest.fn(),
}));

const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
const { runAI } = require('../src/services/ai/aiRouter');

const aiMarketContext = require('../src/services/aiMarketContext.service');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AI_MARKET_CONTEXT_ENABLED;
  getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true, gemini: false });
});

const stubAIResponse = (jsonObject) => ({
  result: JSON.stringify(jsonObject),
});

describe('aiMarketContext.service · scoping + kill switch', () => {
  test('returns unavailable when AI_MARKET_CONTEXT_ENABLED=false', async () => {
    process.env.AI_MARKET_CONTEXT_ENABLED = 'false';
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { locality: 'Jigani', city: 'Bengaluru', asset_class: 'residential_apartments' },
    });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/AI_MARKET_CONTEXT_ENABLED=false/);
    expect(runAI).not.toHaveBeenCalled();
  });

  test('returns unavailable on unknown section', async () => {
    const out = await aiMarketContext.generateSection({
      section: 'notARealSection',
      payload: { locality: 'Whitefield', city: 'Bengaluru' },
    });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/Unknown section/);
  });

  test('returns unavailable when payload has no locality / city / property_name (no anchor)', async () => {
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { asset_class: 'residential_apartments' },
    });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/locality.*city.*property name/);
    expect(runAI).not.toHaveBeenCalled();
  });

  test('returns unavailable when no providers configured', async () => {
    getProviderAvailability.mockReturnValue({ claude: false, gpt_compatible: false });
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { locality: 'Jigani', city: 'Bengaluru' },
    });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/Neither Claude nor OpenAI/);
  });
});

describe('aiMarketContext.service · whyThisArea envelope', () => {
  test('returns paragraphs + summary + dataQuality on Claude success', async () => {
    runAI.mockResolvedValueOnce(stubAIResponse({
      paragraphs: [
        'Whitefield is Bengaluru\'s eastern IT corridor anchor.',
        'Demand drivers include ITPL / EPIP tech-park employment and corporate housing absorption.',
        'Risk overlay: monsoon flooding remains a recurring infrastructure issue.',
      ],
      summary: 'Established tech-corridor with deep workforce catchment but pre-monsoon infrastructure risk.',
      data_quality: 'specific',
    }));
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { locality: 'Whitefield', city: 'Bengaluru', asset_class: 'residential_apartments' },
    });
    expect(out.available).toBe(true);
    expect(out.section).toBe('whyThisArea');
    expect(out.tier).toBe('augment');
    expect(out.paragraphs).toHaveLength(3);
    expect(out.summary).toMatch(/tech-corridor/);
    expect(out.dataQuality).toBe('specific');
    expect(out.confidence).toBe('medium'); // never "high" — augment is always second-source
    expect(out.provider).toBe('claude');
    expect(out.disclaimer).toMatch(/AI-GENERATED FROM GENERAL KNOWLEDGE/);
  });

  test('caps paragraphs at 3 (schema bound)', async () => {
    runAI.mockResolvedValueOnce(stubAIResponse({
      paragraphs: ['p1', 'p2', 'p3', 'p4', 'p5'],
      summary: 's',
      data_quality: 'general',
    }));
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { locality: 'X', city: 'Y' },
    });
    expect(out.paragraphs).toHaveLength(3);
  });
});

describe('aiMarketContext.service · demographics envelope', () => {
  test('returns paragraph + dataQuality on Claude success', async () => {
    runAI.mockResolvedValueOnce(stubAIResponse({
      paragraph: 'Whitefield skews young tech professional with upper-middle-income skew. Family demand strong.',
      data_quality: 'specific',
    }));
    const out = await aiMarketContext.generateSection({
      section: 'demographics',
      payload: { locality: 'Whitefield', city: 'Bengaluru', asset_class: 'residential_apartments' },
    });
    expect(out.available).toBe(true);
    expect(out.paragraph).toMatch(/Whitefield skews young tech/);
    expect(out.dataQuality).toBe('specific');
  });
});

describe('aiMarketContext.service · jobGrowth envelope', () => {
  test('returns paragraphs + bullets', async () => {
    runAI.mockResolvedValueOnce(stubAIResponse({
      paragraphs: ['Whitefield is a deep IT-employment node.'],
      bullets: [
        'ITPL — anchor IT park, 30,000+ professionals',
        'EPIP — export-promotion zone with MNC cluster',
        'Manyata-equivalent GCC presence',
      ],
      data_quality: 'specific',
    }));
    const out = await aiMarketContext.generateSection({
      section: 'jobGrowth',
      payload: { locality: 'Whitefield', city: 'Bengaluru', asset_class: 'commercial_office' },
    });
    expect(out.available).toBe(true);
    expect(Array.isArray(out.paragraphs)).toBe(true);
    expect(out.bullets).toHaveLength(3);
  });
});

describe('aiMarketContext.service · socialInfrastructure envelope', () => {
  test('coerces all 6 buckets with allowed presence values', async () => {
    runAI.mockResolvedValueOnce(stubAIResponse({
      buckets: {
        schools: { presence: 'strong', named_examples: ['Inventure', 'TISB'], notes: 'Top-tier IB schools nearby' },
        hospitals: { presence: 'strong', named_examples: ['Manipal', 'Vydehi'], notes: '' },
        retail: { presence: 'strong', named_examples: ['Phoenix Marketcity'], notes: '' },
        transit: { presence: 'adequate', named_examples: ['Purple Line metro'], notes: 'Metro Phase 2 opening 2026' },
        airport: { presence: 'thin', named_examples: [], notes: '~45 km via ORR' },
        expressway: { presence: 'adequate', named_examples: ['ORR'], notes: '' },
      },
      data_quality: 'specific',
    }));
    const out = await aiMarketContext.generateSection({
      section: 'socialInfrastructure',
      payload: { locality: 'Whitefield', city: 'Bengaluru', asset_class: 'residential_apartments' },
    });
    expect(out.available).toBe(true);
    expect(Object.keys(out.buckets).sort()).toEqual(['airport', 'expressway', 'hospitals', 'retail', 'schools', 'transit']);
    expect(out.buckets.schools.presence).toBe('strong');
    expect(out.buckets.schools.named_examples).toEqual(['Inventure', 'TISB']);
    expect(out.buckets.airport.presence).toBe('thin');
  });

  test('coerces invalid presence values to "unknown"', async () => {
    runAI.mockResolvedValueOnce(stubAIResponse({
      buckets: {
        schools: { presence: 'EXCELLENT', named_examples: [], notes: '' }, // not in allowed set
      },
      data_quality: 'unknown',
    }));
    const out = await aiMarketContext.generateSection({
      section: 'socialInfrastructure',
      payload: { locality: 'X', city: 'Y' },
    });
    expect(out.buckets.schools.presence).toBe('unknown');
  });
});

describe('aiMarketContext.service · supplyDemandPipeline envelope', () => {
  test('returns paragraphs + caution', async () => {
    runAI.mockResolvedValueOnce(stubAIResponse({
      paragraphs: ['Active launch corridor in the ₹1.5 Cr resi band.'],
      caution: 'Heavy supply in mid-segment may compress pricing power.',
      data_quality: 'general',
    }));
    const out = await aiMarketContext.generateSection({
      section: 'supplyDemandPipeline',
      payload: { locality: 'Whitefield', city: 'Bengaluru', asset_class: 'residential_apartments' },
    });
    expect(out.available).toBe(true);
    expect(out.paragraphs).toHaveLength(1);
    expect(out.caution).toMatch(/Heavy supply/);
  });
});

describe('aiMarketContext.service · cascade + failover', () => {
  test('falls back to OpenAI when Claude fails', async () => {
    runAI
      .mockRejectedValueOnce(new Error('Claude rate-limited'))
      .mockResolvedValueOnce(stubAIResponse({
        paragraphs: ['Backup synthesis from OpenAI.'],
        summary: 's',
        data_quality: 'general',
      }));
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { locality: 'Jigani', city: 'Bengaluru' },
    });
    expect(out.available).toBe(true);
    expect(out.provider).toBe('openai');
    expect(out.fallbackReason).toMatch(/Claude.*rate-limited.*auto-failover.*openai/);
  });

  test('returns unavailable when both providers fail', async () => {
    runAI
      .mockRejectedValueOnce(new Error('Claude 503'))
      .mockRejectedValueOnce(new Error('OpenAI 503'));
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { locality: 'Jigani', city: 'Bengaluru' },
    });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/All providers failed.*Claude 503.*OpenAI 503/);
  });

  test('rejects non-English output (defense-in-depth)', async () => {
    runAI.mockResolvedValueOnce({ result: '{"paragraphs": ["जिगनी एक उभरता हुआ क्षेत्र है"], "summary": "s", "data_quality": "general"}' });
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { locality: 'Jigani', city: 'Bengaluru' },
    });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/non-English/);
  });

  test('returns unavailable on unparseable model output', async () => {
    runAI.mockResolvedValueOnce({ result: 'not json at all here' });
    const out = await aiMarketContext.generateSection({
      section: 'whyThisArea',
      payload: { locality: 'Jigani', city: 'Bengaluru' },
    });
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/unparseable/);
  });
});

describe('aiMarketContext.service · generateAllSections', () => {
  test('returns all 5 sections in one envelope, each independently catched', async () => {
    // First call (whyThisArea) succeeds, others all fail.
    runAI
      .mockResolvedValueOnce(stubAIResponse({ paragraphs: ['ok'], summary: 's', data_quality: 'general' }))
      .mockRejectedValue(new Error('any error'));
    const out = await aiMarketContext.generateAllSections({
      payload: { locality: 'Jigani', city: 'Bengaluru', asset_class: 'residential_apartments' },
    });
    expect(Object.keys(out).sort()).toEqual([
      'demographics',
      'jobGrowth',
      'socialInfrastructure',
      'supplyDemandPipeline',
      'whyThisArea',
    ]);
    expect(out.whyThisArea.available).toBe(true);
    // Others may be available:false from the cascade; what matters is they don't throw.
  });

  test('whole envelope returns even when payload is missing locality (each section short-circuits)', async () => {
    const out = await aiMarketContext.generateAllSections({
      payload: { asset_class: 'commercial_office' }, // no locality / city
    });
    expect(Object.keys(out).length).toBe(5);
    Object.values(out).forEach((env) => {
      expect(env.available).toBe(false);
    });
    expect(runAI).not.toHaveBeenCalled();
  });
});
