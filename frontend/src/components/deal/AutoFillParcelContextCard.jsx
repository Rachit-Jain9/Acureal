import { useMemo, useState } from 'react';
import { MapPin, Sparkles, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { Card, SectionHeader, Skeleton } from '../../design-system';
import Badge from '../common/Badge';
import useAutoDeriveParcelContext from '../../hooks/useAutoDeriveParcelContext';

/**
 * AutoFillParcelContextCard — the headline UX from this autonomous-window
 * plan's Q2: type an address (or paste coords) → see zone, ward, guidance
 * value, planning district, K-GIS hierarchy, applicable warnings, and the
 * verify-link payloads all auto-fill in 1-2 seconds, with manual override
 * on every field before applying to the deal.
 *
 * This component is standalone — pass `onApply({ pickedFields, payload })`
 * to wire it into the parent (deal Parcel/Site tab, new-property form,
 * admin bulk lookup). PR B3 does that wiring.
 *
 * UX guidelines applied (per docs/FRONTEND_GUIDELINES.md):
 *   - Loading: skeleton matching final layout (not a spinner).
 *   - Empty: friendly placeholder, no anxious copy.
 *   - Error: ErrorState-like banner with retry, no stack trace.
 *   - Numbers: tabular-nums.
 *   - All four interaction states on every button.
 *   - Honest copy: never claim spatial precision we don't have.
 */
export default function AutoFillParcelContextCard({
  defaultAddress = '',
  defaultLat = '',
  defaultLng = '',
  onApply,
  className = '',
}) {
  // Input mode: 'address' or 'coords'. Defaults to whichever we have, else address.
  const initialMode = defaultLat && defaultLng ? 'coords' : 'address';
  const [mode, setMode] = useState(initialMode);
  const [addressInput, setAddressInput] = useState(defaultAddress);
  const [latInput, setLatInput] = useState(defaultLat ? String(defaultLat) : '');
  const [lngInput, setLngInput] = useState(defaultLng ? String(defaultLng) : '');
  // Triggered values — set on Derive button click; the hook fires.
  const [triggered, setTriggered] = useState(null);
  // Per-field "skip" toggle. Default = all included.
  const [skipped, setSkipped] = useState(() => new Set());

  const queryArgs =
    triggered?.mode === 'address'
      ? { address: triggered.address, enabled: true }
      : triggered?.mode === 'coords'
        ? { lat: Number(triggered.lat), lng: Number(triggered.lng), enabled: true }
        : { enabled: false };

  const { data, isFetching, isError, error, refetch } = useAutoDeriveParcelContext(queryArgs);

  const handleDerive = () => {
    if (mode === 'address') {
      const a = addressInput.trim();
      if (!a) return;
      setTriggered({ mode: 'address', address: a });
    } else {
      const la = Number(latInput);
      const ln = Number(lngInput);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
      setTriggered({ mode: 'coords', lat: la, lng: ln });
    }
    setSkipped(new Set());
  };

  const toggleSkip = (key) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fields = useMemo(() => buildFieldRows(data), [data]);
  const includedFields = useMemo(() => fields.filter((f) => !skipped.has(f.key)), [fields, skipped]);

  const handleApply = () => {
    if (!onApply || !data) return;
    const picked = {};
    for (const f of includedFields) picked[f.key] = f.rawValue;
    onApply({ pickedFields: picked, payload: data });
  };

  return (
    <Card className={`p-5 ${className}`}>
      <SectionHeader
        icon={Sparkles}
        eyebrow="Auto-derive"
        title="Parcel context — auto-fill from address"
        sub="Type an address or paste coordinates. We'll fetch the BBMP zone, ward, guidance value, planning district, K-GIS hierarchy, and applicable city-level warnings in one shot."
        size="sm"
      />

      {/* Input row */}
      <div className="space-y-3 mb-4">
        <div role="tablist" className="inline-flex rounded-md border border-hairline bg-bg-secondary p-0.5 text-xs font-medium">
          {['address', 'coords'].map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded transition-colors duration-150 ease-out hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] ${
                mode === m ? 'bg-bg-elevated text-content-primary shadow-sm' : 'text-content-secondary'
              }`}
            >
              {m === 'address' ? 'By address' : 'By coordinates'}
            </button>
          ))}
        </div>

        {mode === 'address' ? (
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <MapPin
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDerive()}
                placeholder="100 Brigade Road, Bengaluru"
                aria-label="Parcel address"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
              />
            </div>
            <DeriveButton onClick={handleDerive} loading={isFetching} disabled={!addressInput.trim()} />
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <input
              type="number"
              step="any"
              inputMode="decimal"
              value={latInput}
              onChange={(e) => setLatInput(e.target.value)}
              placeholder="Latitude (e.g. 12.9750)"
              aria-label="Latitude"
              className="flex-1 min-w-[140px] px-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary tabular-nums placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            />
            <input
              type="number"
              step="any"
              inputMode="decimal"
              value={lngInput}
              onChange={(e) => setLngInput(e.target.value)}
              placeholder="Longitude (e.g. 77.6050)"
              aria-label="Longitude"
              className="flex-1 min-w-[140px] px-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary tabular-nums placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            />
            <DeriveButton onClick={handleDerive} loading={isFetching} disabled={!latInput || !lngInput} />
          </div>
        )}
      </div>

      {/* Status / results section */}
      {isError && (
        <ErrorBanner message={error?.response?.data?.message || error?.message || 'Unknown error'} onRetry={() => refetch()} />
      )}

      {isFetching && !data && <ResultsSkeleton />}

      {!isFetching && !triggered && !data && (
        <EmptyHint mode={mode} />
      )}

      {data && (
        <>
          <ResultsSummary data={data} />
          <ResultRows fields={fields} skipped={skipped} onToggleSkip={toggleSkip} />

          <div className="mt-5 pt-4 border-t border-hairline flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-content-muted">
              <span className="font-medium text-content-secondary">{includedFields.length}</span>
              {' '}of {fields.length} fields ready · derived in{' '}
              <span className="tabular-nums">{data.elapsedMs ?? '—'}</span> ms
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-hairline text-content-secondary hover:bg-bg-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
                aria-label="Re-derive parcel context"
              >
                <RefreshCw size={12} /> Re-derive
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!onApply || includedFields.length === 0}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                aria-label="Apply derived context to deal"
              >
                <Check size={12} /> Apply {includedFields.length} fields
              </button>
            </div>
          </div>
        </>
      )}

      {/* Always-visible disclaimer */}
      <p className="mt-4 text-[10px] uppercase tracking-wider text-content-muted">
        AI-assisted derivation — every field is reviewable + editable before apply.
      </p>
    </Card>
  );
}

// ── Private helpers ──────────────────────────────────────────────────

function DeriveButton({ onClick, loading, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
      aria-label="Derive parcel context"
    >
      {loading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
      Derive
    </button>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center justify-between gap-3 mb-3">
      <span className="flex items-center gap-2 min-w-0">
        <AlertTriangle size={14} className="shrink-0" />
        <span className="truncate">Auto-derive failed: {message}</span>
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-amber-900 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded px-1"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function EmptyHint({ mode }) {
  return (
    <p className="text-xs text-content-muted italic">
      {mode === 'address'
        ? 'Enter an address (e.g. ""100 Brigade Road""), then press Derive.'
        : 'Enter latitude and longitude, then press Derive.'}
    </p>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-busy="true" aria-label="Deriving parcel context">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} height="h-10" className="rounded" />
      ))}
    </div>
  );
}

function ResultsSummary({ data }) {
  const inside = data?.bbmpJurisdiction?.withinBbmp;
  return (
    <div className="rounded-md bg-bg-secondary border border-hairline px-3 py-2 mb-3 text-xs text-content-secondary flex items-center gap-3 flex-wrap">
      <Badge tone={inside ? 'success' : 'warn'}>
        {inside ? 'Within BBMP' : 'Outside BBMP'}
      </Badge>
      {data?.coordinates?.formatted_address && (
        <span className="truncate min-w-0">{data.coordinates.formatted_address}</span>
      )}
      {data?.coordinates?.lat && data?.coordinates?.lng && (
        <span className="tabular-nums text-content-muted">
          {Number(data.coordinates.lat).toFixed(5)}, {Number(data.coordinates.lng).toFixed(5)}
        </span>
      )}
    </div>
  );
}

function ResultRows({ fields, skipped, onToggleSkip }) {
  return (
    <ul className="divide-y divide-hairline border border-hairline rounded-md overflow-hidden" data-testid="auto-fill-rows">
      {fields.map((f) => {
        const isSkipped = skipped.has(f.key);
        return (
          <li
            key={f.key}
            className={`px-3 py-2.5 flex items-start gap-3 ${isSkipped ? 'opacity-50' : ''}`}
            data-testid={`auto-fill-row-${f.key}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs text-content-muted">{f.label}</span>
                {f.source && (
                  <Badge tone="info" className="!text-[10px]">
                    {f.source}
                  </Badge>
                )}
                {typeof f.confidence === 'number' && (
                  <span className="text-[10px] text-content-muted tabular-nums">
                    conf {(f.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className={`text-sm font-medium ${f.value ? 'text-content-primary' : 'text-content-muted italic'}`}>
                {f.value || f.fallback || 'Not derived'}
              </div>
              {f.note && <p className="text-[11px] text-content-muted mt-0.5">{f.note}</p>}
            </div>
            <button
              type="button"
              onClick={() => onToggleSkip(f.key)}
              className="text-[10px] text-content-muted hover:text-content-primary uppercase tracking-wider px-2 py-1 rounded border border-hairline transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
              aria-label={isSkipped ? `Include ${f.label}` : `Skip ${f.label}`}
            >
              {isSkipped ? 'Include' : 'Skip'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Project the auto-derive payload into per-row entries the UI renders.
// Each row has: key (stable id), label, value (display string), rawValue
// (what gets passed to onApply), source (provenance chip), confidence
// (0-1), and optional fallback/note copy.
function buildFieldRows(data) {
  if (!data) return [];
  const rows = [];

  if (data.coordinates) {
    const c = data.coordinates;
    rows.push({
      key: 'coordinates',
      label: 'Coordinates',
      value:
        Number.isFinite(c.lat) && Number.isFinite(c.lng)
          ? `${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}`
          : null,
      rawValue: { lat: c.lat, lng: c.lng },
      source: c.source || null,
      confidence: c.confidence ?? null,
    });
  }

  if (data.bbmpJurisdiction?.ward) {
    const w = data.bbmpJurisdiction.ward;
    rows.push({
      key: 'ward',
      label: 'BBMP ward',
      value: w.ward_no ? `Ward ${w.ward_no}` : null,
      rawValue: { ward_no: w.ward_no },
      source: 'BBMP street index',
      confidence: w.confidence ?? null,
    });
  }

  if (data.bbmpZone) {
    const z = data.bbmpZone;
    const band =
      Number.isFinite(z.guidance_value_band_min_inr) && Number.isFinite(z.guidance_value_band_max_inr)
        ? `₹${Number(z.guidance_value_band_min_inr).toLocaleString('en-IN')}-${Number(
            z.guidance_value_band_max_inr,
          ).toLocaleString('en-IN')}/sqft`
        : null;
    rows.push({
      key: 'bbmp_zone',
      label: 'BBMP property-tax zone',
      value: z.zone_code ? `Zone ${z.zone_code}` : null,
      rawValue: {
        zone_code: z.zone_code,
        guidance_value_band_min_inr: z.guidance_value_band_min_inr,
        guidance_value_band_max_inr: z.guidance_value_band_max_inr,
      },
      source: z.source_street ? `${z.source_street} (p.${z.source_page})` : 'BBMP street index',
      confidence: z.confidence ?? null,
      note: band ? `Guidance bandwidth: ${band}` : 'Guidance bandwidth: not on file',
    });
  }

  if (data.planningDistrict) {
    const pd = data.planningDistrict;
    const meta = [
      pd.population_2011 ? `pop ${Number(pd.population_2011).toLocaleString('en-IN')}` : null,
      pd.area_ha ? `${Number(pd.area_ha).toLocaleString('en-IN')} ha` : null,
      pd.gross_density_pph ? `${pd.gross_density_pph} PPH` : null,
    ].filter(Boolean).join(' · ');
    rows.push({
      key: 'planning_district',
      label: 'Planning District',
      value: pd.pd_code ? `${pd.pd_code} — ${pd.pd_name || ''}`.trim() : null,
      rawValue: { pd_code: pd.pd_code, pd_name: pd.pd_name },
      source: pd.source || 'address-fuzz',
      confidence: pd.confidence ?? null,
      note: meta || null,
    });
  }

  if (data.kgis?.hierarchy) {
    const h = data.kgis.hierarchy;
    const value = [h.taluk, h.village].filter(Boolean).join(' / ') || null;
    rows.push({
      key: 'kgis_hierarchy',
      label: 'K-GIS hierarchy (taluk / village)',
      value,
      rawValue: { taluk: h.taluk, village: h.village, hobli: h.hobli, district: h.district },
      source: 'K-GIS',
      confidence: data.kgis?.confidence ?? null,
      note:
        data.kgis?.survey_numbers?.length > 0
          ? `${data.kgis.survey_numbers.length} survey number candidate${data.kgis.survey_numbers.length === 1 ? '' : 's'} nearby`
          : null,
    });
  }

  if (Array.isArray(data.applicableWarnings) && data.applicableWarnings.length > 0) {
    rows.push({
      key: 'applicable_warnings',
      label: 'Warnings to verify against location',
      value: `${data.applicableWarnings.length} callout${data.applicableWarnings.length === 1 ? '' : 's'}`,
      rawValue: data.applicableWarnings,
      source: 'evidence_facts',
      confidence: null,
      note: data.applicableWarnings.map((w) => w.kind).filter(Boolean).slice(0, 4).join(' · '),
    });
  }

  return rows;
}
