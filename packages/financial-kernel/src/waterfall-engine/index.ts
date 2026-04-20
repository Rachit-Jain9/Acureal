/**
 * @redip/financial-kernel/waterfall-engine
 *
 * Skeleton waterfall: tiered cash allocation with pari-passu within
 * priority, debt-before-equity ordering, and structure hooks for JDA,
 * JV, and out-right deals.
 */

export { runWaterfall } from './engine';
export { buildPrefCatchPromoteTiers, sumStakeholder } from './pref_catch_promote';
export type { PrefCatchPromoteArgs } from './pref_catch_promote';
export type {
  AllocationHook,
  AllocationHookInput,
  AllocationHookOutput,
  DealStructure,
  DemandFn,
  Stakeholder,
  TierDemandContext,
  TierKind,
  WaterfallAllocationRow,
  WaterfallContext,
  WaterfallInputs,
  WaterfallOutputs,
  WaterfallTier,
} from './types';
