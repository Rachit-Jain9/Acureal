/**
 * Asset-class dispatcher. `computeDeal` is the single kernel entry point;
 * it picks the right adapter and returns a canonical `KernelResult`.
 */

import type { AssetClass, DealInputs, KernelResult } from './types';
import { computeResidential } from './assets/residential';
import { computePlotted } from './assets/plotted';
import { computeIncomeAsset } from './assets/income';
import { computeHospitality } from './assets/hospitality';
import { computeLandParcel } from './assets/land_parcel';
import { computeVillas } from './assets/villas';
import { computeMixedUse } from './assets/mixed_use';
import { computeRedevelopment } from './assets/redevelopment';

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

export function computeDeal(inputs: DealInputs): KernelResult {
  switch (inputs.assetClass) {
    case 'residential_apartments':
      return computeResidential(inputs);
    case 'plotted_development':
      return computePlotted(inputs);
    case 'commercial_office':
      return computeIncomeAsset(inputs, { assetClass: 'commercial_office' });
    case 'retail':
      return computeIncomeAsset(inputs, { assetClass: 'retail' });
    case 'industrial_warehousing':
      return computeIncomeAsset(inputs, { assetClass: 'industrial_warehousing' });
    case 'hospitality':
      return computeHospitality(inputs);
    case 'mixed_use':
      return computeMixedUse(inputs);
    case 'land_parcel':
      return computeLandParcel(inputs);
    case 'villas':
      return computeVillas(inputs);
    case 'redevelopment':
      return computeRedevelopment(inputs);
    default: {
      const _exhaustive: never = inputs.assetClass;
      throw new Error(`Unsupported assetClass: ${String(_exhaustive)}`);
    }
  }
}
