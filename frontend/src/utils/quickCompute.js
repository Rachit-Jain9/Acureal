import { clientQuickCompute, useClientKernel } from './clientKernel';
import { financialsAPI } from '../services/api';

// Single source of truth for a stateless "quick-compute" pass (what-if
// sliders, sensitivity tornado, scenario comparison). Routes to the
// in-browser kernel by default (zero HTTP round-trip, identical results by
// construction — see clientKernel.js) and to the server `/financials/
// quick-compute` endpoint only when VITE_CLIENT_KERNEL=0.
//
// Returns the unwrapped data object `{ assetClass, engineVersion, kpis,
// costs, revenue, areas }` — callers read `result.kpis` regardless of path.
// On failure throws an axios-shaped error (`err.response.data.message`) so
// every caller's existing `.catch` keeps working unchanged.
//
// Why this matters beyond DRY: the server endpoint is gated to
// admin|analyst, so any read-only (viewer) member hitting it gets a 403.
// Routing read-only what-if/sensitivity/scenario compute through the client
// kernel lets viewers see the full analytical surface AND removes a fan-out
// of server round-trips on every financials page load for everyone else.
export async function runQuickCompute(payload) {
  if (useClientKernel()) {
    const resp = clientQuickCompute(payload);
    if (resp.success) return resp.data;
    // Shape the rejection like an axios error so downstream error handling
    // (which reads err.response.data.message) stays uniform across paths.
    const err = new Error(resp.message);
    err.response = { status: resp.status, data: { message: resp.message } };
    throw err;
  }
  const r = await financialsAPI.quickCompute(payload);
  return r.data.data;
}

export default runQuickCompute;
