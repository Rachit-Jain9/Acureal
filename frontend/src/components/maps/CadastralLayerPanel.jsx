import { useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import clsx from 'clsx';
import MasterPlanLegend from '../masterplan/MasterPlanLegend';

/**
 * CadastralLayerPanel — Workstream E1 (the spatial canvas).
 *
 * The single, honest layer control for the deal map. It replaces the
 * scattered, unlabelled corner toggles with one collapsible panel that
 * names every layer, lets the analyst switch the ones that are
 * switchable, and — critically — states where each layer's data comes
 * from. A teal outline is no longer a mystery: the legend says it is the
 * K-GIS cadastral atlas polygon, or honestly says no polygon exists.
 *
 * Purely presentational. It renders the descriptor produced by
 * `buildCadastralLayers` and calls back up for the two interactive
 * layers (basemap selection, zoning toggle); ReadOnlyPropertyMap still
 * owns the state.
 */

const TONE_BADGE = {
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  approximate: 'bg-amber-50 text-amber-800 border-amber-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  muted: 'bg-bg-secondary text-content-secondary border-hairline',
};

function Swatch({ swatch }) {
  if (!swatch) return null;
  let style;
  if (swatch.type === 'gradient') {
    style = { background: `linear-gradient(135deg, ${swatch.colors.join(', ')})` };
  } else if (swatch.type === 'raster') {
    // A small multi-band chip suggesting a land-use raster (yellow=residential,
    // red=commercial, purple=public, green=open — purely indicative).
    style = {
      background:
        'linear-gradient(135deg, #fde68a 0 25%, #fca5a5 25% 50%, #c4b5fd 50% 75%, #86efac 75% 100%)',
    };
  } else {
    style = { backgroundColor: swatch.color };
  }
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 h-3 w-3 shrink-0 rounded-sm border border-black/10"
      style={style}
    />
  );
}

function StatusBadge({ tone, label }) {
  return (
    <span
      className={clsx(
        'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]',
        TONE_BADGE[tone] || TONE_BADGE.muted,
      )}
    >
      {label}
    </span>
  );
}

// A row for the two non-interactive data layers (cadastral boundary,
// parcel pin): swatch, label, status badge, then the provenance line.
function DataLayerRow({ layer }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Swatch swatch={layer.swatch} />
          <span className="text-[11px] font-semibold text-content-primary leading-tight">
            {layer.label}
          </span>
        </div>
        <StatusBadge tone={layer.tone} label={layer.statusLabel} />
      </div>
      <p className="text-[10px] leading-snug text-content-muted">{layer.provenance}</p>
    </div>
  );
}

