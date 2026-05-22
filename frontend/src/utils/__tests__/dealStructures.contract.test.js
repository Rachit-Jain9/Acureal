import { describe, it, expect } from 'vitest';
import { DEAL_STRUCTURE_CONFIG, DEAL_STRUCTURES } from '../dealStructures';
import domain from '../../../../backend/src/constants/domain.js';
import ontology from '@redip/real-estate-ontology';

/**
 * Contract test — Workstream F (foundations), ontology adoption Phase 2.
 *
 * The deal-structure taxonomy is independently declared in THREE places:
 *   1. backend/src/constants/domain.js       — DEAL_STRUCTURES, the API
 *      validator enum (`body('dealStructure').isIn(DEAL_STRUCTURES)`)
 *   2. frontend/src/utils/dealStructures.js  — DEAL_STRUCTURE_CONFIG, the
 *      create/edit deal-form options
 *   3. packages/real-estate-ontology/v1.json — deal_structure, the
 *      canonical taxonomy
 *
 * Per the operator decision of 2026-05-22 the live 8-key list is
 * canonical; the ontology was corrected to match (ontology v1.1.0). This
 * test makes future drift impossible — a divergence fails CI with a
 * precise diff. It mirrors `assetClasses.contract.test.js`.
 *
 * Labels are intentionally allowed to differ — the ontology carries
 * descriptive taxonomy labels ("JDA (Development Agreement)") while the
 * form config carries clean dropdown labels — so only the KEY SET is
 * contracted.
 */

const backendDealStructures = domain.DEAL_STRUCTURES || domain.default?.DEAL_STRUCTURES;

describe('deal-structure taxonomy — cross-source contract', () => {
  it('keeps the frontend key set identical to the backend validator enum', () => {
    expect(Array.isArray(backendDealStructures)).toBe(true);
    expect([...DEAL_STRUCTURES].sort()).toEqual([...backendDealStructures].sort());
  });

  it('matches the canonical ontology deal-structure key set', () => {
    const configKeys = DEAL_STRUCTURE_CONFIG.map((d) => d.value).sort();
    const ontologyKeys = ontology.deal_structure.values.map((d) => d.key).sort();
    expect(configKeys).toEqual(ontologyKeys);
  });

  it('every frontend entry carries a value and a non-empty label', () => {
    for (const entry of DEAL_STRUCTURE_CONFIG) {
      expect(typeof entry.value).toBe('string');
      expect(entry.value.length).toBeGreaterThan(0);
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});
