'use strict';

const {
  summariseRecommendations,
  summariseFindings,
  bandFor,
  SEVERITY_BANDS,
} = require('../src/services/recommendation/summarise');

describe('bandFor', () => {
  test('maps severity 5 → critical', () => expect(bandFor(5)).toBe('critical'));
  test('maps severity 4 → high', () => expect(bandFor(4)).toBe('high'));
  test('maps severity 3 → medium', () => expect(bandFor(3)).toBe('medium'));
  test('maps severity 2 → low', () => expect(bandFor(2)).toBe('low'));
  test('maps severity 1 → low', () => expect(bandFor(1)).toBe('low'));
  test('maps severity 0/null/NaN → low', () => {
    expect(bandFor(0)).toBe('low');
    expect(bandFor(null)).toBe('low');
    expect(bandFor('not-a-number')).toBe('low');
  });
});

describe('SEVERITY_BANDS', () => {
  test('declares all four bands in canonical order', () => {
    expect(Object.keys(SEVERITY_BANDS)).toEqual(['critical', 'high', 'medium', 'low']);
  });
});

describe('summariseRecommendations', () => {
  test('empty array → zero counts + null top_severity', () => {
    const out = summariseRecommendations([]);
    expect(out.total).toBe(0);
    expect(out.top_severity).toBeNull();
    expect(out.top_card).toBeNull();
    expect(out.has_legal_carve_out).toBe(false);
    expect(out.by_severity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  test('null / undefined → same as empty', () => {
    expect(summariseRecommendations(null).total).toBe(0);
    expect(summariseRecommendations(undefined).total).toBe(0);
  });

  test('counts by severity band', () => {
    const cards = [
      { id: 'a', verb: 'Recommend', topic: 'land_price', severity: 5, headline: 'top' },
      { id: 'b', verb: 'Re-examine', topic: 'pricing', severity: 4, headline: 'mid' },
      { id: 'c', verb: 'Re-examine', topic: 'absorption', severity: 4, headline: 'mid' },
      { id: 'd', verb: 'Consider', topic: 'capital_stack', severity: 3, headline: 'low' },
      { id: 'e', verb: 'Consider', topic: 'execution', severity: 2, headline: 'lower' },
    ];
    const out = summariseRecommendations(cards);
    expect(out.total).toBe(5);
    expect(out.by_severity).toEqual({ critical: 1, high: 2, medium: 1, low: 1 });
    expect(out.top_severity).toBe('critical');
  });

  test('top_card is the highest-severity card', () => {
    const cards = [
      { id: 'a', verb: 'Recommend', topic: 'land_price', severity: 3, headline: 'low' },
      { id: 'b', verb: 'Flag', topic: 'pricing', severity: 5, headline: 'BIGGEST' },
      { id: 'c', verb: 'Consider', topic: 'absorption', severity: 4, headline: 'mid' },
    ];
    const out = summariseRecommendations(cards);
    expect(out.top_card.id).toBe('b');
    expect(out.top_card.severity).toBe(5);
    expect(out.top_card.headline).toBe('BIGGEST');
  });

  test('has_legal_carve_out is true when ANY card is on a legal topic', () => {
    expect(summariseRecommendations([
      { id: 'a', verb: 'Recommend', topic: 'land_price', severity: 3 },
    ]).has_legal_carve_out).toBe(false);

    expect(summariseRecommendations([
      { id: 'a', verb: 'Recommend', topic: 'land_price', severity: 3 },
      { id: 'b', verb: 'Flag', topic: 'legal_rera', severity: 5 },
    ]).has_legal_carve_out).toBe(true);
  });

  test('by_verb buckets cards by verb', () => {
    const cards = [
      { id: 'a', verb: 'Recommend', topic: 'land_price', severity: 3 },
      { id: 'b', verb: 'Recommend', topic: 'pricing', severity: 4 },
      { id: 'c', verb: 'Flag', topic: 'legal_rera', severity: 5 },
    ];
    const out = summariseRecommendations(cards);
    expect(out.by_verb).toEqual({ Recommend: 2, Flag: 1 });
  });
});

describe('summariseFindings', () => {
  test('empty array → zero counts', () => {
    const out = summariseFindings([]);
    expect(out.total).toBe(0);
    expect(out.top_severity).toBeNull();
  });

  test('mirrors the recommendation summariser shape (no top_card)', () => {
    const findings = [
      { id: 'a', verb: 'Diverges', topic: 'land_price', severity: 5 },
      { id: 'b', verb: 'Lacks support', topic: 'capital_stack', severity: 4 },
      { id: 'c', verb: 'Missing', topic: 'legal_rera', severity: 5 },
    ];
    const out = summariseFindings(findings);
    expect(out.total).toBe(3);
    expect(out.by_severity).toEqual({ critical: 2, high: 1, medium: 0, low: 0 });
    expect(out.top_severity).toBe('critical');
    expect(out.has_legal_carve_out).toBe(true);
    expect(out.by_verb).toEqual({ Diverges: 1, 'Lacks support': 1, Missing: 1 });
  });
});