// The basemap row — a segmented Streets / Satellite selector.
function BasemapRow({ layer, onBasemapChange }) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-content-primary">{layer.label}</span>
        <div
          role="tablist"
          aria-label="Base map"
          className="inline-flex rounded border border-hairline bg-bg-secondary p-0.5"
        >
          {layer.options.map((opt) => {
            const isActive = layer.active === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onBasemapChange?.(opt.value)}
                className={clsx(
                  'rounded px-2 py-0.5 text-[10px] font-medium transition-colors duration-150 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.97]',
                  isActive
                    ? 'bg-bg-elevated text-content-primary shadow-sm'
                    : 'text-content-secondary hover:text-content-primary',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] leading-snug text-content-muted">{layer.provenance}</p>
    </div>
  );
}

// The zoning row — a switch plus its lifecycle status (off / loading /
// error / empty / live) carried through the provenance line.
function ZoningRow({ layer, onToggleZoning }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Swatch swatch={layer.swatch} />
          <span className="text-[11px] font-semibold text-content-primary leading-tight">
            {layer.label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge tone={layer.tone} label={layer.statusLabel} />
          <button
            type="button"
            role="switch"
            aria-checked={layer.enabled}
            aria-label="Toggle RMP zoning overlay"
            onClick={() => onToggleZoning?.()}
            className={clsx(
              'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
              layer.enabled ? 'bg-primary-600' : 'bg-bg-secondary border border-hairline-strong',
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 h-3 w-3 rounded-full bg-bg-elevated shadow-sm transition-transform duration-150 ease-out',
                layer.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
      </div>
      <p className="text-[10px] leading-snug text-content-muted">{layer.provenance}</p>
    </div>
  );
}

// The master-plan row — a switch like zoning, plus an opacity slider shown
// only when the reference raster is actually painting (status 'on').
function MasterPlanRow({ layer, onToggleMasterPlan, onMasterPlanOpacity }) {
  const [legendOpen, setLegendOpen] = useState(false);
  const pct = Math.round((Number(layer.opacity) || 0) * 100);
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Swatch swatch={layer.swatch} />
          <span className="text-[11px] font-semibold text-content-primary leading-tight">
            {layer.label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge tone={layer.tone} label={layer.statusLabel} />
          <button
            type="button"
            role="switch"
            aria-checked={layer.enabled}
            aria-label="Toggle RMP 2015 land-use overlay"
            onClick={() => onToggleMasterPlan?.()}
            className={clsx(
              'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
              layer.enabled ? 'bg-primary-600' : 'bg-bg-secondary border border-hairline-strong',
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 h-3 w-3 rounded-full bg-bg-elevated shadow-sm transition-transform duration-150 ease-out',
                layer.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
      </div>
      {layer.enabled && layer.status === 'on' && (
        <div className="flex items-center gap-2 pl-5">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={layer.opacity}
            aria-label="Master-plan overlay opacity"
            onChange={(e) => onMasterPlanOpacity?.(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
          />
          <span className="w-8 shrink-0 text-right text-[10px] font-medium tabular-nums text-content-muted">
            {pct}%
          </span>
        </div>
      )}
      <p className="text-[10px] leading-snug text-content-muted">{layer.provenance}</p>

      {/* Land-use colour key — only when the reference raster is actually
          painting, so a closed legend never implies "no zoning here". */}
      {layer.enabled && layer.status === 'on' && (
        <div className="pl-5">
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            className="inline-flex items-center gap-1 rounded text-[10px] font-medium text-accent transition-colors duration-150 ease-out hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
          >
            <ChevronDown
              size={11}
              aria-hidden="true"
              className={clsx('transition-transform duration-200 ease-out motion-reduce:transition-none', legendOpen && 'rotate-180')}
            />
            {legendOpen ? 'Hide land-use legend' : 'Land-use legend'}
          </button>
          <div
            className={clsx(
              'overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none',
              legendOpen ? 'max-h-[460px] opacity-100' : 'max-h-0 opacity-0',
            )}
          >
            <div className="-mx-3 mt-1 border-t border-hairline-soft">
              <MasterPlanLegend collapsible={false} compact />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CadastralLayerPanel({
  layers = [],
  onBasemapChange,
  onToggleZoning,
  onToggleMasterPlan,
  onMasterPlanOpacity,
  defaultOpen = true,
  className = '',
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!layers.length) return null;

  // Count the layers actually painting on the canvas right now — the
  // basemap and pin always count; the boundary when drawn; zoning when live.
  const activeCount = layers.filter((l) => {
    if (l.key === 'basemap' || l.key === 'pin') return true;
    if (l.key === 'boundary') return !!l.drawn;
    if (l.key === 'zoning') return l.status === 'on';
    if (l.key === 'masterPlan') return l.status === 'on';
    return false;
  }).length;

  const get = (key) => layers.find((l) => l.key === key);

  return (
    <div
      className={clsx(
        'w-60 max-w-[78vw] overflow-hidden rounded-editorial border border-hairline bg-bg-elevated/95 shadow-sm backdrop-blur-sm',
        className,
      )}
      data-testid="cadastral-layer-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={clsx(
          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors duration-150 ease-out',
          'hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/40',
        )}
      >
        <span className="flex items-center gap-1.5">
          <Layers size={12} className="text-content-secondary" aria-hidden="true" />
          <span className="text-[11px] font-semibold text-content-primary">Map layers</span>
          <span className="rounded-full bg-bg-secondary px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-content-secondary">
            {activeCount}
          </span>
        </span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={clsx(
            'text-content-muted transition-transform duration-200 ease-out',
            open && 'rotate-180',
          )}
        />
      </button>

      <div
        className={clsx(
          'overflow-hidden transition-all duration-200 ease-out',
          open ? 'max-h-[820px] opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="divide-y divide-hairline-soft border-t border-hairline-soft">
          {get('basemap') && (
            <BasemapRow layer={get('basemap')} onBasemapChange={onBasemapChange} />
          )}
          {get('boundary') && <DataLayerRow layer={get('boundary')} />}
          {get('zoning') && <ZoningRow layer={get('zoning')} onToggleZoning={onToggleZoning} />}
          {get('masterPlan') && (
            <MasterPlanRow
              layer={get('masterPlan')}
              onToggleMasterPlan={onToggleMasterPlan}
              onMasterPlanOpacity={onMasterPlanOpacity}
            />
          )}
          {get('pin') && <DataLayerRow layer={get('pin')} />}
        </div>
      </div>
    </div>
  );
}
