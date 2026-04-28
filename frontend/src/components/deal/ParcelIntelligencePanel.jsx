import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Gauge,
  Landmark,
  Layers3,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { Card, ErrorState, SectionHeader } from '../../design-system';
import Badge from '../common/Badge';
import {
  useParcelIntelligence,
  useParcelVerifications,
  useRefreshParcelIntelligence,
  useUnverifyParcelItem,
  useVerifyParcelItem,
} from '../../hooks/useProperties';
import { useParcelVerdict } from '../../hooks/useParcelVerdict';
import useAuthStore from '../../store/authStore';
import ReadOnlyPropertyMap from '../maps/ReadOnlyPropertyMap';
import VerifyItemDialog from './VerifyItemDialog';

const EDITOR_ROLES = new Set(['admin', 'owner', 'editor', 'analyst']);

const TABS = [
  { key: 'verified', label: 'Verified' },
  { key: 'inferred', label: 'Inferred' },
  { key: 'needs_verification', label: 'Needs review' },
];

const CONFIDENCE_PILLARS = [
  { key: 'zoning', label: 'Zoning' },
  { key: 'buildability', label: 'Buildability' },
  { key: 'guidance', label: 'Guidance' },
  { key: 'kgis', label: 'K-GIS' },
];

const formatNumber = (value, maximumFractionDigits = 0) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric.toLocaleString('en-IN', { maximumFractionDigits });
};

const formatInr = (value) => {
  const formatted = formatNumber(value);
  return formatted === null ? null : `₹${formatted}`;
};

function CitationChip({ citation }) {
  if (!citation) return null;
  const label = citation.page ? `p. ${citation.page}` : citation.status || 'source';
  const title = [citation.label, citation.source_title, citation.authority].filter(Boolean).join(' — ');

  const content = (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-secondary px-2 py-0.5 text-[10px] font-medium text-content-secondary"
    >
      <FileText size={11} />
      {label}
    </span>
  );

  if (!citation.source_url) return content;

  return (
    <a href={citation.source_url} target="_blank" rel="noreferrer" className="inline-flex">
      {content}
    </a>
  );
}

function StatusPill({ status }) {
  const normalized = String(status || '').replace(/_/g, ' ');
  const good = ['reference match', 'matched', 'assigned reference', 'reference ready'].includes(normalized);
  const Icon = good ? CheckCircle2 : AlertTriangle;
  return (
    <Badge tone={good ? 'success' : 'warn'} className="gap-1">
      <Icon size={11} />
      {normalized || 'needs review'}
    </Badge>
  );
}

const VERDICT_ACCENT = {
  success: 'border-l-emerald-500',
  info: 'border-l-blue-500',
  warning: 'border-l-amber-500',
  danger: 'border-l-rose-500',
};
const VERDICT_ICON = {
  success: 'text-emerald-600',
  info: 'text-blue-600',
  warning: 'text-amber-600',
  danger: 'text-rose-600',
};

