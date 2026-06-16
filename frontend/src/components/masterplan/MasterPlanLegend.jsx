import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import clsx from 'clsx';
import { RMP2015_LANDUSE_LEGEND, RMP2015_LEGEND_SOURCE } from '../../utils/cadastralLayers';

/**
 * MasterPlanLegend — the colour key for the BDA RMP 2015 Proposed-Land-Use
 * overlay. Reads the source-verified `RMP2015_LANDUSE_LEGEND` (transcribed
 * from the official BDA Consolidated Map legend + Zoning Regulations) so the
 * swatches are a true key, never an invented mapping.
 *
 * Purely presentational. Two shapes:
 *   • `collapsible` (default) — self-contained, with its own header + chevron,
 *     for the Master Plan Explorer.
 *   • `collapsible={false}` — renders just the body, for embedding in a panel
 *     that owns its own open/close (the deal map's layer panel).
 *
 * Categories show first (the nine statutory zones); a "sub-zones" toggle
 * reveals the finer shades the map distinguishes. A muted source line keeps
 * the reference / "verify against the official sheet" caveat present.
 */

function Swatch({ color, className }) {
  return (
    <span
      aria-hidden="true"
      className={clsx('shrink-0 rounded-[3px] border border-black/15 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.25)]', className)}
      style={{ backgroundColor: color }}
    />
  );
}

function LegendBody({ compact }) {
  const [showSub, setShowSub] = useState(false);
  const hasSub = RMP2015_LANDUSE_LEGEND.some((g) => g.subzones?.length);

  return (
    <div className={clsx(compact ? 'px-2.5 py-2' : 'px-3 py-2.5')}>
      <ul className="space-y-1.5">
        {RMP2015_LANDUSE_LEGEND.map((group) => (
          <li key={group.code}>
            <div className="flex items-center gap-2">
              <Swatch color={group.color} className="h-3 w-3" />
              <span className="flex-1 truncate text-[11px] font-medium text-content-primary">
                {group.category}
              </span>
              <span className="shrink-0 rounded bg-bg-secondary px-1 py-px text-[9px] font-semibold tabular-nums text-content-muted">
                {group.code}
              </span>
            </div>

            {showSub && group.subzones?.length > 0 && (
              <ul className="mt-1 space-y-0.5 pl-5">
                {group.subzones.map((s) => (
                  <li key={s.label} className="flex items-center gap-1.5">
                    <Swatch color={s.color} className="h-2 w-2" />
                    <span className="truncate text-[10px] leading-snug text-content-secondary">
                      {s.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {hasSub && (
        <button
          type="button"
          onClick={() => setShowSub((v) => !v)}
          aria-pressed={showSub}
          className="mt-2 inline-flex items-center gap-1 rounded text-[10px] font-medium text-accent transition-colors duration-150 ease-out hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
        >
          <ChevronDown
            size={11}
            aria-hidden="true"
            className={clsx('transition-transform duration-200 ease-out motion-reduce:transition-none', showSub && 'rotate-180')}
          />
          {showSub ? 'Hide sub-zones' : 'Show sub-zones'}
        </button>
      )}

      <p className="mt-2 flex items-start gap-1 border-t border-hairline-soft pt-2 text-[9.5px] leading-snug text-content-muted">
        <Info size={10} className="mt-px shrink-0" aria-hidden="true" />
        <span>{RMP2015_LEGEND_SOURCE}</span>
      </p>
    </div>
  );
}

export default function MasterPlanLegend({
  collapsible = true,
  defaultOpen = true,
  compact = false,
  className = '',
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return <LegendBody compact={compact} />;
  }

  return (
    <div
      className={clsx(
        'overflow-hidden rounded-editorial border border-hairline bg-bg-elevated/95 shadow-sm backdrop-blur-sm',
        className,
      )}
      data-testid="master-plan-legend"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/40"
      >
        <span className="text-[11px] font-semibold text-content-primary">Land-use legend</span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={clsx('text-content-muted transition-transform duration-200 ease-out motion-reduce:transition-none', open && 'rotate-180')}
        />
      </button>
      <div
        className={clsx(
          'overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none',
          open ? 'max-h-[520px] opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="border-t border-hairline-soft">
          <LegendBody compact={compact} />
        </div>
      </div>
    </div>
  );
}
