import { describe, it, expect } from 'vitest';
import * as frontendAssetClasses from '../assetClasses';
import backendAssetClasses from '../../../../backend/src/constants/assetClasses.js';
import ontology from '@redip/real-estate-ontology';
import { SUPPORTED_ASSET_CLASSES } from '../../../../packages/financial-kernel/src/config/defaults';

/**
 * Contract test — Workstream F (foundations).
 *
 * The asset-class taxonomy is independently declared in THREE places:
 *   1. backend/src/constants/assetClasses.js  — the server enum + validation
 *   2. frontend/src/utils/assetClasses.js     — the deal-form options
 *   3. packages/real-estate-ontology/v1.json  — the canonical taxonomy
 *
 * The two assetClasses.js files are byte-identical today, and all three agree
 * on the asset-class key set — but nothing stops them drifting apart. This
 * test makes drift impossible: a divergence fails CI with a precise diff.
 *
 * Labels intentionally differ — assetClasses.js carries clean dropdown labels
 * ("Hospitality"), the ontology carries descriptive taxonomy labels
 * ("Hospitality (hotel)") — so only the KEY SET is contracted against the
 * ontology. The two assetClasses.js files, being a true duplicate, are
 * contracted in full: they must stay identical.
 */

const backendConfig = backendAssetClasses.ASSET_CLASS_CONFIG
  || backendAssetClasses.default?.ASSET_CLASS_CONFIG;

describe('asset-class taxonomy — cross-source contract', () => {
  it('keeps backend and frontend ASSET_CLASS_CONFIG byte-identical', () => {
    expect(Array.isArray(backendConfig)).toBe(true);
    expect(frontendAssetClasses.ASSET_CLASS_CONFIG).toEqual(backendConfig);
  });

  it('matches the canonical ontology asset-class key set', () => {
    const configKeys = frontendAssetClasses.ASSET_CLASS_CONFIG
      .map((c) => c.value)
      .sort();
    const ontologyKeys = ontology.asset_class.values
      .map((c) => c.key)
      .sort();
    expect(configKeys).toEqual(ontologyKeys);
  });

  it('maps every asset class to a financial-model class the kernel supports', () => {
    const kernelClasses = new Set(SUPPORTED_ASSET_CLASSES);
    const orphans = frontendAssetClasses.ASSET_CLASS_CONFIG
      .filter((c) => !kernelClasses.has(c.financialModelClass))
      .map((c) => `${c.value} -> ${c.financialModelClass}`);
    expect(orphans).toEqual([]);
  });

  it('resolves every asset class through resolveFinancialModelClass', () => {
    for (const entry of frontendAssetClasses.ASSET_CLASS_CONFIG) {
      expect(frontendAssetClasses.resolveFinancialModelClass(entry.value)).toBe(
        entry.financialModelClass,
      );
    }
  });
});
