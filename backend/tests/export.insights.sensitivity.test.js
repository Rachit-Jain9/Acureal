'use strict';

// PR-NX44 (2026-05-18) — Sensitivity narrative tests.
//
// Tests the OpenAI-primary cascade for the new generateSensitivityNarrative
// function, the no-op fast paths for sparse grids, and the shape contract.

jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(),
}));

jest.mock('../src/services/ai/aiRouter', () => ({
  runClaudeReasoning: jest.fn(),
  runAI: jest.fn(),
}));

const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
const { runClaudeReasoning, runAI } = require('../src/services/ai/aiRouter');
const { generateSensitivityNarrative } = require('../src/services/export.insights.service');

const fullMatrix = () => ({
  // 5×5 grid: rows = construction cost (high to low), cols = sell rate (low to high)
  sellingRates: [7000, 7500, 8000, 8500, 9000],
  constructionCosts: [3200, 3000, 2800, 2600, 2400],
  irrGrid: [
    [12, 14, 16, 18, 20], // highest construction cost row
    [14, 16, 18, 20, 22],
    [16, 18, 20, 22, 24], // base (mid)
    [18, 20, 22, 24, 26],
    [20, 22, 24, 26, 28], // lowest construction cost row
  ],
});

const fixture = (overrides = {}) => ({
  deal: { id: 'd-1', organization_id: 'o-1', name: 'Test', asset_class: 'residential_apartments', deal_structure: 'outright_purchase', city: 'Bengaluru' },
  sensitivityMatrix: fullMatrix(),
  financials: { total_cost_cr: 100, total_revenue_cr: 140, gross_margin_pct: 28, equity_multiple: 1.85 },
  ...overrides,
});

beforeEach(() => {
  getProviderAvailability.mockReset();
  runClaudeReasoning.mockReset();
  runAI.mockReset();
});

describe('PR-NX44 — generateSensitivityNarrative', () => {
  describe('no-op fast paths', () => {
    test('missing matrix → unavailable with "insufficient sensitivity grid"', async () => {
      const out = await generateSensitivityNarrative({ ...fixture(), sensitivityMatrix: null });
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/insufficient sensitivity grid/);
      expect(runAI).not.toHaveBeenCalled();
    });

    test('sparse grid (2×2) → unavailable', async () => {
      const sparse = { sellingRates: [7000, 8000], constructionCosts: [3000, 2500], irrGrid: [[10, 15], [12, 17]] };
      const out = await generateSensitivityNarrative({ ...fixture(), sensitivityMatrix: sparse });
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/insufficient sensitivity grid/);
    });

    test('matrix missing irrGrid → unavailable', async () => {
      const broken = { sellingRates: [7000, 8000, 9000], constructionCosts: [3000, 2800, 2600], irrGrid: null };
      const out = await generateSensitivityNarrative({ ...fixture(), sensitivityMatrix: broken });
      expect(out.available).toBe(false);
    });
  });

  describe('happy paths (OpenAI primary)', () => {
    test('OpenAI succeeds first → provider=gpt-5.4 with no fallbackReason', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runAI.mockResolvedValueOnce({
        result: JSON.stringify({
          driver_decomposition_paragraph: 'Sell rate dominates with 800 bps IRR swing vs construction cost\'s 400 bps.',
          stress_test_paragraph: 'Stress 1: sell rate −10% AND construction cost +15% takes IRR to 14%.',
          dominant_driver: 'Sell Rate',
          confidence: 'high',
        }),
        model: 'gpt-5.4',
      });
      const out = await generateSensitivityNarrative(fixture());
      expect(out.available).toBe(true);
      expect(out.driver_decomposition_paragraph).toMatch(/800 bps/);
      expect(out.dominant_driver).toBe('Sell Rate');
      expect(out.provider).toBe('gpt-5.4');
      expect(out.fallbackReason).toBeNull();
      expect(runAI).toHaveBeenCalledTimes(1);
      expect(runClaudeReasoning).not.toHaveBeenCalled();
    });

    test('OpenAI 429 → Claude rescues → fallbackReason cites OpenAI error', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runAI.mockRejectedValueOnce(Object.assign(new Error('rate_limited'), { status: 429 }));
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        driver_decomposition_paragraph: 'Claude rescue.',
        stress_test_paragraph: 'Stress test.',
        dominant_driver: 'Construction Cost',
        confidence: 'medium',
      }));
      const out = await generateSensitivityNarrative(fixture());
      expect(out.available).toBe(true);
      expect(out.provider).toBe('claude-sonnet-4-6');
      expect(out.fallbackReason).toMatch(/OpenAI 429 rate_limited/);
      expect(out.fallbackReason).toMatch(/auto-failover succeeded on claude/);
    });

    test('OpenAI malformed JSON → Claude rescues', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runAI.mockResolvedValueOnce({ result: 'not even json', model: 'gpt-5.4' });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        driver_decomposition_paragraph: 'Claude valid response.',
        stress_test_paragraph: 'Stress.',
        dominant_driver: 'Sell Rate',
        confidence: 'medium',
      }));
      const out = await generateSensitivityNarrative(fixture());
      expect(out.available).toBe(true);
      expect(out.fallbackReason).toMatch(/OpenAI returned unparseable JSON/);
    });
  });

  describe('not-available paths', () => {
    test('no providers configured → unavailable', async () => {
      getProviderAvailability.mockReturnValue({ claude: false, gpt_compatible: false });
      const out = await generateSensitivityNarrative(fixture());
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/No AI provider configured/);
    });

    test('both providers configured + both fail → unavailable with BOTH errors', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runAI.mockRejectedValueOnce(new Error('openai_outage'));
      runClaudeReasoning.mockRejectedValueOnce(new Error('claude_timeout'));
      const out = await generateSensitivityNarrative(fixture());
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/OpenAI openai_outage/);
      expect(out.reason).toMatch(/Claude claude_timeout/);
    });
  });

  describe('envelope coercion', () => {
    test('invalid confidence coerces to "medium"', async () => {
      getProviderAvailability.mockReturnValue({ claude: false, gpt_compatible: true });
      runAI.mockResolvedValueOnce({
        result: JSON.stringify({
          driver_decomposition_paragraph: 'ok',
          stress_test_paragraph: 'ok',
          dominant_driver: 'Sell Rate',
          confidence: 'very high',
        }),
        model: 'gpt-5.4',
      });
      const out = await generateSensitivityNarrative(fixture());
      expect(out.confidence).toBe('medium');
    });

    test('missing paragraphs coerce to null (no crash)', async () => {
      getProviderAvailability.mockReturnValue({ claude: false, gpt_compatible: true });
      runAI.mockResolvedValueOnce({
        result: JSON.stringify({ dominant_driver: 'Sell Rate', confidence: 'medium' }),
        model: 'gpt-5.4',
      });
      const out = await generateSensitivityNarrative(fixture());
      expect(out.available).toBe(true);
      expect(out.driver_decomposition_paragraph).toBeNull();
      expect(out.stress_test_paragraph).toBeNull();
    });
  });
});
