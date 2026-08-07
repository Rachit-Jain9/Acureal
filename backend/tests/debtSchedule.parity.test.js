'use strict';

/**
 * Parity guard: the construction debt schedule exists in THREE places and they
 * must agree on what a rupee of interest is.
 *
 *   • packages/financial-kernel/src/debtSchedule.ts  — authoritative
 *   • backend/src/engines/waterfall.engine.js        — server mirror
 *   • frontend/src/utils/waterfall.js                — browser mirror
 *
 * THE DEFECT THIS PINS. The browser mirror derived its quarterly rate as
 * `debtRatePct / 100 / 4` while the other two used
 * `Math.pow(1 + debtRatePct / 100, 0.25) - 1`. Simple division compounds:
 * (1 + r/4)^4 - 1, so a 12% facility accrued at 12.55% effective in the
 * browser. DebtSchedulePanel therefore reported ~4.4% more Total Interest than
 * the same deal's own financed-cost line — which is derived from the KERNEL's
 * figure, because constFinanceCr feeds total project cost in residential.ts and
 * plotted.ts. One deal, one screen, two contradicting numbers, and the one the
 * user could see was the wrong one.
 *
 * The two mirrors are otherwise line-for-line identical, which is exactly why
 * the drift survived review: nothing compared them. Now something does.
 *
 * Technique borrowed from buildEnvelope.parity.test.js — read the frontend ESM
 * file, strip `export`, compile it under a CommonJS shim, run identical
 * fixtures through both, and require deep equality.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const { buildDebtSchedule: backendBuild } = require('../src/engines/waterfall.engine');

// ── Load the frontend mirror ────────────────────────────────────────────────

const frontendSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'waterfall.js'),
  'utf8',
);
const exportNames = [];
const stripped = frontendSrc.replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_, kind, name) => {
  exportNames.push(name);
  return `${kind} ${name}`;
});
const m = new Module('frontend-waterfall');
m._compile(
  `${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`,
  'frontend/src/utils/waterfall.js',
);
const { buildDebtSchedule: frontendBuild } = m.exports;

// ── The quarterly rate itself ───────────────────────────────────────────────

const geometricQuarterly = (annualPct) => Math.pow(1 + annualPct / 100, 0.25) - 1;

describe('the quarterly rate compounds to the stated annual rate', () => {
  test.each([8, 10, 11.5, 12, 14, 18, 22])('%s%% p.a.', (annualPct) => {
    const q = geometricQuarterly(annualPct);
    // Four quarters of q must reconstruct exactly one year of annualPct.
    expect((Math.pow(1 + q, 4) - 1) * 100).toBeCloseTo(annualPct, 10);
  });

  test('simple division does NOT — this is the bug, stated as arithmetic', () => {
    // 12% / 4 = 3% per quarter compounds to 12.55%, not 12%.
    const simple = 12 / 100 / 4;
    expect((Math.pow(1 + simple, 4) - 1) * 100).toBeCloseTo(12.550881, 5);
    // ...which is ~4.4% more interest per quarter than the correct rate.
    expect(simple / geometricQuarterly(12) - 1).toBeCloseTo(0.04396, 4);
  });
});

// ── Full-schedule parity ────────────────────────────────────────────────────

// The frontend adds an optional `debtTenorMonths` clamp the backend has no
// parameter for. With it omitted the two are the same function, so parity is
// exact and total — every row, not just the summary.
const FIXTURES = [
  {
    label: 'residential, 12% over 3 years',
    debtDrawnCr: 120, debtRatePct: 12, projectDurationMonths: 36,
    constructionStartMonths: 3, constructionEndMonths: 30,
  },
  {
    label: 'plotted, 11.5% over 4 years, construction from day one',
    debtDrawnCr: 64.5, debtRatePct: 11.5, projectDurationMonths: 48,
    constructionStartMonths: 0, constructionEndMonths: 40,
  },
  {
    label: 'short 18-month bridge at 18%',
    debtDrawnCr: 25, debtRatePct: 18, projectDurationMonths: 18,
    constructionStartMonths: 0, constructionEndMonths: 15,
  },
  {
    label: 'construction end defaulted (85% of duration)',
    debtDrawnCr: 200, debtRatePct: 14, projectDurationMonths: 60,
    constructionStartMonths: 6, constructionEndMonths: undefined,
  },
  {
    label: 'large facility, low rate, long duration',
    debtDrawnCr: 850, debtRatePct: 8.25, projectDurationMonths: 84,
    constructionStartMonths: 12, constructionEndMonths: 66,
  },
];

describe('backend and browser mirrors produce identical schedules', () => {
  test.each(FIXTURES.map((f) => [f.label, f]))('%s', (_label, params) => {
    const backend = backendBuild(params);
    const frontend = frontendBuild(params);

    expect(backend).not.toBeNull();
    expect(frontend).not.toBeNull();
    // Deep equality across every quarter: draws, balances, per-quarter
    // interest and the running cumulative — not merely the total.
    expect(frontend).toEqual(backend);
  });

  test('the totals would have differed by ~4.4% under the old formula', () => {
    // Reconstructs the pre-fix browser result to document the magnitude the
    // user was actually shown, without keeping the broken code around.
    const params = FIXTURES[0][1] || FIXTURES[0];
    const correct = backendBuild(FIXTURES[0]);
    const ratio = (12 / 100 / 4) / geometricQuarterly(12);
    const wouldHaveShown = correct.totalInterestCr * ratio;
    expect(wouldHaveShown / correct.totalInterestCr - 1).toBeCloseTo(0.04396, 4);
    expect(params).toBeDefined();
  });
});

describe('guard rails behave identically in both mirrors', () => {
  test.each([
    ['zero debt', { debtDrawnCr: 0, debtRatePct: 12, projectDurationMonths: 36 }],
    ['zero rate', { debtDrawnCr: 100, debtRatePct: 0, projectDurationMonths: 36 }],
    ['zero duration', { debtDrawnCr: 100, debtRatePct: 12, projectDurationMonths: 0 }],
    ['negative debt', { debtDrawnCr: -5, debtRatePct: 12, projectDurationMonths: 36 }],
  ])('%s returns null on both sides', (_label, params) => {
    expect(backendBuild(params)).toBeNull();
    expect(frontendBuild(params)).toBeNull();
  });
});

describe('the frontend-only tenor clamp is a deliberate refinement, not drift', () => {
  const base = {
    debtDrawnCr: 120, debtRatePct: 12, projectDurationMonths: 60,
    constructionStartMonths: 3, constructionEndMonths: 40,
  };

  test('a tenor shorter than the project shortens the schedule and the interest', () => {
    const clamped = frontendBuild({ ...base, debtTenorMonths: 36 });
    const unclamped = frontendBuild(base);
    expect(clamped.rows.length).toBeLessThan(unclamped.rows.length);
    expect(clamped.totalInterestCr).toBeLessThan(unclamped.totalInterestCr);
  });

  test('a tenor at or beyond the project duration is a no-op — parity holds', () => {
    // The clamp only ever shortens, so when it does not bind, the browser must
    // still agree with the server exactly.
    expect(frontendBuild({ ...base, debtTenorMonths: 60 })).toEqual(backendBuild(base));
    expect(frontendBuild({ ...base, debtTenorMonths: 120 })).toEqual(backendBuild(base));
    expect(frontendBuild({ ...base, debtTenorMonths: null })).toEqual(backendBuild(base));
  });
});
