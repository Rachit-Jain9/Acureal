import { Link } from 'react-router-dom';
import { Layers, AlertTriangle, ArrowUpRight, MapPin, Trees, Compass } from 'lucide-react';
import { Card, ErrorState, SectionHeader, StatTile } from '../../design-system';
import { useLandUseIntelligence } from '../../hooks/useMasterPlan';

const fmt = (value, fractionDigits = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
};

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
// tab. Pulls from the same evidence_facts the admin Planning Intelligence
// surfaces use, so deal teams don't have to leave the deal to verify
// SDZ corridors, NGT drain buffers, heritage radii, or the PRR alignment.
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
  const find = (predicate) => callouts.find(predicate)?.value;

  const sdz = find((c) => c.key === 'special_development_zones');
  const ngt = find((c) => c.key === 'ngt_drainage_classification');
  const heritage = find((c) => c.key === 'heritage_zones');
  const prr = find((c) => c.key === 'peripheral_ring_road');

  const hasAny = sdz || ngt || heritage || prr;

  if (!hasAny) {
    return (
      <Card elevated className="p-5">
        <SectionHeader
          size="sm"
          icon={Layers}
          title="Bengaluru planning context"
          sub="Verified facts from RMP 2031 maps that materially affect any deal site."
          action={(
            <Link
              to="/admin/master-plan?tab=intelligence"
              className="inline-flex items-center gap-1 text-xs text-content-secondary hover:text-content-primary transition-colors duration-120"
            >
              Open intelligence
              <ArrowUpRight size={11} />
            </Link>
          )}
        />
        <p className="text-xs text-content-muted italic mt-2">
          Land-use facts have not been ingested yet. Once the Existing Land Use 2015 and Proposed Land Use 2031 maps land in the source corpus, this rail will surface SDZ corridors, NGT drain buffers, heritage radii, and the Peripheral Ring Road alignment automatically.
        </p>
      </Card>
    );
  }

  return (
    <Card elevated className="p-5">
      <SectionHeader
        size="sm"
        icon={Layers}
        title="Bengaluru planning context"
        sub="Verified callouts from RMP 2031 maps that materially affect any deal site. Cross-reference these against your parcel boundary before underwriting."
        action={(
          <Link
            to="/admin/master-plan?tab=intelligence"
            className="inline-flex items-center gap-1 text-xs text-content-secondary hover:text-content-primary transition-colors duration-120"
          >
            Open Planning Intelligence
            <ArrowUpRight size={11} />
          </Link>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        {sdz && (
          <CalloutTile
            icon={MapPin}
            label="Special Development Zones"
            value={`${fmt(sdz.count)} corridors · max FAR ${sdz.max_far ?? '—'}`}
            hint={Array.isArray(sdz.locations) ? sdz.locations.slice(0, 3).join(', ') : null}
            tone="warn"
          />
        )}
        {ngt && (
          <CalloutTile
            icon={Trees}
            label="NGT drain buffers"
            value={`P ${ngt.buffer_m_primary}m · S ${ngt.buffer_m_secondary}m · T ${ngt.buffer_m_tertiary}m`}
            hint="Primary, secondary, tertiary drain setbacks"
            tone="success"
          />
        )}
        {heritage && (
          <CalloutTile
            icon={AlertTriangle}
            label="Heritage zones"
            value={`${fmt(heritage.count)} zones · ${heritage.prohibited_radius_m}m prohibited`}
            hint={heritage.regulated_radius_m ? `${heritage.regulated_radius_m}m regulated radius` : null}
            tone="warn"
          />
        )}
        {prr && (
          <CalloutTile
            icon={Compass}
            label="Peripheral Ring Road"
            value={`${prr.width_m}m corridor · ${prr.type}`}
            hint={prr.note}
            tone="info"
          />
        )}
      </div>

      <div className="text-[11px] text-content-muted mt-3 flex items-start gap-1.5">
        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
        <span>
          AI-extracted from RMP 2031 land-use maps. Verify each callout against the published RMP and the parcel's exact location before quoting in IC memos.
        </span>
      </div>
    </Card>
  );
}
