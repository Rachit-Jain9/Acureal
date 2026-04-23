/**
 * Browser-safe re-export of the financial kernel.
 *
 * The top-level `index.ts` pulls in the investor-package HTTP handler
 * (`./api`) and the full orchestration/postprocess suite — those are fine
 * for Node but bloat the Vite bundle. This entry re-exports only the
 * functions the frontend's live what-if recompute needs, so the client
 * bundle stays small.
 *
 * Kept in sync with the server-side `/financials/quick-compute` route
 * (backend/src/routes/financial.routes.js): both call `computeDeal`
 * against the same kernel, so client and server results are byte-for-
 * byte identical by construction.
 */

export {
  computeDeal,
  isSupportedAssetClass,
  SUPPORTED_ASSET_CLASSES,
} from './registry';
export type { ComputeDealOptions } from './registry';

export { DealInputError } from './inputSchema';
export type { NormalizedRaw, NormalizedDeal } from './inputSchema';

export { Decimal } from './decimal';

export type {
  AssetClass,
  AreaBreakdown,
  CostBreakdown,
  DealInputs,
  KPISet,
  KernelResult,
  RevenueBreakdown,
} from './types';
