import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, MapPin, FileText, AlertTriangle, ArrowUpRight, Sparkles, TrendingUp, ExternalLink, Shield } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, StatTile } from '../../design-system';
import { useStreetLookup } from '../../hooks/useMasterPlan';
import { analyseGuidanceValueSpread } from '../../utils/guidanceValueAnalysis';
import WardSpreadBenchmarkTile from './WardSpreadBenchmarkTile';

// Inline 200ms debounce — keeps the BBMP street search responsive on the
// deal page without firing on every keystroke.
function useDebounced(value, delayMs = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

const fmt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN');
};

// Pull a search-friendly seed from a property: prefer the property name
// (often the colloquial street/locality), fall back to the address tail
// closest to BBMP's street vocabulary. Anything beyond the first comma
// in the address tends to be the street; the rest is city/state noise.
const deriveSearchSeed = (property) => {
  if (!property) return '';
  if (property.name) return String(property.name).trim();
  if (property.address) {
    const head = String(property.address).split(',')[0].trim();
    return head;
  }
  return '';
};

function HitRow({ row }) {
  const hasZone = !!row.zone_code;
  const hasBand = row.guidance_value_band_min_inr != null
    || row.guidance_value_band_max_inr != null;
  return (
    <li className="px-3 py-2 border-b border-hairline last:border-b-0 hover:bg-bg-secondary/40 transition-colors duration-150">
      <div className="flex items-start gap-2">
        <MapPin size={11} className="mt-0.5 text-content-muted shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm text-content-primary leading-snug">
              {row.street_name_en}
            </span>
            {hasZone && <Badge tone="info">Zone {row.zone_code}</Badge>}
            {row.register && (
              <Badge tone={row.register === 'non_residential' ? 'warn' : 'neutral'}>
                {row.register === 'non_residential' ? 'Non-residential' : 'Residential'}
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-content-muted leading-snug mt-0.5 flex items-center gap-1.5 flex-wrap">
            {row.ward_no != null && <span className="tabular-nums">Ward {row.ward_no}</span>}
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1 tabular-nums">
              <FileText size={10} />PDF p.{row.page_number}
            </span>
            {hasBand && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums text-content-secondary">
                  ₹{fmt(row.guidance_value_band_min_inr)}
                  {row.guidance_value_band_max_inr != null
                    ? `–${fmt(row.guidance_value_band_max_inr)}`
                    : '+'}
                  /sqft
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function PanelSkeleton() {
  return (
    <Card elevated className="p-5">
      <div className="space-y-3 animate-pulse motion-reduce:animate-none">
        <div className="h-3 w-40 rounded bg-bg-secondary" />
        <div className="h-12 rounded bg-bg-secondary" />
        <div className="h-32 rounded bg-bg-secondary" />
      </div>
      <span className="sr-only">Loading Bengaluru street lookup</span>
    </Card>
  );
}

// Restricted-to-Bengaluru deal-side card. Renders the BBMP street lookup
// pre-seeded from the deal's linked property and surfaces the matched
// zone, ward, and guidance-value band — the three numbers a deal team
// asks first when underwriting a Bengaluru transaction. When the deal
// has both a transaction price AND the matched street has guidance-value
// enrichment, the card also renders a spread-vs-guidance signal tile.
export default function DealStreetLookupCard({ property, deal }) {
  const seed = useMemo(() => deriveSearchSeed(property), [property]);
  const [searchInput, setSearchInput] = useState(seed);
  const debounced = useDebounced(searchInput, 200);
  const { data, isLoading, isError, isFetching } = useStreetLookup({
    search: debounced,
    limit: 10,
  });

  // If the seed changes (deal swapped properties), re-prime the input.
  useEffect(() => {
    setSearchInput(seed);
  }, [seed]);

  // ── Data derivations + the spread hook MUST run before any early return ──
  // React error #310 fired here: the loading render returned at the
  // <PanelSkeleton/> guard below BEFORE reaching the spreadAnalysis useMemo,
  // so the subsequent loaded render called one more hook than the loading
  // render — a Rules-of-Hooks violation that crashed the entire Zoning tab
  // through the ErrorBoundary. Every hook now sits above every conditional
  // return; the derivations read `data` defensively so they're safe to run
  // while the query is still loading (data === undefined).
  const rows = data?.rows || [];
  const summary = data?.summary || {};
  const topMatch = rows[0] || null;
  const enrichedCount = summary.enriched ?? 0;
  const totalCount = summary.total ?? 0;
  const enrichedPct = totalCount > 0 ? Math.round((enrichedCount / totalCount) * 100) : 0;

  // Spread vs guidance — only computable when the top match has a
  // bandwidth and the deal has a transaction price. Falls back gracefully
  // (kernel returns ok:false) when either side is missing — safe to call
  // with a null topMatch during the loading render.
  const spreadAnalysis = useMemo(() => analyseGuidanceValueSpread({
    transactionPriceCr: deal?.negotiated_price_cr ?? deal?.land_ask_price_cr ?? deal?.entry_value_cr,
    landAreaSqft: property?.land_area_sqft ?? deal?.land_area_sqft,
    pricePerSqft: property?.selling_rate_per_sqft ?? deal?.selling_rate_per_sqft,
    guidanceMinInr: topMatch?.guidance_value_band_min_inr,
    guidanceMaxInr: topMatch?.guidance_value_band_max_inr,
  }), [deal, property, topMatch]);

  // ── Early returns — AFTER all hooks (rules-of-hooks) ──
  // Skip the panel entirely when the property is outside Bengaluru — the
  // BBMP gazette only covers BBMP-jurisdiction streets.
  const city = String(property?.city || '').toLowerCase();
  if (city && !city.includes('bengaluru') && !city.includes('bangalore')) {
    return null;
  }

  if (isLoading && !data) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load Bengaluru street lookup">
        Try again. The full lookup is also available on the admin Planning Intelligence tab.
      </ErrorState>
    );
  }

  const signalToneClass = {
    success: 'text-data-positive',
    neutral: 'text-content-secondary',
    warn: 'text-data-negative',
    danger: 'text-data-negative',
  }[spreadAnalysis?.signal?.tone] || 'text-content-primary';

  return (
    <Card elevated className="p-5">
      <SectionHeader
        helpTopic="deal.street-lookup"
        size="sm"
        icon={MapPin}
        title="Bengaluru street lookup — BBMP zone + guidance value"
        sub="Pre-seeded from this deal's linked property. Edit the search to confirm the matched street; the top hit's ward + zone is the BBMP-published classification used for property tax and IGR-style guidance value."
        action={(
          <Link
            to="/dashboard/admin/master-plan?tab=intelligence"
            className="inline-flex items-center gap-1 text-xs text-content-secondary hover:text-content-primary transition-colors duration-120"
          >
            Open full lookup
            <ArrowUpRight size={11} />
          </Link>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
        <StatTile
          label="Top match zone"
          value={topMatch?.zone_code ? `Zone ${topMatch.zone_code}` : '—'}
          footnote={topMatch?.zone_code
            ? `from ${topMatch.street_name_en.slice(0, 30)}${topMatch.street_name_en.length > 30 ? '…' : ''}`
            : (topMatch ? 'Zone not yet enriched for this row' : 'No matches yet')}
        />
        <StatTile
          label="Top match guidance"
          value={topMatch?.guidance_value_band_min_inr != null
            ? `₹${fmt(topMatch.guidance_value_band_min_inr)}${topMatch.guidance_value_band_max_inr != null ? `–${fmt(topMatch.guidance_value_band_max_inr)}` : '+'}`
            : '—'}
          footnote="per sqft (BBMP gazette band)"
        />
        {spreadAnalysis.ok ? (
          <StatTile
            label={(
              <span className="flex items-center gap-1">
                <TrendingUp size={11} />
                Spread vs guidance
              </span>
            )}
            value={(
              <span className={signalToneClass}>
                {spreadAnalysis.spread_pct >= 0 ? '+' : ''}
                {spreadAnalysis.spread_pct.toFixed(1)}%
              </span>
            )}
            footnote={(
              <span>
                {spreadAnalysis.signal?.label} · Risk-adj entry ₹{fmt(spreadAnalysis.risk_adjusted_entry_inr)}
              </span>
            )}
          />
        ) : (
          <StatTile
            label="Spread vs guidance"
            value="—"
            footnote={spreadAnalysis.reason === 'price_missing'
              ? 'Enter deal price to compute'
              : spreadAnalysis.reason === 'guidance_missing'
                ? 'Top match has no zone yet'
                : 'Awaiting data'}
          />
        )}
        <StatTile
          label="Index coverage"
          value={`${fmt(enrichedCount)} / ${fmt(totalCount)}`}
          footnote={enrichedPct > 0 ? `${enrichedPct}% have a zone` : 'enrichment pending'}
        />
      </div>

      {/* Ward-wide spread benchmark — Bayesian sanity check for this deal's
          spread against other deals in the same BBMP ward. Renders only
          when the ward has been auto-derived AND there are >=3 other
          deals in the same ward; otherwise shows an honest "not ready"
          hint (no defensive copy). */}
      <WardSpreadBenchmarkTile
        propertyId={property?.id}
        currentDealSpreadPct={spreadAnalysis.ok ? spreadAnalysis.spread_pct : null}
      />

      <div className="relative mt-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Refine the street name (e.g. Whitefield Main Road)"
          className="w-full pl-9 pr-3 py-2 text-sm bg-bg-elevated border border-hairline rounded-md text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 transition-all duration-120"
          aria-label="Refine BBMP street search"
        />
        {isFetching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-content-muted">…</div>
        )}
      </div>

      <Card className="mt-3 p-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-content-muted">
            {debounced
              ? `No BBMP streets matched "${debounced}". The gazette uses formal names — try a shorter or differently-spelled fragment.`
              : seed
                ? `Pre-seeded from "${seed}" but the index is loading…`
                : 'Type a street name to search the BBMP index.'}
          </div>
        ) : (
          <ul>
            {rows.slice(0, 6).map((row) => (
              <HitRow key={row.id} row={row} />
            ))}
            {rows.length > 6 && (
              <li className="px-3 py-2 text-center">
                <Link
                  to="/dashboard/admin/master-plan?tab=intelligence"
                  className="text-[11px] text-content-secondary hover:text-content-primary inline-flex items-center gap-1"
                >
                  +{rows.length - 6} more in full lookup
                  <ArrowUpRight size={10} />
                </Link>
              </li>
            )}
          </ul>
        )}
      </Card>

      {/* Verify-on-Kaveri CTA — the gazette gives band-level ranges; the live IGR
          Kaveri portal returns the exact, current SRO-specific guidance value for
          a specific property type. We can't deep-link to a specific street (Kaveri
          requires SRO + village + property-type form input), so we link to the
          portal root and tell the user what to enter. */}
      <div className="mt-3 flex items-start gap-2 rounded-md border border-hairline bg-bg-secondary/40 p-3">
        <Shield size={14} className="mt-0.5 text-content-muted shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-content-primary leading-snug">
            For an exact, current guidance value
          </div>
          <div className="text-[11px] text-content-muted mt-1 leading-relaxed">
            Open the IGR Kaveri portal and run a query for this property's SRO (Sub-Registrar Office), village, and property type.
            The BBMP gazette bandwidth above is a 2016 band; Kaveri returns the live published rate.
          </div>
          <a
            href="https://kaveri.karnataka.gov.in/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-2"
          >
            Open Kaveri Online
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="text-[11px] text-content-muted mt-3 flex items-start gap-1.5">
        <Sparkles size={11} className="mt-0.5 shrink-0" />
        <span>
          Search seeded from the linked property's name / address. Always verify the matched ward + zone against
          the original BBMP gazette page (link in each hit row) before using the guidance value in IC numbers.
        </span>
      </div>

      <div className="text-[11px] text-content-muted mt-1 flex items-start gap-1.5">
        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
        <span>
          BBMP property-tax zones underpin this index — they are NOT IGR sale-deed guidance values, but the IGR
          guidance bandwidth per zone is published in the same gazette and surfaced here. AI-extracted; verify
          the ward and zone classification against the original PDF page before quoting in IC memos.
        </span>
      </div>
    </Card>
  );
}
