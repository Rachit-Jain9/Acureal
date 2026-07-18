import { useMemo, useState } from 'react';
import { MapPin, Sparkles, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { Card, SectionHeader, Skeleton } from '../../design-system';
import Badge from '../common/Badge';
import DerivedValueChip from '../common/DerivedValueChip';
import useAutoDeriveParcelContext from '../../hooks/useAutoDeriveParcelContext';
import VerifyLinksSection from './VerifyLinksSection';
import DerivedParcelMiniMap from './DerivedParcelMiniMap';

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
              className={`px-3 py-1.5 rounded transition-colors duration-150 ease-out hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] ${
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
                className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
              className="flex-1 min-w-[140px] px-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary tabular-nums placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
            <input
              type="number"
              step="any"
              inputMode="decimal"
              value={lngInput}
              onChange={(e) => setLngInput(e.target.value)}
              placeholder="Longitude (e.g. 77.6050)"
              aria-label="Longitude"
              className="flex-1 min-w-[140px] px-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary tabular-nums placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
          {data.coordinatesGate?.gated ? (
            <CoordinatesGateExplainer
              gate={data.coordinatesGate}
              kgisHierarchy={data.kgis?.hierarchy}
              onSwitchToCoords={() => {
                setMode('coords');
                if (data.coordinates?.lat) setLatInput(String(data.coordinates.lat));
                if (data.coordinates?.lng) setLngInput(String(data.coordinates.lng));
              }}
            />
          ) : (
            data.bbmpJurisdiction && !data.bbmpJurisdiction.withinBbmp && (
              <OutsideBbmpExplainer data={data} />
            )
          )}
          <ResultRows fields={fields} skipped={skipped} onToggleSkip={toggleSkip} derivedAt={data?.derivedAt} />

          {/* Derived-parcel mini-map (C-8). Renders the K-GIS parcel
              polygon if available, else a 50m buffered circle around
              the geocoded pin. Hidden when coordinatesGate fires. */}
          <DerivedParcelMiniMap data={data} />

          {/* Authority verify-links section (C-4) — surfaces Bhoomi RTC,
              Kaveri EC, BBMP e-Aasthi, K-RERA, IGR Guidance, K-GIS
              Cadastral, Google Maps satellite. Renders only when the
              backend returns a non-empty verifyLinks array. */}
          <VerifyLinksSection verifyLinks={data.verifyLinks} />

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
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-hairline text-content-secondary hover:bg-bg-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
                aria-label="Re-derive parcel context"
              >
                <RefreshCw size={12} /> Re-derive
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!onApply || includedFields.length === 0}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-content-inverse hover:bg-accent-hover transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
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
      className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-accent text-content-inverse hover:bg-accent-hover transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
      aria-label="Derive parcel context"
    >
      {loading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
      Derive
    </button>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="rounded-md border border-hairline bg-premium-soft px-3 py-2 text-xs text-premium flex items-center justify-between gap-3 mb-3">
      <span className="flex items-center gap-2 min-w-0">
        <AlertTriangle size={14} className="shrink-0" />
        <span className="truncate">Auto-derive failed: {message}</span>
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-premium font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-premium rounded px-1"
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
  const taluk = data?.kgis?.hierarchy?.taluk;
  return (
    <div className="rounded-md bg-bg-secondary border border-hairline px-3 py-2 mb-3 text-xs text-content-secondary flex items-center gap-3 flex-wrap">
      <Badge tone={inside ? 'success' : 'warn'}>
        {inside ? 'Within BBMP' : 'Outside BBMP'}
      </Badge>
      {!inside && taluk && (
        <span className="text-content-secondary">
          <span className="text-content-muted">in</span> {taluk} taluk
        </span>
      )}
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

// Surfaces the "coordinates not trustworthy" gate prominently when the
// geocoder returned an approximate match (e.g. Nominatim's city-level
// fallback for a Jigani-style apartment address). Backend skipped BBMP /
// PD lookups; this banner tells the user WHY and offers a one-click
// path to recover by switching to coordinate-input mode and pasting a
// precise lat/lng from Google Maps. Higher-severity styling than the
// outside-BBMP banner because it indicates "data here is unreliable",
// not "this jurisdiction is different".
function CoordinatesGateExplainer({ gate, kgisHierarchy, onSwitchToCoords }) {
  const taluk = kgisHierarchy?.taluk;
  const district = kgisHierarchy?.district;
  const confidencePct = gate?.confidence != null ? Math.round(gate.confidence * 100) : null;
  return (
    <div
      className="rounded-md border border-hairline bg-neg-soft px-3 py-3 mb-3 flex items-start gap-2"
      data-testid="coordinates-gate-explainer"
    >
      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-data-negative" aria-hidden="true" />
      <div className="flex-1 min-w-0 text-xs text-data-negative">
        <div className="font-semibold mb-1">
          Geocode is approximate{confidencePct != null ? ` (${confidencePct}% confidence, ${gate.provider || 'unknown source'})` : ''} — BBMP lookups skipped
        </div>
        <p className="leading-relaxed">
          The geocoder returned a city-level fallback rather than the exact parcel location, so
          BBMP street / ward / zone / Planning District lookups were not run — those would chain
          on inaccurate coordinates and produce misleading values (a known IC-defensibility risk).
          {taluk && (
            <>
              {' '}K-GIS still resolved hierarchy to{' '}
              <span className="font-medium">{taluk}{district ? `, ${district}` : ''}</span>, which
              you can use to verify the parcel manually.
            </>
          )}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {onSwitchToCoords && (
            <button
              type="button"
              onClick={onSwitchToCoords}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-data-negative text-content-inverse hover:opacity-90 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-data-negative active:scale-[0.98]"
            >
              Switch to coordinate input
            </button>
          )}
          <span className="text-[10px] text-data-negative">
            Tip: open the address in Google Maps, right-click the parcel pin, copy the lat/lng, paste here.
          </span>
        </div>
      </div>
    </div>
  );
}

// Honest explainer when a parcel sits outside BBMP city limits. Surfaces
// the surrounding Planning Authority context (via K-GIS taluk/village)
// + the verify-link hint, so the user understands WHY some rows are
// missing instead of mistaking the empty UI for a bug.
function OutsideBbmpExplainer({ data }) {
  const hier = data?.kgis?.hierarchy || {};
  const where = [hier.taluk, hier.district].filter(Boolean).join(', ');
  const detection = data?.bbmpJurisdiction?.detection_method;
  const taluk = data?.bbmpJurisdiction?.kgis_taluk || hier.taluk;
  // Specific copy per detection method — tells the user EXACTLY why we
  // think this is outside BBMP. The taluk-override case is the most
  // helpful: it cites Anekal/Hosakote/etc by name so the user knows
  // which Planning Authority's portal to use instead.
  const isTalukOverride = detection === 'kgis_taluk_override';
  return (
    <div
      className="rounded-md border border-hairline bg-premium-soft px-3 py-2 mb-3 text-xs text-premium flex items-start gap-2"
      data-testid="outside-bbmp-explainer"
    >
      <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <span className="font-medium">
          {isTalukOverride
            ? `This parcel is in ${taluk} taluk — outside BBMP`
            : 'This parcel sits outside BBMP city limits'}
        </span>
        {isTalukOverride ? (
          <>
            {'. '}
            <span>
              {taluk} is governed by a <span className="font-medium">separate Planning Authority</span>, not BBMP.
            </span>
          </>
        ) : (
          where && (
            <>
              {' — '}
              <span>
                K-GIS places it in <span className="font-medium">{where}</span>.
              </span>
            </>
          )
        )}
        {' '}BBMP-specific fields (ward, property-tax zone, guidance bandwidth, Bengaluru planning district) don't apply here. The K-GIS hierarchy and city-wide warnings below are still useful — and the verify links open Bhoomi RTC / Kaveri EC scoped to the right taluk for an EC + survey lookup.
      </div>
    </div>
  );
}

function ResultRows({ fields, skipped, onToggleSkip, derivedAt }) {
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
                  <DerivedValueChip
                    source={f.source}
                    confidence={f.confidence}
                    derivedAt={derivedAt}
                    extras={f.chipExtras}
                  />
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
              className="text-[10px] text-content-muted hover:text-content-primary uppercase tracking-wider px-2 py-1 rounded border border-hairline transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
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
//
// When the parcel is outside BBMP, the BBMP-specific rows (ward, BBMP
// zone, BBMP planning district) are NOT rendered as empty "Not derived"
// placeholders — they're omitted entirely. The OutsideBbmpExplainer
// above the row list tells the user why. This stops the half-broken
// UI that the Attibele Industrial Area deal screenshot exposed.
function buildFieldRows(data) {
  if (!data) return [];
  const rows = [];
  const isInsideBbmp = !!data.bbmpJurisdiction?.withinBbmp;

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
      chipExtras: [
        { label: 'Provider', value: c.source },
        { label: 'Status', value: c.status },
        { label: 'Formatted', value: c.formatted_address },
        { label: 'Place ID', value: c.place_id },
      ],
    });
  }

  // BBMP-specific rows are skipped entirely when the parcel sits outside
  // BBMP city limits — the OutsideBbmpExplainer above the row list
  // explains why. Avoids the half-broken "Not derived" placeholders the
  // Attibele Industrial Area deal exposed.
  if (isInsideBbmp && data.bbmpJurisdiction?.ward) {
    const w = data.bbmpJurisdiction.ward;
    rows.push({
      key: 'ward',
      label: 'BBMP ward',
      value: w.ward_no ? `Ward ${w.ward_no}` : null,
      rawValue: { ward_no: w.ward_no },
      source: 'BBMP street index',
      confidence: w.confidence ?? null,
      chipExtras: [
        { label: 'Match', value: w.source },
        { label: 'Token', value: data.streetIndex?.search_token_used },
      ],
    });
  }

  if (isInsideBbmp && data.bbmpZone) {
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
      chipExtras: [
        { label: 'Street', value: z.source_street },
        { label: 'PDF page', value: z.source_page },
        { label: 'Zone', value: z.zone_code },
        { label: 'Band ₹', value: band },
      ],
    });
  }

  if (isInsideBbmp && data.planningDistrict) {
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
      chipExtras: [
        { label: 'Match', value: pd.source },
        { label: 'PD code', value: pd.pd_code },
        { label: 'Population (2011)', value: pd.population_2011?.toLocaleString?.('en-IN') },
        { label: 'Area', value: pd.area_ha ? `${pd.area_ha} ha` : null },
        { label: 'Density', value: pd.gross_density_pph ? `${pd.gross_density_pph} PPH` : null },
      ],
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
      chipExtras: [
        { label: 'District', value: h.district },
        { label: 'Taluk', value: h.taluk },
        { label: 'Hobli', value: h.hobli },
        { label: 'Village', value: h.village },
        { label: 'Surveys', value: data.kgis?.survey_numbers?.length },
      ],
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
      chipExtras: [
        { label: 'Count', value: data.applicableWarnings.length },
        { label: 'Kinds', value: data.applicableWarnings.map((w) => w.kind).filter(Boolean).join(', ') },
      ],
    });
  }

  return rows;
}
