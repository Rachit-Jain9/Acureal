import { useMemo } from 'react';
import { AlertTriangle, ShieldAlert, MapPin } from 'lucide-react';
import Badge from '../common/Badge';
import useAutoDeriveParcelContext from '../../hooks/useAutoDeriveParcelContext';

/**
 * DealAutoDerivedWarningsStrip — surfaces the city-level callouts
 * (heritage proximity, NGT drainage buffer, SDZ corridor, PRR alignment,
 * regional parks) that the auto-derive orchestrator returns, on the
 * deal Overview tab.
 *
 * Stops the IC failure mode noted in this autonomous-window plan:
 * "we discovered the parcel was inside a heritage zone at IC."
 *
 * Renders nothing when there's no derivable input (no lat/lng AND no
 * address) — no empty-state noise. Auto-fires the same shared hook the
 * AutoFillParcelContextCard uses, so when the user already clicked
 * Derive on the Parcel tab, the cache makes this card instant.
 *
 * Per the editorial-not-tacky bar: warnings appear as a calm row of
 * `Badge tone="warn"` chips, never a saturated full-tile fill. Each
 * chip is keyboard-navigable; the rendered list keeps to 4 visible
 * chips + a "+N more" overflow rather than scrolling sideways.
 */
export default function DealAutoDerivedWarningsStrip({ deal }) {
  const address = deal?.property_address || deal?.address || null;
  const lat = deal?.lat ?? null;
  const lng = deal?.lng ?? null;
  const hasInput = (typeof address === 'string' && address.trim().length > 0) || (lat != null && lng != null);
  const isBengaluru = /beng|bang/i.test(String(deal?.city || ''));

  // Auto-fire only for Bengaluru deals with at least one input. Non-BLR
  // deals don't have city-level callouts in our evidence_facts yet.
  const { data } = useAutoDeriveParcelContext({
    address,
    lat,
    lng,
    enabled: hasInput && isBengaluru,
  });

  const warnings = useMemo(() => Array.isArray(data?.applicableWarnings) ? data.applicableWarnings : [], [data]);

  // Render nothing when there's no input to derive from, or when the
  // payload returned no callouts (also no callouts to verify against).
  if (!hasInput || !isBengaluru || warnings.length === 0) return null;

  const visibleCount = 4;
  const visible = warnings.slice(0, visibleCount);
  const overflow = warnings.length - visible.length;

  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3"
      data-testid="deal-warnings-strip"
    >
      <ShieldAlert size={16} className="text-amber-700 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-900">
            City-level callouts to verify against this parcel
          </span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-medium shrink-0">
            AI-assisted
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {visible.map((w, i) => (
            <button
              key={`${w.fact_type}-${w.fact_key}-${i}`}
              type="button"
              title={w.message || w.kind}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-bg-elevated border border-amber-200 text-amber-900 hover:bg-amber-100 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 active:scale-[0.98]"
            >
              <AlertTriangle size={11} aria-hidden="true" />
              <span className="font-medium">{w.kind}</span>
              {w.item_count > 1 && (
                <span className="text-amber-700 tabular-nums">({w.item_count})</span>
              )}
            </button>
          ))}
          {overflow > 0 && (
            <Badge tone="warn" className="!text-[11px]">
              +{overflow} more
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-amber-800 mt-1.5">
          <MapPin size={10} className="inline mr-1 -mt-0.5" aria-hidden="true" />
          Each callout is a city-wide fact, not a spatial intersection — verify against the parcel's location on the Parcel tab before quoting in IC memos.
        </p>
      </div>
    </div>
  );
}
