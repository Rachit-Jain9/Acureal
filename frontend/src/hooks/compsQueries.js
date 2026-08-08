/**
 * Centralized invalidation for everything a COMP write can change.
 *
 * Mirrors the `dealPostureQueries.js` convention, and exists for the same
 * reason: the surfaces a comp feeds are spread across the app, and every
 * mutation hook listing them inline is a guarantee that one of them drifts.
 *
 * Before this, `useCreateComp`, `useDeleteComp` and both review-queue approve
 * hooks invalidated exactly `['comps']`. So verifying a Whitefield comp
 * updated the Comps table and NOTHING else: the Financials sell-rate warning
 * still compared against the old band, the deal's Comps tab still showed the
 * old ranked set, and the IC-readiness "comps validated" bucket still counted
 * the old evidence. The user's own action appeared to have no effect on the
 * screens that action exists to change.
 *
 * WHY PREFIX-ONLY KEYS. A comp is not deal-scoped — which deals it affects is
 * a geographic question (is this comp within 5 km of that site?) that the
 * client cannot answer without the server. So these invalidate the whole
 * prefix rather than a `[key, dealId]` pair. React-Query matches by key
 * prefix, so `['benchmark-bands']` reaches every `['benchmark-bands', id]`.
 *
 * NOTE `deal-workspace` and `deal-workspace-lite` are listed SEPARATELY and
 * deliberately: they are sibling keys, not a prefix pair, so invalidating the
 * first does not reach the second.
 *
 * RESIDUAL, stated honestly: the server-side workspace cache fingerprints
 * per-deal tables, and comps are intentionally NOT among them
 * (dealWorkspaceCache.service.js) — a geo-scoped fingerprint would cost a
 * PostGIS scan on every workspace read. So the IC-readiness comps bucket can
 * still lag by up to that cache's 120-second TTL. Everything else here is
 * immediate.
 */
const COMPS_DEPENDENT_KEYS = [
  'comps',              // the Comps table itself
  'benchmark-bands',    // useBenchmarkBands — the Financials sell-rate warning
  'comps-benchmark',    // CompsTab — benchmark strip
  'comps-ranked',       // CompsTab — ranked nearby set
  'deal-workspace',     // ic_readiness comps bucket, market slice
  'deal-workspace-lite',
];

export function invalidateCompsDependents(queryClient) {
  for (const key of COMPS_DEPENDENT_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export { COMPS_DEPENDENT_KEYS };
