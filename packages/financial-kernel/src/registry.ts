/**
 * Asset-class dispatcher. `computeDeal` is the single kernel entry point;
 * it picks the right adapter and returns a canonical `KernelResult`.
 */

import type { AssetClass, AssumptionSet, DealInputs, KernelResult } from './types';
import { computeResidential } from './assets/residential';
import { computePlotted } from './assets/plotted';
import { computeIncomeAsset } from './assets/income';
import { computeHospitality } from './assets/hospitality';
import { computeLandParcel } from './assets/land_parcel';
import { computeVillas } from './assets/villas';
import { computeMixedUse } from './assets/mixed_use';
import { computeRedevelopment } from './assets/redevelopment';
import { normalizedDealInputs } from './inputSchema';

export const SUPPORTED_ASSET_CLASSES: readonly AssetClass[] = Object.freeze([
  'residential_apartments',
  'plotted_development',
  'commercial_office',
  'retail',
  'industrial_warehousing',
  'hospitality',
  'mixed_use',
  'land_parcel',
  'villas',
  'redevelopment',
]);

export function isSupportedAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && (SUPPORTED_ASSET_CLASSES as readonly string[]).includes(value);
}

export interface ComputeDealOptions {
  /** Scenario-layer overrides applied on top of the deal's own inputs. */
  readonly scenarioOverrides?: AssumptionSet;
  /**
   * When true, skip the normalize-and-validate step. Used by the golden
   * tests that construct fixtures directly in canonical form. Production
   * callers should leave this off.
   */
  readonly skipNormalization?: boolean;
}

export function computeDeal(inputs: DealInputs, options: ComputeDealOptions = {}): KernelResult {
  const normalized = options.skipNormalization
    ? inputs
    : normalizedDealInputs(inputs, options.scenarioOverrides);
  switch (normalized.assetClass) {
    case 'residential_apartments':
      return computeResidential(normalized);
    case 'plotted_development':
      return computePlotted(normalized);
    case 'commercial_office':
      return computeIncomeAsset(normalized, { assetClass: 'commercial_office' });
    case 'retail':
      return computeIncomeAsset(normalized, { assetClass: 'retail' });
    case 'industrial_warehousing':
      return computeIncomeAsset(normalized, { assetClass: 'industrial_warehousing' });
    case 'hospitality':
      return computeHospitality(normalized);
    case 'mixed_use':
      return computeMixedUse(normalized);
    case 'land_parcel':
      return computeLandParcel(normalized);
    case 'villas':
      return computeVillas(normalized);
    case 'redevelopment':
      return computeRedevelopment(normalized);
    default: {
      const _exhaustive: never = normalized.assetClass;
      throw new Error(`Unsupported assetClass: ${String(_exhaustive)}`);
    }
  }
}
