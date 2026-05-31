import { describe, it, expect } from 'vitest';
import { normalizeFinancials } from '../normalizeFinancials';

const base = (inputs) => ({ asset_class: 'residential_apartments', model_params: { inputs } });

// Deals store duration as projectDurationYears, but the what-if slider,
// sensitivity tornado, and scenario comparison all key on
// projectDurationMonths. Without this backfill those controls anchored on the
// registry default (36mo) and the residential downside's "+3mo delay" never
// reached the kernel. Guards finding #1.
describe('normalizeFinancials — projectDurationMonths backfill', () => {
  it('backfills projectDurationMonths from projectDurationYears', () => {
    const out = normalizeFinancials(base({ projectDurationYears: 3, sellingRatePerSqft: 9000 }));
    expect(out.inputs.projectDurationMonths).toBe(36);
    expect(out.inputs.projectDurationYears).toBe(3);
  });

  it('handles fractional years', () => {
    const out = normalizeFinancials(base({ projectDurationYears: 3.5 }));
    expect(out.inputs.projectDurationMonths).toBe(42);
  });

  it('does not overwrite an existing projectDurationMonths', () => {
    const out = normalizeFinancials(base({ projectDurationMonths: 30, projectDurationYears: 3 }));
    expect(out.inputs.projectDurationMonths).toBe(30);
  });

  it('leaves inputs unchanged when no duration is present', () => {
    const out = normalizeFinancials(base({ sellingRatePerSqft: 9000 }));
    expect(out.inputs.projectDurationMonths).toBeUndefined();
  });
});
