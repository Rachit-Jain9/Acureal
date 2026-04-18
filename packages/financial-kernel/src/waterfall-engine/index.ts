/**
 * @redip/financial-kernel/waterfall-engine
 *
 * Skeleton waterfall: tiered cash allocation with pari-passu within
 * priority, debt-before-equity ordering, and structure hooks for JDA,
 * JV, and out-right deals.
 */

export { runWaterfall } from './engine';
export type {
  AllocationHook,
  AllocationHookInput,
  AllocationHookOutput,
  DealStructure,
  Stakeholder,
  TierKind,
  WaterfallAllocationRow,
  WaterfallContext,
  WaterfallInputs,
  WaterfallOutputs,
  WaterfallTier,
} from './types';
