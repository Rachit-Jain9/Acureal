import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search, MapPinned, Landmark, Layers, Building2, Coins,
  BookOpen, Ruler, AlertTriangle, Shield, ExternalLink, ArrowRight, FileText,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, StatTile, ErrorState, Skeleton } from '../design-system';
import { useStreetLookup } from '../hooks/useMasterPlan';
import { useCountUp } from '../hooks/useCountUp';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * Parcel Evidence Room — the customer-facing front door to REDIP's single most
 * proprietary, deal-less asset: the 18,743-street BBMP Guidance-Value gazette
 * index. Every Bengaluru street resolves to its ward, UAV zone, guidance-value
 * band, and the EXACT gazette page it was read from — a cited "evidence chain"
 * no transaction-comps competitor holds.
 *
 * This surface is deliberately REFERENCE-ONLY. It re-presents already-approved
 * gazette rows; it mints no new legal assertion, narrates no AI conclusion, and
 * stops honestly at FAR/buildable — which is resolved deterministically only
 * inside a deal, from an analyst-verified RMP zone (the deal-gated terminal
 * node + conversion hook). Zero backend: it reuses the existing authenticated
 * `useStreetLookup` endpoint.
 */

const fmt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-IN') : '—';
};

function useDebounced(value, delayMs = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

// A rupee number that rolls to its value on change. useCountUp already snaps
// under prefers-reduced-motion, so no extra gating is needed here.
function LiveInr({ value }) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  const animated = useCountUp(v, { duration: 700 });
  return <span className="tabular-nums">₹{fmt(Math.round(animated))}</span>;
}

const EXAMPLES = ['Koramangala', 'Whitefield Main Road', 'Mahatma Gandhi Road', 'Jayanagar', 'Indiranagar'];

const registerLabel = (r) =>
  r === 'non_residential' ? 'Non-residential' : r === 'residential' ? 'Residential' : null;

// Build the ordered evidence chain for one gazette row. Each node is a fact
// with its own source framing — the spine reads source → classification →
// valuation → citation, then stops honestly at the deal-gated FAR node.
function buildChain(row) {
  if (!row) return [];
  const hasBand = row.guidance_value_band_min_inr != null || row.guidance_value_band_max_inr != null;
  return [
    {
      key: 'street',
      icon: MapPinned,
      label: 'Street',
      value: row.street_name_en,
      sub: 'As recorded in the BBMP Guidance-Value gazette street index.',
      tone: 'accent',
    },
    {
      key: 'ward',
      icon: Landmark,
      label: 'BBMP ward',
      value: row.ward_no != null ? `Ward ${row.ward_no}` : 'Ward not listed',
      sub: 'The administrative ward the gazette files this street under.',
      tone: 'muted',
    },
    {
      key: 'register',
      icon: Layers,
      label: 'Gazette register',
      value: registerLabel(row.register) || 'Register unspecified',
      sub: 'The same street can sit in different UAV zones across the residential and non-residential registers.',
      tone: 'muted',
    },
    {
      key: 'zone',
      icon: Building2,
      label: 'BBMP-UAV zone',
      value: row.zone_code ? `Zone ${row.zone_code}` : 'Zone not yet enriched',
      sub: row.zone_code
        ? 'The BBMP property-tax valuation zone (A–F) read from the gazette section header.'
        : 'This row is indexed but its zone header has not been enriched yet.',
      tone: row.zone_code ? 'strong' : 'muted',
      big: true,
    },
    {
      key: 'guidance',
      icon: Coins,
      label: 'Guidance-value band',
      value: hasBand
        ? {
          min: row.guidance_value_band_min_inr,
          max: row.guidance_value_band_max_inr,
        }
        : 'Not published for this row',
      sub: 'The IGR guidance-value bandwidth for this zone, published in the same 2016 gazette. A band, not a point value.',
      tone: hasBand ? 'strong' : 'muted',
      isBand: hasBand,
    },
    {
      key: 'source',
      icon: BookOpen,
      label: 'Source of record',
      value: `PDF page ${row.page_number}`,
      sub: row.aro_section
        ? `${row.aro_section} — cited to the exact gazette page.`
        : 'Cited to the exact gazette page it was read from.',
      tone: 'accent',
      isCitation: true,
    },
  ];
}

