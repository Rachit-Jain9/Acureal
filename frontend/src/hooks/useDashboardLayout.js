import { useState, useEffect, useCallback } from 'react';

// Source-of-truth widget catalogue. Order = default render order. Anything
// the dashboard knows how to render must appear here so the customize
// popover can toggle / reorder it. Add new widgets at the position you
// want them to land for new users.
export const DEFAULT_WIDGETS = [
  { id: 'kpi_strip',              label: 'KPI strip',                always: true,  defaultVisible: true },
  { id: 'comps_queue_alert',      label: 'Comps queue alert',        always: false, defaultVisible: true },
  // Today's Attention — specific item-level signals (overdue DD,
  // expiring approvals, recent risks, stale deals). Sits right under
  // the KPI / alert row because "what should I do today?" is the very
  // first question a deal lead lands on the dashboard to answer.
  { id: 'attention_panel',        label: "Today's Attention",        always: false, defaultVisible: true },
  // Portfolio Risk Radar — workspace-level rollup of every live deal's
  // posture. Sits under the Attention panel: the radar gives the
  // aggregate view, Attention gives the per-item view.
  { id: 'portfolio_risk_radar',   label: 'Portfolio Risk Radar',     always: false, defaultVisible: true },
  { id: 'pipeline_chart',         label: 'Pipeline distribution',    always: false, defaultVisible: true },
  { id: 'cities_chart',           label: 'City distribution',        always: false, defaultVisible: true },
  { id: 'recent_activities',      label: 'Recent activities',        always: false, defaultVisible: true },
  { id: 'top_deals_irr',          label: 'Top deals by IRR',         always: false, defaultVisible: true },
  { id: 'ai_cost_summary',        label: 'AI cost today',            always: false, defaultVisible: true },
  { id: 'audit_trail_tail',       label: 'Recent audit events',      always: false, defaultVisible: false },
];

const STORAGE_KEY = 'redip.dashboard.layout';

const defaultLayout = () =>
  DEFAULT_WIDGETS.map((w) => ({ id: w.id, visible: w.defaultVisible }));

const safeRead = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Validate every entry references a known widget id.
    const known = new Set(DEFAULT_WIDGETS.map((w) => w.id));
    return parsed.filter((entry) => entry && typeof entry.id === 'string' && known.has(entry.id));
  } catch {
    return null;
  }
};

// Reconcile a stored layout with the catalogue:
//   1. Drop ids that no longer exist (catalogue shrank between sessions).
//   2. Preserve the user's stored order and visibility for widgets they
//      already had — their customization wins.
//   3. Insert any NEW widget at its natural catalogue position relative
//      to widgets the user already has, instead of dumping every new
//      one at the bottom. Concretely: each new widget is placed just
//      after the most-recent catalogue-prior widget that's also in the
//      merged list. So a brand-new "Portfolio Risk Radar" defined in
//      the catalogue between Comps-Queue and Pipeline lands between
//      them in the user's existing dashboard too — not at the bottom
//      where they'd have to scroll past every other tile to find it.
const reconcile = (stored) => {
  if (!stored) return defaultLayout();
  const known = new Set(DEFAULT_WIDGETS.map((w) => w.id));
  // Drop unknown ids first.
  const filtered = stored.filter((e) => e && known.has(e.id));
  const seen = new Set(filtered.map((e) => e.id));

  // Preserve stored order + visibility. Always-on widgets force visible.
  const merged = filtered.map((entry) => {
    const widget = DEFAULT_WIDGETS.find((w) => w.id === entry.id);
    return {
      id: entry.id,
      visible: widget?.always ? true : Boolean(entry.visible),
    };
  });

  // Smart insertion for new widgets: walk the catalogue in order. For
  // each new (unseen) widget, find the most-recent catalogue-prior
  // widget that's already in `merged` and insert just after it. If
  // there's no such anchor (the new widget is catalogue-first among
  // the merged set), insert at index 0.
  for (let i = 0; i < DEFAULT_WIDGETS.length; i += 1) {
    const w = DEFAULT_WIDGETS[i];
    if (seen.has(w.id)) continue;
    let anchorIdx = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const prevId = DEFAULT_WIDGETS[j].id;
      const idx = merged.findIndex((e) => e.id === prevId);
      if (idx >= 0) {
        anchorIdx = idx;
        break;
      }
    }
    merged.splice(anchorIdx + 1, 0, { id: w.id, visible: w.defaultVisible });
    seen.add(w.id);
  }

  return merged;
};

/**
 * Per-user dashboard widget layout (visibility + order) backed by
 * localStorage. Returns:
 *   { layout, toggleVisible(id), moveUp(id), moveDown(id), reset() }
 *
 * `layout` is an ordered list of `{ id, visible }`. The dashboard
 * page renders widgets in this order; non-visible widgets are skipped.
 *
 * The customize popover uses `toggleVisible` + `moveUp` / `moveDown`
 * for in-place edits. `reset()` returns to DEFAULT_WIDGETS.
 *
 * Why localStorage and not the server: layout preferences are
 * per-device (the dashboard you want on a 13" laptop differs from the
 * one on a 27" monitor), tiny, and not worth a round-trip. If the
 * preference needs to follow a user across devices later, this hook
 * is the only place to swap the storage backend.
 */
export function useDashboardLayout() {
  const [layout, setLayout] = useState(() => reconcile(safeRead()));

  // Persist on every change. No debouncing — these are single-keystroke
  // events from the customize popover; the cost is negligible.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* localStorage may be disabled — silently no-op */
    }
  }, [layout]);

  const toggleVisible = useCallback((id) => {
    const widget = DEFAULT_WIDGETS.find((w) => w.id === id);
    if (widget?.always) return; // always-on widgets refuse to hide
    setLayout((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, visible: !entry.visible } : entry,
      ),
    );
  }, []);

  const move = useCallback((id, delta) => {
    setLayout((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const moveUp = useCallback((id) => move(id, -1), [move]);
  const moveDown = useCallback((id) => move(id, +1), [move]);

  const reset = useCallback(() => {
    setLayout(defaultLayout());
  }, []);

  return { layout, toggleVisible, moveUp, moveDown, reset };
}

// Helpers exported for tests + the dashboard page renderer.
export { defaultLayout, reconcile, STORAGE_KEY };
