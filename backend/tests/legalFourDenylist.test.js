'use strict';

// Keystone enforcement for the "legal four" denylist (CLAUDE.md hard rule): the
// four statutory lanes — title chain, encumbrance, RERA registration, statutory
// approvals — must NEVER be AI-narrated, re-ranked, or learn-adjusted. Before
// `constants/legalFourTopics` this carve-out was encoded THREE different ways
// that could silently drift apart:
//   • learningSignals.aggregator — an exact Set of 4 keys
//   • recommendationRules        — an `ai_narratable: false` catalog flag
//   • dealDoctor                 — a `/^legal_/` regex (broader than the others)
// A new `legal_conversion` lane would have been re-ranked by the aggregator and
// AI-narratable per recommendationRules, yet legal per dealDoctor. This suite
// pins the single canonical guard AND the cross-module consistency, so the build
// fails the moment any path diverges or a new legal lane escapes the net.

const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));

const {
  LEGAL_FOUR_TOPICS,
  LEGAL_FOUR_TOPIC_SET,
  isLegalFourTopic,
} = require('../src/constants/legalFourTopics');
const aggregator = require('../src/services/learningSignals.aggregator.service');
const recommendationRules = require('../src/services/recommendation/recommendationRules');
const dealDoctor = require('../src/services/recommendation/dealDoctor');

const NON_LEGAL = ['land_price', 'pricing', 'absorption', 'capital_stack', 'exit_route', 'execution', 'data_consistency'];

describe('legal-four denylist — canonical guard', () => {
  test('contains exactly the four statutory lanes', () => {
    expect([...LEGAL_FOUR_TOPICS].sort()).toEqual(
      ['legal_approvals', 'legal_encumbrance', 'legal_rera', 'legal_title'],
    );
    expect(LEGAL_FOUR_TOPIC_SET.size).toBe(4);
  });

  test('matches each of the four lanes', () => {
    for (const t of LEGAL_FOUR_TOPICS) expect(isLegalFourTopic(t)).toBe(true);
  });

  test('default-deny: ANY legal_-prefixed lane is treated as legal four', () => {
    expect(isLegalFourTopic('legal_conversion')).toBe(true);
    expect(isLegalFourTopic('legal_khata')).toBe(true);
    expect(isLegalFourTopic('legal_anything_new')).toBe(true);
  });

  test('non-legal topics + junk are NOT legal four', () => {
    for (const t of NON_LEGAL) expect(isLegalFourTopic(t)).toBe(false);
    expect(isLegalFourTopic('illegal_thing')).toBe(false); // not a `legal_` prefix
    expect(isLegalFourTopic('')).toBe(false);
    expect(isLegalFourTopic(null)).toBe(false);
    expect(isLegalFourTopic(undefined)).toBe(false);
    expect(isLegalFourTopic(42)).toBe(false);
  });
});

describe('legal-four denylist — learning aggregator never de-ranks the legal four', () => {
  const heavyDismiss = { dismiss_count: 99, acted_count: 0, snooze_count: 0 };

  test('computeMultiplier holds legal-four at 1.0 even under heavy dismissal', () => {
    for (const t of [...LEGAL_FOUR_TOPICS, 'legal_conversion']) {
      const { multiplier, reason } = aggregator.computeMultiplier(t, heavyDismiss);
      expect(multiplier).toBe(aggregator.MULTIPLIER_NONE);
      expect(reason).toBeNull();
    }
  });

  test('control: a NON-legal topic with the same heavy dismissal IS de-ranked', () => {
    const { multiplier } = aggregator.computeMultiplier('pricing', heavyDismiss);
    expect(multiplier).toBe(aggregator.MULTIPLIER_FLOOR);
  });

  test('back-compat alias LEGAL_CARVE_OUT_TOPICS is the canonical set', () => {
    expect(aggregator.LEGAL_CARVE_OUT_TOPICS).toBe(LEGAL_FOUR_TOPIC_SET);
  });
});

describe('legal-four denylist — recommendation catalog stays in lockstep (drift guard)', () => {
  test('a TOPICS entry is non-narratable IFF it is a legal-four lane', () => {
    for (const [topic, def] of Object.entries(recommendationRules.TOPICS)) {
      expect(def.ai_narratable === false).toBe(isLegalFourTopic(topic));
    }
  });

  test('recommendationRules.isLegalTopic agrees with the canonical guard', () => {
    for (const t of [...LEGAL_FOUR_TOPICS, 'legal_conversion', ...NON_LEGAL]) {
      expect(recommendationRules.isLegalTopic(t)).toBe(isLegalFourTopic(t));
    }
  });
});

describe('legal-four denylist — Deal Doctor uses the same guard', () => {
  test('dealDoctor.isLegalTopic agrees with the canonical guard', () => {
    for (const t of [...LEGAL_FOUR_TOPICS, 'legal_conversion', ...NON_LEGAL]) {
      expect(dealDoctor.isLegalTopic(t)).toBe(isLegalFourTopic(t));
    }
  });
});

describe('legal-four denylist — single source of truth (no divergent copies)', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');
  const SERVICES = [
    'services/learningSignals.aggregator.service.js',
    'services/recommendation/recommendationRules.js',
    'services/recommendation/dealDoctor.js',
  ];
  const IMPORTS_CANON = /require\(['"][./]*constants\/legalFourTopics['"]\)/;

  test.each(SERVICES.map((s) => [s]))('%s imports the canonical denylist', (rel) => {
    expect(read(rel)).toMatch(IMPORTS_CANON);
  });

  test('no service re-defines a local legal-four Set (the drift we removed)', () => {
    // After consolidation the ONLY place a Set listing the legal lanes may live
    // is the canonical module. A local `new Set([... 'legal_...' ...])` in a
    // service is exactly the divergent copy this keystone eliminates.
    for (const rel of SERVICES) {
      expect(/new Set\(\[[^\]]*legal_/.test(read(rel))).toBe(false);
    }
  });
});