function VerdictBanner({ verdict }) {
  if (!verdict) return null;

  const tone = verdict.tone || 'info';
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
  const counts = [
    ['High', verdict.counts?.high || 0, 'text-rose-600'],
    ['Medium', verdict.counts?.medium || 0, 'text-amber-600'],
    ['Low', verdict.counts?.low || 0, 'text-content-secondary'],
    ['Open', verdict.counts?.needs_verification || 0, 'text-content-secondary'],
  ];

  return (
    <div
      className={clsx(
        'rounded-editorial border border-hairline border-l-4 bg-bg-elevated p-5',
        VERDICT_ACCENT[tone],
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <Icon size={22} className={clsx('mt-0.5 shrink-0', VERDICT_ICON[tone])} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="text-base font-semibold text-content-primary">{verdict.label}</h3>
              <span className="text-xs font-medium text-content-secondary tabular-nums">
                {verdict.confidence_pct}% confidence
              </span>
            </div>
            <p className="mt-1 text-sm text-content-secondary">{verdict.summary}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 lg:min-w-[280px]">
          {counts.map(([label, value, valueClass]) => (
            <div key={label} className="text-center">
              <div className={clsx('font-display text-xl font-semibold tabular-nums', valueClass)}>
                {value}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-content-muted">{label}</div>
            </div>
          ))}
        </div>
      </div>
      {!!verdict.next_actions?.length && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline-soft pt-3">
          {verdict.next_actions.slice(0, 3).map((action) => {
            const content = (
              <span className="inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-secondary px-3 py-1.5 text-xs font-medium text-content-primary hover:border-primary-300 transition-colors">
                {action.label}
                {action.href && <ExternalLink size={12} />}
              </span>
            );
            return action.href ? (
              <a key={action.label} href={action.href} target="_blank" rel="noreferrer">
                {content}
              </a>
            ) : (
              <span key={action.label}>{content}</span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, value, unit, citation }) {
  const isMissing = value === null || value === undefined || value === '';

  return (
    <div className="rounded-editorial border border-hairline bg-bg-elevated p-4 min-h-[124px] flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
          {label}
        </div>
        <CitationChip citation={citation} />
      </div>
      <div className="mt-auto pt-3">
        {isMissing ? (
          <>
            <div className="font-display text-2xl font-semibold text-content-muted tabular-nums">—</div>
            <div className="mt-1.5">
              <Badge tone="warn" className="gap-1 text-[10px]">
                Needs review
              </Badge>
            </div>
          </>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <div className="font-display text-2xl font-semibold text-content-primary tabular-nums truncate">
              {value}
            </div>
            {unit && <div className="text-sm text-content-muted shrink-0">{unit}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfidenceMeter({ confidence }) {
  const overall = Math.max(0, Math.min(1, Number(confidence?.overall || 0)));
  const pillarValues = CONFIDENCE_PILLARS.map((pillar) => ({
    ...pillar,
    value: Math.max(0, Math.min(1, Number(confidence?.[pillar.key] || 0))),
  }));

  const segmentTone = (value) => {
    if (value >= 0.7) return 'bg-emerald-500';
    if (value >= 0.4) return 'bg-amber-500';
    if (value > 0) return 'bg-rose-400';
    return 'bg-bg-secondary';
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
            Reference confidence
          </div>
          <div className="mt-1 text-xs text-content-secondary">
            Quality across zoning, buildability, guidance, and K-GIS.
          </div>
        </div>
        <div className="font-display text-3xl font-semibold text-content-primary tabular-nums">
          {Math.round(overall * 100)}
          <span className="text-base text-content-muted">%</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-1.5">
        {pillarValues.map((pillar) => (
          <div key={pillar.key} className="flex flex-col gap-1.5">
            <div className="h-1.5 rounded-full bg-bg-secondary overflow-hidden">
              <div
                className={clsx('h-full rounded-full transition-all', segmentTone(pillar.value))}
                style={{ width: `${pillar.value * 100}%` }}
              />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-[0.08em] text-content-muted">
                {pillar.label}
              </span>
              <span className="text-[11px] font-medium text-content-secondary tabular-nums">
                {Math.round(pillar.value * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RedFlags({ flags = [] }) {
  if (!flags.length) {
    return (
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="text-sm text-content-secondary">
            No high-priority parcel intelligence flags from the configured references.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="border-b border-hairline-soft px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
          Open flags
        </div>
      </div>
      <div className="divide-y divide-hairline-soft">
        {flags.map((flag, index) => (
          <div key={`${flag.label}-${index}`} className="flex items-start gap-3 px-4 py-3">
            <AlertTriangle
              size={14}
              className={clsx(
                'mt-0.5 shrink-0',
                flag.severity === 'high'
                  ? 'text-rose-600'
                  : flag.severity === 'medium'
                    ? 'text-amber-600'
                    : 'text-content-muted',
              )}
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-content-primary">{flag.label}</div>
              <div className="text-xs text-content-secondary mt-0.5 leading-relaxed">{flag.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function VerifiedPill({ verification, canEdit, onUnverify, isPending }) {
  const verifiedBy = verification.verified_by_name || verification.created_by_name || 'analyst';
  const url = verification.external_url;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Badge tone="success" className="gap-1">
        <CheckCircle2 size={11} />
        Verified · {verifiedBy}
      </Badge>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-content-secondary hover:text-content-primary"
        >
          source
          <ExternalLink size={10} />
        </a>
      ) : null}
      {canEdit && onUnverify ? (
        <button
          type="button"
          onClick={onUnverify}
          disabled={isPending}
          aria-label="Remove verification"
          className="rounded p-0.5 text-content-muted hover:text-rose-600 disabled:opacity-50"
        >
          <Trash2 size={11} />
        </button>
      ) : null}
    </div>
  );
}

function BucketList({
  items = [],
  empty,
  showVerifyAction = false,
  verificationsByKey = {},
  canEdit = false,
  onVerify,
  onUnverify,
  unverifyingId = null,
}) {
  if (!items.length) {
    return (
      <div className="rounded-editorial border border-hairline bg-bg-elevated px-4 py-6 text-sm text-content-secondary text-center">
        {empty}
      </div>
    );
  }

  return (
    <div className="rounded-editorial border border-hairline bg-bg-elevated divide-y divide-hairline-soft">
      {items.map((item, index) => {
        const verification = item.key ? verificationsByKey[item.key] : null;
        return (
          <div key={`${item.label}-${index}`} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-content-primary">{item.label}</div>
                <div className="text-sm text-content-secondary mt-1 leading-relaxed">{item.detail}</div>
                {item.source && (
                  <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-content-muted">
                    {item.source.replace(/_/g, ' ')}
                  </div>
                )}
                {verification ? (
                  <VerifiedPill
                    verification={verification}
                    canEdit={canEdit}
                    onUnverify={onUnverify ? () => onUnverify(verification) : undefined}
                    isPending={unverifyingId === verification.id}
                  />
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <div className="flex flex-wrap justify-end gap-1.5">
                  {(item.citations || []).map((citation) => (
                    <CitationChip key={citation.id || citation.label} citation={citation} />
                  ))}
                </div>
                {showVerifyAction && canEdit && item.key && !verification && onVerify ? (
                  <button
                    type="button"
                    onClick={() => onVerify(item)}
                    className="inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-secondary px-2.5 py-1.5 text-[11px] font-semibold text-content-primary hover:border-primary-300 transition-colors"
                  >
                    <CheckCircle2 size={12} />
                    Mark verified
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KgisPreview({ intelligence }) {
  const lat = intelligence?.inputs?.lat;
  const lng = intelligence?.inputs?.lng;
  const kgis = intelligence?.kgis;
  const hierarchy = kgis?.hierarchy || {};

  return (
    <Card className="p-0 overflow-hidden">
      {lat && lng ? (
        <ReadOnlyPropertyMap
          lat={lat}
          lng={lng}
          geometryGeojson={kgis?.geometry_geojson}
          title="Parcel reference point"
          heightClassName="h-56"
          zoom={15}
        />
      ) : (
        <div className="h-40 flex items-center justify-center bg-bg-secondary text-sm text-content-secondary">
          Add coordinates to enable K-GIS preview.
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <MapPin size={15} />
            K-GIS reference context
          </div>
          <StatusPill status={kgis?.status} />
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {[
            ['Village', hierarchy.village],
            ['Hobli', hierarchy.hobli],
            ['Taluk', hierarchy.taluk],
            ['District', hierarchy.district],
          ].map(([label, value]) => (
            <div key={label} className="rounded-editorial border border-hairline-soft bg-bg-secondary px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-content-muted">{label}</div>
              <div className="font-medium text-content-primary mt-1 truncate text-sm">
                {value || <span className="text-content-muted">—</span>}
              </div>
            </div>
          ))}
        </div>
        {kgis?.message ? (
          <div className="mt-3 text-xs text-content-secondary leading-relaxed">{kgis.message}</div>
        ) : null}
      </div>
    </Card>
  );
}

function VerificationLinks({ links = [], onUploadClick }) {
  const list = Array.isArray(links) ? links : [];
  const [copiedKey, setCopiedKey] = useState(null);

  const handleCopy = async (link) => {
    if (!link.copy_text || typeof navigator?.clipboard?.writeText !== 'function') return;
    try {
      await navigator.clipboard.writeText(link.copy_text);
      setCopiedKey(link.key);
      window.setTimeout(() => setCopiedKey((current) => (current === link.key ? null : current)), 1500);
    } catch {
      // clipboard denied — silently swallow; the open-link path still works
    }
  };

  if (!list.length) {
    if (!onUploadClick) return null;
    return (
      <button
        type="button"
        onClick={onUploadClick}
        className="inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-elevated px-3 py-2 text-xs font-medium text-content-primary hover:border-primary-300 transition-colors"
      >
        <Upload size={13} />
        Upload evidence
      </button>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((link) => (
          <div
            key={link.key}
            className="flex flex-col rounded-editorial border border-hairline bg-bg-elevated p-4 hover:border-hairline-strong transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-content-primary">{link.label}</span>
                  {link.deep_link ? <Badge tone="success" className="text-[10px]">deep link</Badge> : null}
                  {link.status === 'inputs_missing' ? (
                    <Badge tone="warn" className="text-[10px]">add inputs</Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-content-muted">
                  {link.authority}
                </div>
              </div>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-editorial border border-hairline bg-bg-secondary px-2.5 py-1 text-[11px] font-semibold text-content-primary hover:border-primary-300 transition-colors"
              >
                Open
                <ExternalLink size={11} />
              </a>
            </div>
            {link.purpose ? (
              <p className="mt-3 text-xs text-content-secondary leading-relaxed">{link.purpose}</p>
            ) : null}
            {link.hint ? (
              <p className="mt-2 text-[11px] leading-relaxed text-content-muted">{link.hint}</p>
            ) : null}
            {link.copy_text ? (
              <button
                type="button"
                onClick={() => handleCopy(link)}
                className="mt-auto pt-3 self-start inline-flex items-center gap-1 text-[11px] font-medium text-content-secondary hover:text-content-primary transition-colors"
              >
                {copiedKey === link.key ? '✓ Copied' : 'Copy parcel context'}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {onUploadClick ? (
        <button
          type="button"
          onClick={onUploadClick}
          className="mt-3 inline-flex items-center gap-1.5 rounded-editorial border border-dashed border-hairline bg-bg-elevated px-4 py-2 text-xs font-medium text-content-secondary hover:border-primary-300 hover:text-content-primary transition-colors"
        >
          <Upload size={13} />
          Upload evidence
        </button>
      ) : null}
    </>
  );
}

export default function ParcelIntelligencePanel({ property, deal, dealId, onUploadClick }) {
  const [activeTab, setActiveTab] = useState('verified');
  const [verifyTarget, setVerifyTarget] = useState(null);
  const propertyId = property?.id;
  const { data: intelligence, isLoading, isError, error } = useParcelIntelligence(propertyId);
  const refreshMutation = useRefreshParcelIntelligence();
  const verificationsQuery = useParcelVerifications(propertyId);
  const verifyMutation = useVerifyParcelItem();
  const unverifyMutation = useUnverifyParcelItem();
  const user = useAuthStore((state) => state.user);
  const canEdit = EDITOR_ROLES.has(String(user?.role || '').toLowerCase());
  const linkedDealId = dealId || deal?.id || null;

  const verificationsByKey = useMemo(() => {
    const list = verificationsQuery.data?.verifications || [];
    return list.reduce((acc, link) => {
      if (link.item_key) acc[link.item_key] = link;
      return acc;
    }, {});
  }, [verificationsQuery.data]);

  const handleVerify = ({ itemKey, externalUrl, notes }) => {
    verifyMutation.mutate(
      { propertyId, itemKey, externalUrl, notes },
      { onSuccess: () => setVerifyTarget(null) }
    );
  };

  const handleUnverify = (verification) => {
    unverifyMutation.mutate({ propertyId, linkId: verification.id });
  };

  const buildability = intelligence?.buildability;
  const values = buildability?.values || {};
  const farCitation = buildability?.citations?.[0];
  const guidance = intelligence?.guidance_value?.official;
  const guidanceCitation = guidance?.citations?.[0];
  const selectedGuidance = guidance?.selected;
  const verdict = useParcelVerdict(intelligence);
  const reviewQueueUrl = useMemo(() => {
    const params = new URLSearchParams({ status: 'pending' });
    if (linkedDealId) params.set('deal_id', linkedDealId);
    const reviewSearch = deal?.name || intelligence?.inputs?.name || property?.name || property?.address;
    if (reviewSearch) params.set('search', reviewSearch);
    return `/dashboard/settings/parcel-intelligence?${params.toString()}`;
  }, [deal?.name, intelligence?.inputs?.name, linkedDealId, property?.address, property?.name]);
  const authorityInputUrl = useMemo(() => {
    const params = new URLSearchParams({ status: 'all', action: 'authority_input' });
    if (linkedDealId) params.set('deal_id', linkedDealId);
    const reviewSearch = deal?.name || intelligence?.inputs?.name || property?.name || property?.address;
    if (reviewSearch) params.set('search', reviewSearch);
    return `/dashboard/settings/parcel-intelligence?${params.toString()}`;
  }, [deal?.name, intelligence?.inputs?.name, linkedDealId, property?.address, property?.name]);

  const bucket = useMemo(
    () => intelligence?.buckets?.[activeTab] || [],
    [activeTab, intelligence?.buckets],
  );

  if (!propertyId) {
    return (
      <ErrorState title="No linked property" tone="info">
        Link a property before running parcel intelligence.
      </ErrorState>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-28 rounded-editorial bg-bg-secondary animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-32 rounded-editorial bg-bg-secondary animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState title="Parcel intelligence unavailable" tone="danger">
        {error?.response?.data?.message || error?.message || 'The parcel intelligence API did not respond.'}
      </ErrorState>
    );
  }

  return (
    <div className="space-y-5">
      <VerdictBanner verdict={verdict} />

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <SectionHeader
            icon={ShieldCheck}
            eyebrow="Parcel intelligence"
            title={intelligence?.inputs?.name || 'Development parcel'}
            sub={intelligence?.legal_disclaimer}
            size="sm"
            className="mb-0"
          />
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={intelligence?.status} />
            <Link
              to={reviewQueueUrl}
              className="inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-elevated px-3 py-2 text-xs font-semibold text-content-primary hover:border-primary-300 transition-colors"
            >
              Review evidence
              <ExternalLink size={13} />
            </Link>
            <Link
              to={authorityInputUrl}
              className="inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-secondary px-3 py-2 text-xs font-semibold text-content-primary hover:border-primary-300 transition-colors"
            >
              Add authority input
              <ExternalLink size={13} />
            </Link>
            <button
              type="button"
              onClick={() => refreshMutation.mutate(propertyId)}
              disabled={refreshMutation.isPending}
              className="inline-flex items-center gap-2 rounded-editorial bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60 transition-colors"
            >
              <RefreshCw size={14} className={clsx(refreshMutation.isPending && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-5">
        <div className="space-y-5">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <MetricTile
              label="Planning zone"
              value={intelligence?.zoning?.zone_code}
              unit={intelligence?.zoning?.planning_zone ? `PZ-${intelligence.zoning.planning_zone}` : null}
            />
            <MetricTile
              label="Max FAR"
              value={formatNumber(values.max_far, 2)}
              citation={farCitation}
            />
            <MetricTile
              label="Base FAR"
              value={formatNumber(values.base_far, 2)}
              citation={farCitation}
            />
            <MetricTile
              label="Screening buildable"
              value={formatNumber(values.max_buildable_area_sqft)}
              unit="sqft"
              citation={farCitation}
            />
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <MetricTile
              label="Guidance value"
              value={formatInr(selectedGuidance?.value_inr_per_sqft)}
              unit={selectedGuidance?.value_inr_per_sqft ? '/ sqft' : null}
              citation={guidanceCitation}
            />
            <MetricTile
              label="Gross FAR area"
              value={formatNumber(values.gross_max_buildable_area_sqft)}
              unit="sqft"
              citation={farCitation}
            />
            <MetricTile
              label="Ground coverage"
              value={formatNumber(values.ground_coverage_pct, 1)}
              unit={values.ground_coverage_pct ? '%' : null}
              citation={farCitation}
            />
            <MetricTile
              label="Setback deduction"
              value={formatNumber(values.setback_deduction_pct, 1)}
              unit={
                values.setback_deduction_pct !== null && values.setback_deduction_pct !== undefined
                  ? '%'
                  : null
              }
              citation={farCitation}
            />
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-hairline-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
                  <Layers3 size={15} />
                  Evidence buckets
                </div>
                <p className="mt-1 text-xs text-content-secondary">
                  Verified source data, inferred calculations, and items pending authority or analyst review.
                </p>
              </div>
              <div
                role="tablist"
                className="inline-flex rounded-editorial border border-hairline bg-bg-secondary p-1"
              >
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={clsx(
                      'rounded px-3 py-1.5 text-xs font-medium transition-colors',
                      activeTab === tab.key
                        ? 'bg-bg-elevated text-content-primary shadow-sm'
                        : 'text-content-secondary hover:text-content-primary',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5">
              <BucketList
                items={bucket}
                empty={
                  activeTab === 'verified'
                    ? 'No reviewed source facts are configured for this parcel yet.'
                    : activeTab === 'inferred'
                      ? 'No calculations are available until required inputs are present.'
                      : 'No pending verification items.'
                }
                showVerifyAction={activeTab === 'needs_verification'}
                verificationsByKey={verificationsByKey}
                canEdit={canEdit}
                onVerify={(item) => setVerifyTarget(item)}
                onUnverify={handleUnverify}
                unverifyingId={unverifyMutation.isPending ? unverifyMutation.variables?.linkId : null}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <ConfidenceMeter confidence={intelligence?.confidence} />
          <RedFlags flags={intelligence?.red_flags || []} />
          <KgisPreview intelligence={intelligence} />
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="border-b border-hairline-soft px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <Landmark size={15} />
            Authority verification
          </div>
          <p className="mt-1 text-xs text-content-secondary">
            Use these links for manual authority checks. Upload resulting PDFs to promote facts into verified evidence.
          </p>
        </div>
        <div className="p-5">
          <VerificationLinks links={intelligence?.verification_links} onUploadClick={onUploadClick} />
        </div>
      </Card>

      <div className="rounded-editorial border border-hairline-soft bg-bg-secondary p-4">
        <div className="flex items-start gap-3">
          <Gauge size={14} className="mt-0.5 shrink-0 text-content-muted" />
          <div className="min-w-0 text-xs leading-relaxed text-content-secondary">
            Additional/TDR FAR, vendor guidance values, K-GIS geometries, Kaveri/e-Aasthi records, and uploaded extracts remain screening inputs until reviewed and approved. REDIP will surface them but never silently promote them into verified facts.
          </div>
        </div>
      </div>

      <VerifyItemDialog
        item={verifyTarget}
        onClose={() => setVerifyTarget(null)}
        onSubmit={handleVerify}
        isPending={verifyMutation.isPending}
      />
    </div>
  );
}
