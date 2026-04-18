/**
 * Mixed-use — routed to the residential model by default (existing REDIP
 * convention). A future iteration should layer income-asset NOI on the
 * commercial portion of the stack; when that lands, replace this adapter
 * with a dedicated weighted-blend implementation.
 */

import type { DealInputs, KernelResult } from '../types';
import { computeResidential } from './residential';

export function computeMixedUse(inputs: DealInputs): KernelResult {
  return computeResidential({ ...inputs, assetClass: 'mixed_use' }, { assetClassOverride: 'mixed_use' });
}
