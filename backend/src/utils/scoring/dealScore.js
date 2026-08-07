'use strict';

/**
 * Deterministic deal score (0–100).
 *
 * Used by every export to produce one number you can defend in IC. No LLM,
 * no black-box weighting — every contribution traces back to a structured
 * input and a published weight.
 *
 * Returns:
 *   {
 *     score: number (0–100, integer),
 *     band:  'strong' | 'above_benchmark' | 'in_line' | 'below_benchmark' | 'weak',
 *     breakdown: [
 *       { component, max, awarded, reason }
 *     ],
 *     dataCompleteness: number (0–100),
 *     disclaimer: string
 *   }
 *
 * Design notes:
 *   - Components missing structured data award 0 *and* the absence is reported
 *     under `breakdown[i].reason`. Sparse-data deals score lower (correct
 *     behaviour for "we don't know").
 *   - Asset-class baselines tilt the IRR/EM benchmarks: a 16% IRR is great
 *     for an income asset, mediocre for a development play. The thresholds
 *     are encoded explicitly per class.
 *   - Score never goes below 0 or above 100.
 */

// Asset-class benchmarks. Source: Acureal underwriting handbook §2.4. These
// are the *ungeared* cross-cycle expectations — sensitivity / scenario
// outputs may legitimately fall outside.
const BENCHMARKS = Object.freeze({
  residential_apartments: { irrTarget: 22, irrFloor: 16, emTarget: 1.9,  emFloor: 1.5,  marginTarget: 28, marginFloor: 18 },
  villas:                 { irrTarget: 22, irrFloor: 16, emTarget: 1.9,  emFloor: 1.5,  marginTarget: 28, marginFloor: 18 },
  plotted_development:    { irrTarget: 25, irrFloor: 18, emTarget: 1.8,  emFloor: 1.4,  marginTarget: 32, marginFloor: 20 },
  commercial_office:      { irrTarget: 17, irrFloor: 13, emTarget: 1.7,  emFloor: 1.3,  marginTarget: 22, marginFloor: 14 },
  retail:                 { irrTarget: 17, irrFloor: 13, emTarget: 1.7,  emFloor: 1.3,  marginTarget: 22, marginFloor: 14 },
  industrial_warehousing: { irrTarget: 16, irrFloor: 12, emTarget: 1.6,  emFloor: 1.3,  marginTarget: 22, marginFloor: 14 },
  hospitality:            { irrTarget: 18, irrFloor: 13, emTarget: 1.7,  emFloor: 1.3,  marginTarget: 24, marginFloor: 16 },
  mixed_use:              { irrTarget: 20, irrFloor: 14, emTarget: 1.8,  emFloor: 1.4,  marginTarget: 25, marginFloor: 16 },
  raw_land:               { irrTarget: 24, irrFloor: 17, emTarget: 1.9,  emFloor: 1.5,  marginTarget: 30, marginFloor: 18 },
  redevelopment:          { irrTarget: 22, irrFloor: 16, emTarget: 1.9,  emFloor: 1.5,  marginTarget: 28, marginFloor: 18 },
});

