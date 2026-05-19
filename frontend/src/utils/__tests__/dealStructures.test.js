import { describe, it, expect } from 'vitest';
import {
  DEAL_STRUCTURE_CONFIG,
  DEAL_STRUCTURES,
  DEAL_STRUCTURE_LABELS,
  DEAL_STRUCTURE_LABELS_COMPACT,
} from '../dealStructures';

describe('PR-NX59 — dealStructures shared taxonomy', () => {
  it('exposes 8 deal structures matching the backend domain enum', () => {
    // Keys MUST stay 1:1 with backend/src/constants/domain.js DEAL_STRUCTURES.
    expect(DEAL_STRUCTURES).toEqual([
      'outright',
      'jv',
      'jda',
      'revenue_share',
      'area_share',
      'profit_share',
      'ground_lease',
      'hybrid',
    ]);
  });

  it('DEAL_STRUCTURE_CONFIG entries all have value + label string fields', () => {
    expect(DEAL_STRUCTURE_CONFIG).toHaveLength(8);
    for (const entry of DEAL_STRUCTURE_CONFIG) {
      expect(typeof entry.value).toBe('string');
      expect(entry.value.length).toBeGreaterThan(0);
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('DEAL_STRUCTURE_LABELS maps every value to a full label', () => {
    for (const v of DEAL_STRUCTURES) {
      expect(typeof DEAL_STRUCTURE_LABELS[v]).toBe('string');
      expect(DEAL_STRUCTURE_LABELS[v].length).toBeGreaterThan(0);
    }
  });

  it('DEAL_STRUCTURE_LABELS_COMPACT covers every value with a (typically shorter) label', () => {
    for (const v of DEAL_STRUCTURES) {
      expect(typeof DEAL_STRUCTURE_LABELS_COMPACT[v]).toBe('string');
      expect(DEAL_STRUCTURE_LABELS_COMPACT[v].length).toBeGreaterThan(0);
    }
  });

  it('exposes a distinct full vs compact label for at least one value', () => {
    // Compact must shorten at least one value (e.g. JDA, Outright) — guards
    // against the two maps accidentally drifting into being identical.
    let differs = false;
    for (const v of DEAL_STRUCTURES) {
      if (DEAL_STRUCTURE_LABELS[v] !== DEAL_STRUCTURE_LABELS_COMPACT[v]) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('DEAL_STRUCTURE_LABELS keys equal the canonical value list', () => {
    expect(Object.keys(DEAL_STRUCTURE_LABELS).sort()).toEqual([...DEAL_STRUCTURES].sort());
  });
});
