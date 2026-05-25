'use strict';

const matrix = require('../src/utils/dealStructureMatrix');
const domain = require('../src/constants/domain');

describe('dealStructureMatrix taxonomy', () => {
  test('matches backend/src/constants/domain.js DEAL_STRUCTURES exactly', () => {
    expect([...matrix.DEAL_STRUCTURES].sort()).toEqual([...domain.DEAL_STRUCTURES].sort());
  });
});

describe('isValidPair', () => {
  test('allows 76 meaningful combinations and blocks exactly 4 incoherent ones', () => {
    const blocked = [];
    const allowed = [];
    for (const ac of matrix.ASSET_CLASSES) {
      for (const ds of matrix.DEAL_STRUCTURES) {
        const v = matrix.isValidPair(ac, ds);
        if (v.valid) allowed.push(`${ac}:${ds}`);
        else blocked.push(`${ac}:${ds}`);
      }
    }
    expect(allowed.length).toBe(76);
    expect(blocked.length).toBe(4);
    expect(blocked.sort()).toEqual([
      'hospitality:area_share',
      'plotted_development:ground_lease',
      'redevelopment:ground_lease',
      'villas:ground_lease',
    ]);
  });

  test('every blocked pair carries an informative reason that suggests an alternative', () => {
    for (const key of Object.keys(matrix.INVALID_PAIRS)) {
      expect(typeof matrix.INVALID_PAIRS[key]).toBe('string');
      expect(matrix.INVALID_PAIRS[key].length).toBeGreaterThanOrEqual(40);
      expect(matrix.INVALID_PAIRS[key]).toMatch(/Consider/);
    }
  });

  test('returns valid:true when either input is missing', () => {
    expect(matrix.isValidPair(null, 'jda').valid).toBe(true);
    expect(matrix.isValidPair('residential_apartments', null).valid).toBe(true);
    expect(matrix.isValidPair(null, null).valid).toBe(true);
    expect(matrix.isValidPair(undefined, undefined).valid).toBe(true);
  });
});

describe('getAdditionalApprovals', () => {
  test('returns structure-specific approvals for JDA', () => {
    const jdaApprovals = matrix.getAdditionalApprovals('residential_apartments', 'jda');
    expect(jdaApprovals.length).toBeGreaterThanOrEqual(2);
    const names = jdaApprovals.map((a) => a.name);
    expect(names.some((n) => /JDA executed/i.test(n))).toBe(true);
    expect(names.some((n) => /Power of Attorney/i.test(n))).toBe(true);
  });

  test('stacks asset-class overlays + structure add-ons', () => {
    const out = matrix.getAdditionalApprovals('redevelopment', 'jda');
    const names = out.map((a) => a.name);
    expect(names.some((n) => /Society/i.test(n) && /consent/i.test(n))).toBe(true);
    expect(names.some((n) => /JDA executed/i.test(n))).toBe(true);
  });

  test('returns [] for outright (no structure-specific add-ons)', () => {
    expect(matrix.getAdditionalApprovals('commercial_office', 'outright')).toEqual([]);
  });

  test('every approval entry is well-shaped across every structure', () => {
    for (const ds of matrix.DEAL_STRUCTURES) {
      for (const a of matrix.STRUCTURE_APPROVALS[ds]) {
        expect(typeof a.approval_type).toBe('string');
        expect(typeof a.name).toBe('string');
        expect(a.name.length).toBeGreaterThan(0);
        expect(typeof a.is_required).toBe('boolean');
      }
    }
  });
});

describe('getRequiredDoctypes', () => {
  test('returns structure-specific doctypes', () => {
    expect(matrix.getRequiredDoctypes('residential_apartments', 'jda')).toContain('jda_signed');
    expect(matrix.getRequiredDoctypes('commercial_office', 'ground_lease')).toContain('ground_lease_deed');
    expect(matrix.getRequiredDoctypes('residential_apartments', 'outright')).toEqual([]);
  });
});

describe('getRiskPreset', () => {
  test('JDA elevates title_ownership + financial', () => {
    const jda = matrix.getRiskPreset('residential_apartments', 'jda');
    expect(jda.elevated).toContain('title_ownership');
    expect(jda.elevated).toContain('financial');
  });

  test('outright has no structure-driven elevation (no asset bump)', () => {
    expect(matrix.getRiskPreset('commercial_office', 'outright').elevated).toEqual([]);
  });

  test('hospitality bumps market regardless of structure', () => {
    expect(matrix.getRiskPreset('hospitality', 'outright').elevated).toContain('market');
  });

  test('hospitality + JDA stacks both asset bump and structure preset', () => {
    const hotelJda = matrix.getRiskPreset('hospitality', 'jda');
    expect(hotelJda.elevated).toContain('market');
    expect(hotelJda.elevated).toContain('title_ownership');
    expect(hotelJda.elevated).toContain('financial');
  });

  test('deduplicates when asset bump and structure preset overlap', () => {
    const out = matrix.getRiskPreset('redevelopment', 'jda');
    const titleCount = out.elevated.filter((k) => k === 'title_ownership').length;
    expect(titleCount).toBe(1);
  });
});

describe('getSignalHints', () => {
  test('returns structure-specific signal kinds', () => {
    expect(matrix.getSignalHints('residential_apartments', 'jda')).toContain('jda_mortgage_permission_present');
    expect(matrix.getSignalHints('commercial_office', 'ground_lease')).toContain('lrd_eligibility_via_mortgage_permission');
    expect(matrix.getSignalHints('residential_apartments', null)).toEqual([]);
  });
});

describe('getPairBehavior', () => {
  test('bundles every per-pair behavior into one call', () => {
    const out = matrix.getPairBehavior('residential_apartments', 'jda');
    expect(out.valid.valid).toBe(true);
    expect(Array.isArray(out.additionalApprovals)).toBe(true);
    expect(Array.isArray(out.requiredDoctypes)).toBe(true);
    expect(Array.isArray(out.riskPreset.elevated)).toBe(true);
    expect(Array.isArray(out.signalHints)).toBe(true);
  });
});

describe('completeness', () => {
  test('every structure has a defined approval template + doctype list + risk preset + signal hints', () => {
    for (const ds of matrix.DEAL_STRUCTURES) {
      expect(Array.isArray(matrix.STRUCTURE_APPROVALS[ds])).toBe(true);
      expect(Array.isArray(matrix.STRUCTURE_REQUIRED_DOCTYPES[ds])).toBe(true);
      expect(matrix.STRUCTURE_RISK_PRESETS[ds]).toBeTruthy();
      expect(Array.isArray(matrix.STRUCTURE_SIGNAL_HINTS[ds])).toBe(true);
    }
  });
});
