import { describe, it, expect } from 'vitest';
import { DEFAULT_VALUES } from '../fieldDefs';
// The kernel's single source of truth for cited benchmark defaults. Imported
// straight from source — vitest compiles the kernel TypeScript the same way
// the app does via the @redip/kernel-browser alias.
import { getDefaultMeta } from '../../../../../packages/financial-kernel/src/config/defaults';

/**
 * Contract test — the financial form's default seeds vs. the kernel's cited
 * benchmark registry.
 *
 * `fieldDefs.DEFAULT_VALUES` only pre-fills the form; the authoritative,
 * citation-carrying defaults live in the kernel
 * (packages/financial-kernel/src/config/defaults.ts). When a seed drifts from
 * the registry the form pre-fills a number the kernel does not endorse — and
 * the Provenance Spine (Model Confidence, Confidence Range, the IC-memo
 * Evidence Ledger) then mistakes an unconsidered default for a deliberate
 * analyst choice. This test locks every comparable seed to the registry so
 * that class of drift can never silently return.
 *
 * Each CONTRACT entry: form key -> { kernelKey, transform? }. `transform`
 * adapts a unit difference (the form holds project duration in years; the
 * kernel in months).
 *
 * Deliberately NOT contracted — no clean, same-concept, same-unit kernel
 * counterpart; documented so a future maintainer does not "fix" the gap:
 *   - gstPct          — kernel key is gstOnConstructionPct; a statutory,
 *                       asset-specific rate, not a confidence driver.
 *   - devCostPerSqft  — the form figure is per total land; the kernel's
 *                       developmentCostPerSqft is per saleable sqft.
 *   - tiPerSqft       — kernel tiAllowancePerSqft exists only for office.
 *   - entryCapRate    — the kernel global entryCapRatePct is a back-solve
 *                       convention, not an asset-tuned default.
 *   - holdPeriodYears — the form and kernel disagree for retail/industrial;
 *                       resolving needs a market-data decision on adding
 *                       per-asset kernel overrides (out of scope for a
 *                       form-only change).
 *   - debtLTV / debtRatePct / debtCoverage / interestRatePct / lrd* /
 *     pricingEscalationPct / constructionStart|EndMonths / avgPlotSizeSqft /
 *     terminalValue* / exitMultiple / perpetuityGrowthPct / exitStrategy —
 *     financing-structure or UI knobs with no registry counterpart.
 */

const CONTRACT = {
  loadingFactor: { kernelKey: 'loadingFactor' },
  marketingCostPct: { kernelKey: 'marketingCostPct' },
  financeCostPct: { kernelKey: 'financeCostPct' },
  developerMarginPct: { kernelKey: 'developerMarginPct' },
  contingencyPct: { kernelKey: 'contingencyPct' },
  architectFeePct: { kernelKey: 'architectFeePct' },
  pmcFeePct: { kernelKey: 'pmcFeePct' },
  discountRatePct: { kernelKey: 'discountRatePct' },
  vacancyPct: { kernelKey: 'vacancyPct' },
  opexPct: { kernelKey: 'opexPct' },
  rentEscalationPct: { kernelKey: 'rentEscalationPct' },
  saleableLandPct: { kernelKey: 'saleableLandPct' },
  anchorPct: { kernelKey: 'anchorPct' },
  anchorRentDiscount: { kernelKey: 'anchorRentDiscount' },
  exitCapRate: { kernelKey: 'exitCapRatePct' },
  stabilizedOccPct: { kernelKey: 'stabilizedOccPct' },
  adrGrowthPct: { kernelKey: 'adrGrowthPct' },
  fbRevPct: { kernelKey: 'fbRevPct' },
  otherRevPct: { kernelKey: 'otherRevPct' },
  gopMarginPct: { kernelKey: 'gopMarginPct' },
  ebitdaMarginPct: { kernelKey: 'ebitdaMarginPct' },
  projectDurationYears: { kernelKey: 'projectDurationMonths', transform: (y) => y * 12 },
};

// The kernel's effective default for (class, key), or null when the registry
// has no such key for that class (getDefaultMeta throws on an unknown key).
const kernelValueOrNull = (cls, kernelKey) => {
  try {
    const meta = getDefaultMeta(cls, kernelKey);
    return typeof meta?.value === 'number' ? meta.value : null;
  } catch {
    return null;
  }
};

describe('fieldDefs DEFAULT_VALUES ↔ kernel benchmark registry', () => {
  it('keeps every contracted form seed in lock-step with the kernel registry', () => {
    const mismatches = [];
    let checked = 0;

    for (const [cls, defaults] of Object.entries(DEFAULT_VALUES)) {
      for (const [formKey, rawSeed] of Object.entries(defaults)) {
        const contract = CONTRACT[formKey];
        if (!contract) continue;
        const kernelValue = kernelValueOrNull(cls, contract.kernelKey);
        if (kernelValue === null) continue; // no registry counterpart for this class
        const transform = contract.transform || ((v) => v);
        const seed = transform(Number(rawSeed));
        checked += 1;
        if (!Number.isFinite(seed) || Math.abs(seed - kernelValue) > 1e-9) {
          mismatches.push(
            `${cls}.${formKey}: form seed ${seed} != kernel `
            + `${contract.kernelKey} ${kernelValue}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
    // Guard against the contract silently checking nothing (e.g. a renamed key).
    expect(checked).toBeGreaterThan(15);
  });
});
