/**
 * Villas — residential model with defaults tuned for villa builds
 * (lower FSI, lower loading, higher per-sqft rate). Delegates to the
 * residential implementation so math stays in one place.
 */

import type { DealInputs, KernelResult } from '../types';
import { computeResidential } from './residential';

export function computeVillas(inputs: DealInputs): KernelResult {
  const raw = { ...inputs.raw };
  if (raw.loadingFactor == null) raw.loadingFactor = 0.05;
  if (raw.fsi == null) raw.fsi = 0.8;
  return computeResidential({ ...inputs, raw, assetClass: 'villas' }, { assetClassOverride: 'villas' });
}