function ChainNode({ node, index, revealed, sourceDocument }) {
  const shown = index < revealed;
  const Icon = node.icon;
  const dotTone = {
    accent: 'bg-accent border-accent text-white',
    strong: 'bg-bg-elevated border-accent text-accent',
    muted: 'bg-bg-elevated border-hairline-strong text-content-muted',
  }[node.tone] || 'bg-bg-elevated border-hairline-strong text-content-muted';

  return (
    <li
      className={clsx(
        'relative pl-12 pb-5 last:pb-0 transition-all duration-300 ease-out',
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5',
      )}
    >
      {/* node dot on the spine */}
      <span
        className={clsx(
          'absolute left-[9px] top-0.5 grid place-items-center w-[22px] h-[22px] rounded-full border-2 transition-transform duration-300',
          dotTone,
          shown ? 'scale-100' : 'scale-75',
        )}
        aria-hidden="true"
      >
        <Icon size={11} />
      </span>

      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.13em] text-content-muted font-semibold">
          {node.label}
        </div>

        {/* value */}
        <div className="mt-1">
          {node.isBand ? (
            <div className="font-display font-bold text-content-primary leading-tight text-2xl">
              <LiveInr value={node.value.min} />
              {node.value.max != null ? (
                <>
                  <span className="text-content-muted font-normal"> – </span>
                  <LiveInr value={node.value.max} />
                </>
              ) : (
                <span className="text-content-muted font-normal">+</span>
              )}
              <span className="text-sm font-medium text-content-muted"> /sqft</span>
            </div>
          ) : (
            <div
              className={clsx(
                'font-display font-semibold text-content-primary leading-snug',
                node.big ? 'text-2xl font-bold' : 'text-lg',
              )}
            >
              {node.value}
            </div>
          )}
        </div>

        {node.isCitation && (
          <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-content-secondary">
            <FileText size={11} className="text-content-muted" />
            <span className="truncate max-w-[36ch]" title={sourceDocument}>
              {sourceDocument || 'BBMP Guidance-Value gazette (Notification No. 384, 09-Mar-2016)'}
            </span>
          </div>
        )}

        <p className="mt-1 text-xs text-content-muted leading-relaxed max-w-[54ch]">{node.sub}</p>
      </div>
    </li>
  );
}

