import { useState, useEffect, useCallback } from 'react';

// Source-of-truth widget catalogue. Order = default render order. Anything
// the dashboard knows how to render must appear here so the customize
// popover can toggle / reorder it. Add new widgets at the position you
// want them to land for new users.
export const DEFAULT_WIDGETS = [
  { id: 'kpi_strip',              label: 'KPI strip',                always: true,  defaultVisible: true },
  { id: 'comps_queue_alert',      label: 'Comps queue alert',        always: false, defaultVisible: true },
  // Portfolio Risk Radar — workspace-level rollup of every live deal's
  // posture. Lives near the top of the dashboard because "which deals need
  // IC attention" is the question an investment lead opens REDIP to answer.
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

// Reconcile a stored layout with the catalogue: drop ids that no longer
// exist, append any new widgets at the end so the user gets them but
// keeps their existing ordering.
const reconcile = (stored) => {
  if (!stored) return defaultLayout();
  const known = new Set(DEFAULT_WIDGETS.map((w) => w.id));
  // Drop unknown ids (catalogue may have shrunk between sessions).
  const filtered = stored.filter((e) => e && known.has(e.id));
  const seen = new Set(filtered.map((e) => e.id));
  const reconciled = filtered.map((entry) => {
    const widget = DEFAULT_WIDGETS.find((w) => w.id === entry.id);
    return {
      id: entry.id,
      // Always-on widgets force visible regardless of stored value.
      visible: widget?.always ? true : Boolean(entry.visible),
    };
  });
  // Append any new widgets the catalogue knows about that the stored
  // layout doesn't. They land with their default-visibility.
  for (const widget of DEFAULT_WIDGETS) {
    if (!seen.has(widget.id)) {
      reconciled.push({ id: widget.id, visible: widget.defaultVisible });
    }
  }
  return reconciled;
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
