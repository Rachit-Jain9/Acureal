'use strict';

const { applyVerdictsToCards, VALID_VERDICTS } = require('../src/services/recommendation/verdicts.service');

describe('VALID_VERDICTS', () => {
  test('declares exactly the three allowed kinds', () => {
    expect([...VALID_VERDICTS].sort()).toEqual(['acted', 'dismissed', 'snoozed']);
  });
});

describe('applyVerdictsToCards', () => {
  const cards = [
    { id: 'land-cost-share-high', verb: 'Recommend', severity: 5 },
    { id: 'irr-below-hurdle', verb: 'Re-examine', severity: 4 },
    { id: 'rera-registration-missing', verb: 'Flag', severity: 5 },
  ];

  test('empty input → empty buckets', () => {
    expect(applyVerdictsToCards([], [])).toEqual({ visible: [], hidden: [] });
  });

  test('no verdicts → all visible', () => {
    expect(applyVerdictsToCards(cards, [])).toEqual({ visible: cards, hidden: [] });
  });

  test('a dismissed verdict moves the matching card into hidden', () => {
    const verdicts = [{ rule_id: 'irr-below-hurdle', verdict: 'dismissed', reason: 'not material' }];
    const { visible, hidden } = applyVerdictsToCards(cards, verdicts);
    expect(visible.map((c) => c.id)).toEqual(['land-cost-share-high', 'rera-registration-missing']);
    expect(hidden.map((c) => c.id)).toEqual(['irr-below-hurdle']);
    expect(hidden[0].verdict.kind).toBe('dismissed');
  });

  test('multiple verdicts move multiple cards', () => {
    const verdicts = [
      { rule_id: 'land-cost-share-high', verdict: 'dismissed' },
      { rule_id: 'rera-registration-missing', verdict: 'snoozed', snooze_until: '2030-01-01' },
    ];
    const { visible, hidden } = applyVerdictsToCards(cards, verdicts);
    expect(visible.map((c) => c.id)).toEqual(['irr-below-hurdle']);
    expect(hidden.map((c) => c.id).sort()).toEqual(['land-cost-share-high', 'rera-registration-missing'].sort());
  });

  test('verdicts on non-existent rule ids are ignored', () => {
    const verdicts = [{ rule_id: 'rule-that-does-not-exist', verdict: 'dismissed' }];
    const { visible, hidden } = applyVerdictsToCards(cards, verdicts);
    expect(visible).toEqual(cards);
    expect(hidden).toEqual([]);
  });
});
