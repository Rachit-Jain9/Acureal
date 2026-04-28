'use strict';

const {
  PARCEL_RED_FLAG_REGISTRY,
  SEVERITY,
  runParcelRedFlags,
  listRegistryDescriptors,
} = require('../src/engines/parcelRedFlags.engine');

const VALID_SEVERITIES = new Set([SEVERITY.HIGH, SEVERITY.MEDIUM, SEVERITY.LOW]);

// A baseline input where every rule's predicate returns false. Each per-rule
// test mutates a copy of this to flip exactly one rule on at a time.
const baselineInputs = () => ({
  property: {
    land_area_sqft: 5000,
    road_width_mtrs: 12,
  },
  zone: {
    zone_code: 'R-PZ-A',
    plan_status: 'live',
  },
  buildability: {
    status: 'reference_match',
    rule: { plan_status: 'live' },
    values: { setback_input_status: 'complete' },
  },
  guidance: {
    status: 'matched',
    message: null,
  },
  kgis: {
    status: 'matched',
  },
  landeed: {
    status: 'matched',
  },
});

const ruleById = (id) => PARCEL_RED_FLAG_REGISTRY.find((rule) => rule.id === id);

describe('parcelRedFlags engine — registry shape', () => {
  test('registry is non-empty and frozen', () => {
    expect(PARCEL_RED_FLAG_REGISTRY.length).toBeGreaterThan(0);
    expect(Object.isFrozen(PARCEL_RED_FLAG_REGISTRY)).toBe(true);
  });

  test('every rule has the required fields', () => {
    for (const rule of PARCEL_RED_FLAG_REGISTRY) {
      expect(typeof rule.id).toBe('string');
      expect(rule.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof rule.label).toBe('string');
      expect(rule.label.length).toBeGreaterThan(0);
      expect(typeof rule.description).toBe('string');
      expect(rule.description.length).toBeGreaterThan(0);
      expect(VALID_SEVERITIES.has(rule.severity)).toBe(true);
      expect(typeof rule.predicate).toBe('function');
      expect(typeof rule.detailFor).toBe('function');
    }
  });

  test('rule ids are unique', () => {
    const ids = PARCEL_RED_FLAG_REGISTRY.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('listRegistryDescriptors returns JSON-safe metadata only', () => {
    const descriptors = listRegistryDescriptors();
    expect(descriptors).toHaveLength(PARCEL_RED_FLAG_REGISTRY.length);
    for (const descriptor of descriptors) {
      expect(Object.keys(descriptor).sort()).toEqual(['description', 'id', 'label', 'severity']);
      expect(typeof descriptor.predicate).toBe('undefined');
      expect(typeof descriptor.detailFor).toBe('undefined');
    }
    // Round-trips through JSON without losing fields or hitting functions.
    const roundTripped = JSON.parse(JSON.stringify(descriptors));
    expect(roundTripped).toEqual(descriptors);
  });

  test('runParcelRedFlags returns flags in registry-declaration order', () => {
    // Flip a high, a medium, and a low rule on simultaneously.
    const inputs = baselineInputs();
    delete inputs.zone.zone_code; // rule 1 (high)
    inputs.guidance.status = 'low_confidence'; // rule 7 (medium)
    inputs.kgis.status = 'not_requested'; // rule 9 (low)

    const flags = runParcelRedFlags(inputs);
    const labels = flags.map((flag) => flag.label);
    const expectedOrder = PARCEL_RED_FLAG_REGISTRY
      .filter((rule) => ['planning_zone_not_assigned', 'guidance_low_confidence', 'kgis_not_refreshed'].includes(rule.id))
      .map((rule) => rule.label);
    expect(labels).toEqual(expectedOrder);
  });

  test('baseline inputs trigger zero flags', () => {
    expect(runParcelRedFlags(baselineInputs())).toEqual([]);
  });
});

describe('parcelRedFlags engine — runtime output shape', () => {
  test('each flag has only severity, label, detail (and detail may be null)', () => {
    const inputs = baselineInputs();
    delete inputs.zone.zone_code; // arbitrary trigger

    const [flag] = runParcelRedFlags(inputs);
    expect(Object.keys(flag).sort()).toEqual(['detail', 'label', 'severity']);
    expect(VALID_SEVERITIES.has(flag.severity)).toBe(true);
  });

  test('safe to call with empty inputs (no throw)', () => {
    expect(() => runParcelRedFlags({})).not.toThrow();
    expect(() => runParcelRedFlags()).not.toThrow();
  });
});

// One describe per rule. Each: fires-when-condition + does-not-fire baseline.
// Rules whose detail strings vary per call (4 and 6) get an extra detail test.

describe('rule: planning_zone_not_assigned', () => {
  test('fires when zone has no zone_code', () => {
    const inputs = baselineInputs();
    delete inputs.zone.zone_code;
    const flags = runParcelRedFlags(inputs);
    expect(flags).toContainEqual({
      severity: 'high',
      label: 'Planning zone not assigned',
      detail: 'Assign a reviewed RMP zone before relying on FAR/buildability output.',
    });
  });

  test('does not fire on baseline', () => {
    const inputs = baselineInputs();
    expect(ruleById('planning_zone_not_assigned').predicate(inputs)).toBe(false);
  });

  test('fires when zone is null entirely', () => {
    const inputs = baselineInputs();
    inputs.zone = null;
    expect(ruleById('planning_zone_not_assigned').predicate(inputs)).toBe(true);
  });
});

describe('rule: land_area_missing', () => {
  test.each([null, undefined, '', 0, 'not-a-number'])('fires when land_area_sqft = %p', (value) => {
    const inputs = baselineInputs();
    inputs.property.land_area_sqft = value;
    expect(ruleById('land_area_missing').predicate(inputs)).toBe(true);
  });

  test('does not fire when land_area_sqft is positive', () => {
    const inputs = baselineInputs();
    inputs.property.land_area_sqft = 5000;
    expect(ruleById('land_area_missing').predicate(inputs)).toBe(false);
  });
});

describe('rule: road_width_missing', () => {
  test.each([null, undefined, '', 'NaN'])('fires when road_width_mtrs = %p', (value) => {
    const inputs = baselineInputs();
    inputs.property.road_width_mtrs = value;
    expect(ruleById('road_width_missing').predicate(inputs)).toBe(true);
  });

  test('does not fire when road_width_mtrs is 0 — the predicate accepts a zero-width as "specified"', () => {
    // toNumber(0) is 0, not null, so the rule treats it as supplied.
    // This matches the legacy buildRedFlags behavior exactly.
    const inputs = baselineInputs();
    inputs.property.road_width_mtrs = 0;
    expect(ruleById('road_width_missing').predicate(inputs)).toBe(false);
  });

  test('does not fire when road_width_mtrs is set', () => {
    expect(ruleById('road_width_missing').predicate(baselineInputs())).toBe(false);
  });
});

describe('rule: buildability_needs_verification', () => {
  test('fires when buildability.status === needs_verification', () => {
    const inputs = baselineInputs();
    inputs.buildability.status = 'needs_verification';
    inputs.buildability.message = 'Inputs incomplete';
    const flag = runParcelRedFlags(inputs).find((f) => f.label === 'Buildability pending verification');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('medium');
  });

  test('detail string passes through buildability.message verbatim', () => {
    const inputs = baselineInputs();
    inputs.buildability.status = 'needs_verification';
    inputs.buildability.message = 'Setbacks not configured for this rule.';
    const flag = runParcelRedFlags(inputs).find((f) => f.label === 'Buildability pending verification');
    expect(flag.detail).toBe('Setbacks not configured for this rule.');
  });

  test('does not fire on reference_match', () => {
    expect(ruleById('buildability_needs_verification').predicate(baselineInputs())).toBe(false);
  });
});

describe('rule: setback_inputs_partial', () => {
  test('fires when setback_input_status === partial', () => {
    const inputs = baselineInputs();
    inputs.buildability.values.setback_input_status = 'partial';
    expect(ruleById('setback_inputs_partial').predicate(inputs)).toBe(true);
  });

  test('does not fire on complete', () => {
    expect(ruleById('setback_inputs_partial').predicate(baselineInputs())).toBe(false);
  });

  test('does not fire when buildability is null', () => {
    const inputs = baselineInputs();
    inputs.buildability = null;
    expect(ruleById('setback_inputs_partial').predicate(inputs)).toBe(false);
  });
});

describe('rule: guidance_not_matched', () => {
  test.each(['not_available', 'no_guidance_rows', undefined, null, 'unknown'])(
    'fires when guidance.status = %p',
    (status) => {
      const inputs = baselineInputs();
      inputs.guidance.status = status;
      expect(ruleById('guidance_not_matched').predicate(inputs)).toBe(true);
    },
  );

  test('does not fire on matched', () => {
    expect(ruleById('guidance_not_matched').predicate(baselineInputs())).toBe(false);
  });

  test('does not fire on low_confidence (mutual exclusion with guidance_low_confidence)', () => {
    const inputs = baselineInputs();
    inputs.guidance.status = 'low_confidence';
    expect(ruleById('guidance_not_matched').predicate(inputs)).toBe(false);
  });

  test('detail falls back to default copy when guidance.message is empty', () => {
    const inputs = baselineInputs();
    inputs.guidance = { status: 'not_available', message: null };
    const flag = runParcelRedFlags(inputs).find((f) => f.label === 'Guidance value not matched');
    expect(flag.detail).toBe('Upload a guidance report or configure approved IGR rows.');
  });

  test('detail passes guidance.message through when present', () => {
    const inputs = baselineInputs();
    inputs.guidance = { status: 'not_available', message: 'No approved guidance for this locality.' };
    const flag = runParcelRedFlags(inputs).find((f) => f.label === 'Guidance value not matched');
    expect(flag.detail).toBe('No approved guidance for this locality.');
  });
});

describe('rule: guidance_low_confidence', () => {
  test('fires when guidance.status === low_confidence', () => {
    const inputs = baselineInputs();
    inputs.guidance.status = 'low_confidence';
    expect(ruleById('guidance_low_confidence').predicate(inputs)).toBe(true);
  });

  test('does not fire on matched or other statuses', () => {
    expect(ruleById('guidance_low_confidence').predicate(baselineInputs())).toBe(false);

    const other = baselineInputs();
    other.guidance.status = 'not_available';
    expect(ruleById('guidance_low_confidence').predicate(other)).toBe(false);
  });

  test('mutual exclusion: never fires alongside guidance_not_matched', () => {
    const matched = baselineInputs();
    matched.guidance.status = 'low_confidence';
    const fired = runParcelRedFlags(matched).map((f) => f.label);
    expect(fired).toContain('Low-confidence guidance match');
    expect(fired).not.toContain('Guidance value not matched');
  });
});

describe('rule: landeed_not_configured', () => {
  test('fires when landeed.status === not_configured', () => {
    const inputs = baselineInputs();
    inputs.landeed.status = 'not_configured';
    expect(ruleById('landeed_not_configured').predicate(inputs)).toBe(true);
  });

  test('does not fire on matched or any other status', () => {
    expect(ruleById('landeed_not_configured').predicate(baselineInputs())).toBe(false);
  });
});

describe('rule: kgis_not_refreshed', () => {
  test('fires when kgis.status === not_requested', () => {
    const inputs = baselineInputs();
    inputs.kgis.status = 'not_requested';
    expect(ruleById('kgis_not_refreshed').predicate(inputs)).toBe(true);
  });

  test('does not fire on matched, error, or any other status', () => {
    expect(ruleById('kgis_not_refreshed').predicate(baselineInputs())).toBe(false);

    const erroring = baselineInputs();
    erroring.kgis.status = 'error';
    expect(ruleById('kgis_not_refreshed').predicate(erroring)).toBe(false);
  });
});

describe('rule: rmp_draft_or_reference', () => {
  test('fires when zone.plan_status === draft', () => {
    const inputs = baselineInputs();
    inputs.zone.plan_status = 'draft';
    expect(ruleById('rmp_draft_or_reference').predicate(inputs)).toBe(true);
  });

  test('fires when buildability.rule.plan_status === draft_reference', () => {
    const inputs = baselineInputs();
    inputs.zone.plan_status = 'live';
    inputs.buildability.rule.plan_status = 'draft_reference';
    expect(ruleById('rmp_draft_or_reference').predicate(inputs)).toBe(true);
  });

  test('does not fire when both plan_statuses are live', () => {
    expect(ruleById('rmp_draft_or_reference').predicate(baselineInputs())).toBe(false);
  });

  test('does not fire when buildability is null and zone is live', () => {
    const inputs = baselineInputs();
    inputs.buildability = null;
    expect(ruleById('rmp_draft_or_reference').predicate(inputs)).toBe(false);
  });
});

describe('parcelRedFlags engine — coverage sweep', () => {
  test('all 10 documented rules are present in the registry by id', () => {
    const expectedIds = [
      'planning_zone_not_assigned',
      'land_area_missing',
      'road_width_missing',
      'buildability_needs_verification',
      'setback_inputs_partial',
      'guidance_not_matched',
      'guidance_low_confidence',
      'landeed_not_configured',
      'kgis_not_refreshed',
      'rmp_draft_or_reference',
    ];
    const actualIds = PARCEL_RED_FLAG_REGISTRY.map((rule) => rule.id);
    expect(actualIds).toEqual(expectedIds);
  });
});
