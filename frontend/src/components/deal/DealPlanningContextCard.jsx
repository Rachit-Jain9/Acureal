import { Link } from 'react-router-dom';
import { Layers, AlertTriangle, ArrowUpRight, MapPin, Trees, Compass, Landmark } from 'lucide-react';
import { Card, ErrorState, SectionHeader } from '../../design-system';
import { useLandUseIntelligence } from '../../hooks/useMasterPlan';
import RmpStatusBanner from '../masterplan/RmpStatusBanner';

const fmt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

const asArray = (value) => (Array.isArray(value) ? value : []);
const nonEmptyStr = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const stripSuffix = (value, pattern) => String(value || '').replace(pattern, '').trim();

function CalloutTile({ icon: Icon, label, value, hint, tone = 'neutral' }) {
  const toneClass = {
    warn: 'border-amber-200 bg-amber-50/60',
    info: 'border-sky-200 bg-sky-50/60',
    success: 'border-emerald-200 bg-emerald-50/60',
    neutral: 'border-hairline bg-bg-secondary/40',
  }[tone] || 'border-hairline bg-bg-secondary/40';

  return (
    <div className={`rounded-md border ${toneClass} p-3`}>
      <div className="flex items-center gap-1.5 text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1 font-medium">
        <Icon size={11} aria-hidden="true" />
        {label}
      </div>
      <div className="text-sm text-content-primary leading-snug tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-content-muted mt-0.5 leading-snug">{hint}</div>}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <Card elevated className="p-5">
      <div className="space-y-3 animate-pulse motion-reduce:animate-none">
        <div className="h-3 w-40 rounded bg-bg-secondary" />
        <div className="h-5 w-2/3 rounded bg-bg-secondary" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3">
          <div className="h-20 rounded bg-bg-secondary" />
          <div className="h-20 rounded bg-bg-secondary" />
          <div className="h-20 rounded bg-bg-secondary" />
          <div className="h-20 rounded bg-bg-secondary" />
        </div>
      </div>
      <span className="sr-only">Loading planning context</span>
    </Card>
  );
}

// Surfaces city-level Bengaluru planning context inside any deal's Zoning
// tab. Pulls the same approved evidence_facts the admin Planning Intelligence
// surfaces use, so deal teams don't have to leave the deal to see SDZ
// corridors, NGT water buffers, heritage zones, or the PRR alignment.
//
// IMPORTANT: the callout facts are stored as their raw extracted shapes —
// `special_development_zones` and `heritage_zones` are ARRAYS of objects;
// `ngt_drainage_classification` and `peripheral_ring_road` are flat OBJECTS
// (NGT keys are `*_buffer_m`, PRR carries `alignment`/`status`). This
// component reads those exact shapes. The accompanying test locks them so the
// card can never silently regress to an empty "not ingested yet" state again.
export default function DealPlanningContextCard() {
  const { data, isLoading, isError } = useLandUseIntelligence();

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load planning context">
        City-level callouts come from the master-plan service. Try again or open the admin Planning Intelligence surface directly.
      </ErrorState>
    );
  }

  const callouts = data?.callouts || [];
  const valueOf = (key) => callouts.find((c) => c.key === key)?.value;

  const sdzList = asArray(valueOf('special_development_zones'));
  const heritageList = asArray(valueOf('heritage_zones'));
  const ngt = valueOf('ngt_drainage_classification') || null;
  const prr = valueOf('peripheral_ring_road') || null;

  const sdzHas = sdzList.length > 0;
  const heritageHas = heritageList.length > 0;
  const ngtHas = !!ngt
    && [ngt.lake_buffer_m, ngt.primary_buffer_m, ngt.secondary_buffer_m, ngt.tertiary_buffer_m]
      .some((v) => Number.isFinite(Number(v)));
  const prrHas = !!prr && (nonEmptyStr(prr.alignment) != null || nonEmptyStr(prr.status) != null);
  const hasAny = sdzHas || ngtHas || heritageHas || prrHas;

  return (
    <Card elevated className="p-5">
      <SectionHeader
        size="sm"
        icon={Layers}
        title="Bengaluru planning context"
        sub="City-level RMP 2031 facts that materially affect any Bengaluru site. Cross-reference against this parcel's exact location before underwriting."
        action={(
          <Link
            to="/admin/master-plan?tab=intelligence"
            className="inline-flex items-center gap-1 text-xs text-content-secondary hover:text-content-primary transition-colors duration-150 ease-out"
          >
            Open intelligence
            <ArrowUpRight size={11} />
          </Link>
        )}
      />

      <RmpStatusBanner className="mt-3" />

      {hasAny ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          {sdzHas && (
            <CalloutTile
              icon={MapPin}
              label="Special Development Zones"
              value={`${fmt(sdzList.length)} corridors`}
              hint={sdzList
                .map((s) => nonEmptyStr(s.corridor_axis) || stripSuffix(s.name, /^SDZ\s*/i))
                .filter(Boolean)
                .slice(0, 5)
                .join(', ') || null}
              tone="warn"
            />
          )}
          {ngtHas && (
            <CalloutTile
              icon={Trees}
              label="NGT water buffers"
              value={`Lake ${fmt(ngt.lake_buffer_m)}m · P ${fmt(ngt.primary_buffer_m)}m · S ${fmt(ngt.secondary_buffer_m)}m · T ${fmt(ngt.tertiary_buffer_m)}m`}
              hint="No-construction buffers from water bodies & storm drains (NGT 2016)"
              tone="success"
            />
          )}
          {heritageHas && (
            <CalloutTile
              icon={Landmark}
              label="Heritage zones"
              value={`${fmt(heritageList.length)} zones`}
              hint={heritageList
                .map((h) => stripSuffix(h.name, /\s*Heritage Zone$/i))
                .filter(Boolean)
                .slice(0, 3)
                .join(', ') || null}
              tone="warn"
            />
          )}
          {prrHas && (
            <CalloutTile
              icon={Compass}
              label="Peripheral Ring Road"
              value={nonEmptyStr(prr.alignment) ? 'Proposed ring corridor' : 'Proposed'}
              hint={nonEmptyStr(prr.status)}
              tone="info"
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-content-muted italic mt-3">
          City-level land-use callouts have not been ingested yet. Once the RMP source corpus is processed, SDZ corridors, NGT buffers, heritage zones, and the Peripheral Ring Road alignment will surface here automatically.
        </p>
      )}

      <div className="text-[11px] text-content-muted mt-3 flex items-start gap-1.5">
        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
        <span>
          Extracted from RMP 2031 (Draft), Volumes 3 &amp; 4. These are city-wide reference facts — verify each against this parcel&apos;s exact location and the published RMP before quoting in an IC memo.
        </span>
      </div>
    </Card>
  );
}
