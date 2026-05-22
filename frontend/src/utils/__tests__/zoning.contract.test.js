import { describe, it, expect } from 'vitest';
import { ZONING_CONFIG, ZONING_TYPES } from '../zoning';
import domain from '../../../../backend/src/constants/domain.js';
import ontology from '@redip/real-estate-ontology';

/**
 * Contract test — Workstream F (foundations), ontology adoption Phase 3.
 *
 * The zoning taxonomy is independently declared in THREE places:
 *   1. backend/src/constants/domain.js       — ZONING_TYPES, the API
 *      validator enum (property.routes.js `body('zoning').isIn(...)`)
 *   2. frontend/src/utils/zoning.js          — ZONING_CONFIG, the
 *      create-parcel form options
 *   3. packages/real-estate-ontology/v1.json — zoning.values, the
 *      canonical taxonomy
 *
 * All three mirror the Postgres `zoning_type` enum (5 values). The
 * ontology was corrected to match in v1.2.0 — it previously carried 11
 * RMP master-plan zone codes, six of which the `properties.zoning` /
 * `deals.zoning` enum does not accept. This test makes future drift
 * impossible: a divergence fails CI with a precise diff. It mirrors
 * `dealStructures.contract.test.js`.
 */

const backendZoningTypes = domain.ZONING_TYPES || domain.default?.ZONING_TYPES;

describe('zoning taxonomy — cross-source contract', () => {
  it('keeps the frontend key set identical to the backend validator enum', () => {
    expect(Array.isArray(backendZoningTypes)).toBe(true);
    expect([...ZONING_TYPES].sort()).toEqual([...backendZoningTypes].sort());
  });

  it('matches the canonical ontology zoning key set', () => {
    const configKeys = ZONING_CONFIG.map((z) => z.value).sort();
    const ontologyKeys = [...ontology.zoning.values].sort();
    expect(configKeys).toEqual(ontologyKeys);
  });

  it('every frontend entry carries a value and a non-empty label', () => {
    for (const entry of ZONING_CONFIG) {
      expect(typeof entry.value).toBe('string');
      expect(entry.value.length).toBeGreaterThan(0);
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});