const DEFAULT_BENCHMARK = BENCHMARKS.residential_apartments;

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Linear interpolation: floor → 0 pts, target → max pts. Below floor → 0,
// above target → max. Saturates cleanly so a 30% IRR and a 50% IRR both
// award the full IRR component.
const interpolate = (value, floor, target, max) => {
  if (value == null) return 0;
  if (value <= floor) return 0;
  if (value >= target) return max;
  return Math.round(((value - floor) / (target - floor)) * max);
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const bandFor = (score) => {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'above_benchmark';
  if (score >= 50) return 'in_line';
  if (score >= 35) return 'below_benchmark';
  return 'weak';
};

/**
 * Compute the deal score.
 *
 * All inputs are optional — the function tolerates missing data gracefully
 * and reports completeness in the result so the caller can disclose it.
 *
 * @param {Object} inputs
 * @param {string} inputs.assetClass            One of the keys in BENCHMARKS
 * @param {number} inputs.irrPct                Project / equity IRR in %
 * @param {number} inputs.equityMultiple
 * @param {number} inputs.grossMarginPct
 * @param {number} inputs.dscr                  Min DSCR for the project
 * @param {number} inputs.ddCompletionPct       0–100
 * @param {Object} inputs.riskCounts            { critical, high, medium, low } — OPEN risks only
 * @param {boolean} inputs.riskRegisterPopulated  Whether ANY risk row exists for the deal.
 *   Required to earn the 25-pt risk baseline. Defaults to false (fail-closed):
 *   zero open risks on an empty register is absence, not clearance.
 * @param {boolean} inputs.financialModelPresent
 * @param {number} inputs.dataPointsKnown       Count of populated structured fields
 * @param {number} inputs.dataPointsTotal       Total expected fields for this asset class
 */
const computeDealScore = (inputs = {}) => {
  const benchmark = BENCHMARKS[inputs.assetClass] || DEFAULT_BENCHMARK;
  const breakdown = [];

  // Component 1: IRR vs benchmark — 25 pts max
  {
    const irr = num(inputs.irrPct);
    const max = 25;
    const awarded = interpolate(irr, benchmark.irrFloor, benchmark.irrTarget, max);
    breakdown.push({
      component: 'IRR vs benchmark',
      max,
      awarded,
      reason: irr == null
        ? 'IRR not provided — 0 pts awarded'
        : `IRR ${irr.toFixed(1)}% vs floor ${benchmark.irrFloor}% / target ${benchmark.irrTarget}%`,
    });
  }

  // Component 2: Equity multiple vs benchmark — 15 pts max
  {
    const em = num(inputs.equityMultiple);
    const max = 15;
    const awarded = interpolate(em, benchmark.emFloor, benchmark.emTarget, max);
    breakdown.push({
      component: 'Equity multiple vs benchmark',
      max,
      awarded,
      reason: em == null
        ? 'Equity multiple not provided — 0 pts awarded'
        : `EM ${em.toFixed(2)}× vs floor ${benchmark.emFloor}× / target ${benchmark.emTarget}×`,
    });
  }

  // Component 3: Gross margin vs benchmark — 10 pts max
  {
    const margin = num(inputs.grossMarginPct);
    const max = 10;
    const awarded = interpolate(margin, benchmark.marginFloor, benchmark.marginTarget, max);
    breakdown.push({
      component: 'Gross margin vs benchmark',
      max,
      awarded,
      reason: margin == null
        ? 'Margin not provided — 0 pts awarded'
        : `Margin ${margin.toFixed(1)}% vs floor ${benchmark.marginFloor}% / target ${benchmark.marginTarget}%`,
    });
  }

  // Component 4: DD completion — 20 pts max (linear with floor 0%, target 100%)
  {
    const dd = num(inputs.ddCompletionPct);
    const max = 20;
    const awarded = dd == null ? 0 : Math.round(clamp(dd, 0, 100) / 100 * max);
    breakdown.push({
      component: 'DD completion',
      max,
      awarded,
      reason: dd == null
        ? 'DD progress not tracked — 0 pts awarded'
        : `${dd.toFixed(0)}% of required DD items closed`,
    });
  }

  // Component 5: Risk severity — up to 25 pts deducted from a 25-pt baseline
  // Critical = -10 each, High = -5, Medium = -2, Low = -0.5. Floors at 0.
  //
  // ABSENCE IS NOT CLEARANCE. The baseline is a reward for a register that was
  // populated and came back clean; it was previously also handed to every deal
  // whose register had never been opened, because both states present as
  // zero counts. On a deal with no risk work those 25 points were ~45% of the
  // score printed at 48pt on the DOCX cover and on the PPTX gauge — an IC
  // reading a diligenced-and-clean number off an untouched register.
  // Fail-closed: only an explicit `true` earns the baseline, so a caller that
  // forgets to thread the flag scores 0 rather than silently scoring full.
  {
    const populated = inputs.riskRegisterPopulated === true;
    const baseline = 25;

    if (!populated) {
      breakdown.push({
        component: 'Risk register (baseline 25 pts, deductions for severity)',
        max: baseline,
        awarded: 0,
        reason: 'Risk register not populated — no risk assessment on file, 0 pts awarded',
      });
    } else {
      const counts = inputs.riskCounts || {};
      const critical = num(counts.critical) || 0;
      const high     = num(counts.high) || 0;
      const medium   = num(counts.medium) || 0;
      const low      = num(counts.low) || 0;
      const deduction =
        critical * 10 +
        high * 5 +
        medium * 2 +
        low * 0.5;
      const awarded = Math.round(Math.max(0, baseline - deduction));
      breakdown.push({
        component: 'Risk register (baseline 25 pts, deductions for severity)',
        max: baseline,
        awarded,
        reason:
          `${critical} critical / ${high} high / ${medium} medium / ${low} low ` +
          `→ ${deduction.toFixed(1)} pts deducted`,
      });
    }
  }

  // Component 6: Financial model presence — 5 pts (binary)
  {
    const present = !!inputs.financialModelPresent;
    const max = 5;
    const awarded = present ? max : 0;
    breakdown.push({
      component: 'Financial model present',
      max,
      awarded,
      reason: present
        ? 'Financial model attached'
        : 'No financial model — 0 pts awarded',
    });
  }

  const score = clamp(
    breakdown.reduce((sum, item) => sum + item.awarded, 0),
    0,
    100,
  );

  // Data completeness — what fraction of expected structured inputs were
  // populated. Independent of the score itself; surfaces "we don't know".
  const totalCheck = num(inputs.dataPointsTotal);
  const knownCheck = num(inputs.dataPointsKnown);
  const dataCompleteness =
    totalCheck && totalCheck > 0 && knownCheck != null
      ? Math.round(clamp(knownCheck / totalCheck, 0, 1) * 100)
      : null;

  return {
    score,
    band: bandFor(score),
    breakdown,
    dataCompleteness,
    benchmark: {
      assetClass: BENCHMARKS[inputs.assetClass] ? inputs.assetClass : null,
      irrTarget: benchmark.irrTarget,
      irrFloor: benchmark.irrFloor,
      emTarget: benchmark.emTarget,
      emFloor: benchmark.emFloor,
      marginTarget: benchmark.marginTarget,
      marginFloor: benchmark.marginFloor,
    },
    disclaimer:
      'Composite score is a deterministic synthesis of structured deal data only. ' +
      'It is not an investment recommendation; verify all underlying assumptions before any decision.',
  };
};

module.exports = {
  computeDealScore,
  BENCHMARKS,
  // Exposed for unit tests.
  __internal: { interpolate, bandFor },
};