function EvidenceChain({ row, sourceDocument }) {
  const reduced = useReducedMotion();
  const nodes = useMemo(() => buildChain(row), [row]);
  const [revealed, setRevealed] = useState(0);
  const total = nodes.length;

  // Draw the spine in top-to-bottom on each new focus. Real content; the
  // stagger is purely presentational and snaps to full under reduced-motion.
  useEffect(() => {
    if (total === 0) {
      setRevealed(0);
      return undefined;
    }
    if (reduced) {
      setRevealed(total);
      return undefined;
    }
    setRevealed(0);
    let i = 0;
    let timer = setTimeout(function step() {
      i += 1;
      setRevealed(i);
      if (i < total) timer = setTimeout(step, 120);
    }, 90);
    return () => clearTimeout(timer);
    // Re-run when the focused row (id+register) or motion pref changes.
  }, [row?.id, row?.register, reduced, total]);

  if (!row) return null;
  const progress = total > 0 ? revealed / total : 0;

  return (
    <div className="relative">
      {/* the spine: a faint full-height rail with a growing accent overlay */}
      <span className="absolute left-[19px] top-1.5 bottom-[92px] w-px bg-hairline" aria-hidden="true" />
      <span
        className="absolute left-[19px] top-1.5 w-px bg-accent origin-top transition-[height] duration-500 ease-out"
        aria-hidden="true"
        style={{ height: reduced ? 'calc(100% - 92px)' : `${Math.max(0, progress) * 100}%`, maxHeight: 'calc(100% - 92px)' }}
      />
      <ul className="relative">
        {nodes.map((node, i) => (
          <ChainNode
            key={node.key}
            node={node}
            index={i}
            revealed={revealed}
            sourceDocument={sourceDocument}
          />
        ))}
      </ul>

      {/* Deal-gated terminal node — the honest boundary + conversion hook. */}
      <div
        className={clsx(
          'relative pl-12 mt-1 transition-all duration-300 ease-out',
          revealed >= total ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5',
        )}
      >
        <span
          className="absolute left-[9px] top-0.5 grid place-items-center w-[22px] h-[22px] rounded-full border-2 border-dashed border-hairline-strong bg-bg-secondary text-content-muted"
          aria-hidden="true"
        >
          <Ruler size={11} />
        </span>
        <div className="rounded-editorial border border-dashed border-hairline-strong bg-bg-secondary/50 p-3.5">
          <div className="text-[10px] uppercase tracking-[0.13em] text-content-muted font-semibold">
            FAR &amp; indicative buildable
          </div>
          <p className="mt-1 text-sm text-content-secondary leading-relaxed max-w-[52ch]">
            Resolved deterministically <span className="text-content-primary font-medium">inside a deal</span>, from an
            analyst-verified RMP-2015 zone — never auto-asserted from a street name. Link this parcel to a deal to
            compute buildable potential with full provenance.
          </p>
          <Link
            to="/dashboard/deals"
            className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Start a deal to underwrite this parcel
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ row, active, onClick }) {
  const hasBand = row.guidance_value_band_min_inr != null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full text-left px-3.5 py-2.5 border-b border-hairline last:border-b-0 transition-colors duration-150 focus-visible:outline-none focus-visible:bg-bg-secondary',
        active ? 'bg-accent-soft' : 'hover:bg-bg-secondary',
      )}
      aria-current={active ? 'true' : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={clsx('text-sm leading-snug', active ? 'text-accent font-medium' : 'text-content-primary')}>
          {row.street_name_en}
        </span>
        {row.zone_code && <Badge tone="info">Zone {row.zone_code}</Badge>}
        {row.register && (
          <Badge tone={row.register === 'non_residential' ? 'warn' : 'neutral'}>
            {row.register === 'non_residential' ? 'Non-res' : 'Res'}
          </Badge>
        )}
      </div>
      <div className="text-[11px] text-content-muted mt-0.5 tabular-nums flex items-center gap-1.5 flex-wrap">
        {row.ward_no != null && <span>Ward {row.ward_no}</span>}
        <span aria-hidden="true">·</span>
        <span>p.{row.page_number}</span>
        {hasBand && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-content-secondary">
              ₹{fmt(row.guidance_value_band_min_inr)}
              {row.guidance_value_band_max_inr != null ? `–${fmt(row.guidance_value_band_max_inr)}` : '+'}/sqft
            </span>
          </>
        )}
      </div>
    </button>
  );
}

export default function ParcelEvidenceRoomPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [focusedId, setFocusedId] = useState(null);
  const debounced = useDebounced(searchInput, 220);
  const inputRef = useRef(null);

  const { data, isLoading, isError, isFetching } = useStreetLookup({ search: debounced, limit: 40 });
  const rows = data?.rows || [];
  const summary = data?.summary || {};
  const sourceDocument = data?.source_document;
  const disclaimer = data?.disclaimer;

  // Keep the ?q= deep-link in sync (shareable + landing-hero handoff).
  useEffect(() => {
    const next = debounced ? { q: debounced } : {};
    setSearchParams(next, { replace: true });
  }, [debounced, setSearchParams]);

  // Auto-focus the top hit when results change, so the evidence chain draws in
  // immediately without an extra click. Preserve an explicit selection if it's
  // still in the result set.
  useEffect(() => {
    if (rows.length === 0) {
      setFocusedId(null);
      return;
    }
    setFocusedId((prev) => (rows.some((r) => r.id === prev) ? prev : rows[0].id));
  }, [rows]);

  const focused = rows.find((r) => r.id === focusedId) || null;

  const totalIndexed = summary.total ?? 0;
  const distinctStreets = summary.distinct_streets ?? 0;
  const totalWards = summary.wards ?? 0;
  const enrichedPct = totalIndexed > 0 ? Math.round(((summary.enriched ?? 0) / totalIndexed) * 100) : 0;

  const runExample = (q) => {
    setSearchInput(q);
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bengaluru · Gazette-verified reference"
        title="Parcel Evidence Room"
        description="Type any Bengaluru street and trace its evidence chain — ward, BBMP-UAV zone, and IGR guidance-value band — each read from, and cited to, the exact page of the 686-page BBMP Guidance-Value gazette. This is REDIP's own indexed register of every street inside BBMP limits: reference intelligence you can check against the source, not a black box."
      />

      {/* Corpus proof strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Streets indexed" value={fmt(totalIndexed)} footnote={distinctStreets > 0 ? `${fmt(distinctStreets)} unique names` : 'from the gazette'} />
        <StatTile label="BBMP wards covered" value={fmt(totalWards)} footnote="all wards present" />
        <StatTile label="Zone-enriched" value={`${enrichedPct}%`} footnote="have a UAV zone" />
        <StatTile label="Gazette registers" value="2" footnote="residential + non-residential" />
      </div>

      {/* Search hero */}
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search any Bengaluru street or area — e.g. Koramangala, Whitefield Main Road, M G Road"
          className="w-full pl-12 pr-4 py-3.5 text-base bg-bg-elevated border border-hairline rounded-lg text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent/40 transition-all duration-150"
          aria-label="Search Bengaluru streets"
        />
        {isFetching && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-content-muted">searching…</span>
        )}
      </div>

      {!debounced && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-content-muted">Try:</span>
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => runExample(q)}
              className="px-2.5 py-1 rounded-md border border-hairline bg-bg-elevated text-content-secondary hover:border-accent hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {isError && (
        <ErrorState tone="warn" title="Could not load the street index">
          Try again shortly. The master-plan reference service may be briefly unavailable.
        </ErrorState>
      )}

      {isLoading && (
        <Card elevated className="p-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-48 rounded" />
            <Skeleton className="h-64 rounded" />
          </div>
        </Card>
      )}

      {!isLoading && !isError && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
          {/* Results list */}
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.1em] text-content-muted font-semibold mb-2">
              {debounced ? `${rows.length} match${rows.length === 1 ? '' : 'es'}` : 'Matches'}
            </div>
            <Card elevated className="p-0 overflow-hidden">
              {rows.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-content-muted">
                  {debounced
                    ? 'No streets match. The gazette uses formal names — try a shorter or differently-spelled fragment (e.g. "MAHATMA GANDHI ROAD", not "MG").'
                    : 'Search a street above to reveal its cited evidence chain.'}
                </div>
              ) : (
                <div className="max-h-[32rem] overflow-y-auto">
                  {rows.map((row) => (
                    <ResultRow
                      key={row.id}
                      row={row}
                      active={row.id === focusedId}
                      onClick={() => setFocusedId(row.id)}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Evidence chain */}
          <div className="min-w-0">
            {focused ? (
              <Card elevated className="p-6">
                <div className="text-[11px] uppercase tracking-[0.1em] text-accent font-semibold mb-4">
                  Evidence chain
                </div>
                <EvidenceChain row={focused} sourceDocument={sourceDocument} />
              </Card>
            ) : (
              <Card elevated className="p-10 text-center">
                <MapPinned size={26} className="mx-auto text-content-muted" />
                <div className="mt-3 text-sm font-medium text-content-primary">Search a street to begin</div>
                <p className="mt-1 text-xs text-content-muted max-w-[40ch] mx-auto leading-relaxed">
                  Every result resolves to a cited chain: street → ward → register → UAV zone → guidance band →
                  the exact gazette page.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Verify-live CTA — the gazette band is a 2016 range; Kaveri returns the
          exact current SRO-specific value. Carried verbatim from the deal-side card. */}
      {focused && (
        <div className="flex items-start gap-2.5 rounded-editorial border border-hairline bg-bg-secondary/40 p-4">
          <Shield size={15} className="mt-0.5 text-content-muted shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-content-primary leading-snug">
              For an exact, current guidance value
            </div>
            <div className="text-[11px] text-content-muted mt-1 leading-relaxed max-w-[70ch]">
              Open the IGR Kaveri portal and query this property's SRO (Sub-Registrar Office), village, and property
              type. The BBMP gazette bandwidth shown above is a 2016 band; Kaveri returns the live published rate.
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
      )}

      {/* Verbatim gazette disclaimer — reference-only, verify against source. */}
      <div className="text-[11px] text-content-muted flex items-start gap-1.5 leading-relaxed">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span>
          {disclaimer
            || 'BBMP property-tax zones underpin this index — they are NOT IGR sale-deed guidance values, but the IGR guidance bandwidth per zone is published in the same gazette and surfaced here. AI-extracted; verify the ward and zone classification against the original PDF page before quoting in IC memos.'}
        </span>
      </div>
    </div>
  );
}
