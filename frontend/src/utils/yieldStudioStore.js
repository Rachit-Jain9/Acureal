// Per-deal local persistence for a Yield Studio study (envelope + assumptions).
//
// The study is the analyst's working scratch — not deal-of-record data — so it
// lives in localStorage, keyed by deal, and survives reloads/revisits within
// the browser without a backend write. The committed output already flows to
// the deal via "Apply to Financials"; server-side persistence of the study
// itself arrives with the parcel_geometries / site_plans migration (Walk tier).
//
// All access is guarded so private mode / disabled storage degrades to "no
// draft" rather than throwing.

const keyFor = (dealId) => `redip:yieldstudio:${dealId}`;

export function loadYieldStudy(dealId) {
  if (!dealId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(keyFor(dealId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveYieldStudy(dealId, data) {
  if (!dealId || !data || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(keyFor(dealId), JSON.stringify(data));
  } catch {
    /* quota / private mode — drop silently */
  }
}

export function clearYieldStudy(dealId) {
  if (!dealId || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(keyFor(dealId));
  } catch {
    /* ignore */
  }
}
