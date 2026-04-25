import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, ErrorState, SectionHeader } from '../../design-system';
import { useParcelIntelligence, useRefreshParcelIntelligence } from '../../hooks/useProperties';

const TABS = [
  { key: 'verified', label: 'Verified' },
  { key: 'inferred', label: 'Inferred' },
  { key: 'needs_verification', label: 'Needs Verification' },
];

const formatNumber = (value, maximumFractionDigits = 0) => {
  if (value === null || value === undefined || value === '') return 'Needs verification';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Needs verification';
  return numeric.toLocaleString('en-IN', { maximumFractionDigits });
};

const formatInr = (value) => {
  if (value === null || value === undefined || value === '') return 'Needs verification';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Needs verification';
  return `INR ${numeric.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

function CitationChip({ citation }) {
  if (!citation) return null;
  const label = citation.page ? `p. ${citation.page}` : citation.status || 'source';
  const title = [citation.label, citation.source_title, citation.authority].filter(Boolean).join(' - ');

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
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        good ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
      )}
    >
      {good ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {normalized || 'needs verification'}
    </span>
  );
}

function MetricTile({ label, value, unit, citation, tone = 'default' }) {
  const toneClass = {
    default: 'border-hairline bg-bg-elevated',
    blue: 'border-blue-100 bg-blue-50/60',
    green: 'border-emerald-100 bg-emerald-50/60',
    amber: 'border-amber-100 bg-amber-50/60',
  }[tone];

  return (
    <div className={clsx('rounded-editorial border p-4 min-h-[118px]', toneClass)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-content-muted">{label}</div>
        <CitationChip citation={citation} />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <div className="font-display text-2xl font-semibold text-content-primary tabular-nums">{value}</div>
        {unit && <div className="text-sm text-content-muted">{unit}</div>}
      </div>
    </div>
  );
}

function ConfidenceMeter({ confidence }) {
  const value = Math.max(0, Math.min(1, Number(confidence?.overall || 0)));
  return (
    <div className="rounded-editorial border border-hairline bg-bg-elevated p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-content-primary">Confidence</div>
          <div className="text-xs text-content-secondary">Reference quality across zoning, buildability, guidance, and K-GIS.</div>
        </div>
        <div className="font-display text-2xl font-semibold text-content-primary">{Math.round(value * 100)}%</div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-bg-secondary overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${value * 100}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-content-secondary">
        {['zoning', 'buildability', 'guidance', 'kgis'].map((key) => (
          <div key={key} className="flex justify-between rounded bg-bg-secondary px-2 py-1">
            <span className="capitalize">{key}</span>
            <span>{Math.round(Number(confidence?.[key] || 0) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RedFlags({ flags = [] }) {
  if (!flags.length) {
    return (
      <div className="rounded-editorial border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
        No high-priority parcel intelligence flags from the configured references.
      </div>
    );
  }

  return (
    <div className="rounded-editorial border border-hairline bg-bg-elevated divide-y divide-hairline">
      {flags.map((flag, index) => (
        <div key={`${flag.label}-${index}`} className="flex items-start gap-3 p-3">
          <AlertTriangle
            size={16}
            className={clsx(
              'mt-0.5 shrink-0',
              flag.severity === 'high' ? 'text-rose-600' : flag.severity === 'medium' ? 'text-amber-600' : 'text-content-muted',
            )}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-content-primary">{flag.label}</div>
            <div className="text-xs text-content-secondary mt-0.5">{flag.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BucketList({ items = [], empty }) {
  if (!items.length) {
    return (
      <div className="rounded-editorial border border-hairline bg-bg-elevated p-4 text-sm text-content-secondary">
        {empty}
      </div>
    );
  }

  return (
    <div className="rounded-editorial border border-hairline bg-bg-elevated divide-y divide-hairline">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-content-primary">{item.label}</div>
              <div className="text-sm text-content-secondary mt-1">{item.detail}</div>
              {item.source && (
                <div className="mt-2 text-[11px] uppercase tracking-[0.12em] text-content-muted">{item.source.replace(/_/g, ' ')}</div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
              {(item.citations || []).map((citation) => (
                <CitationChip key={citation.id || citation.label} citation={citation} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function KgisPreview({ intelligence }) {
  const lat = intelligence?.inputs?.lat;
  const lng = intelligence?.inputs?.lng;
  const kgis = intelligence?.kgis;
  const hierarchy = kgis?.hierarchy || {};

  return (
    <div className="rounded-editorial border border-hairline bg-bg-elevated overflow-hidden">
      {lat && lng ? (
        <div className="h-64">
          <MapContainer center={[lat, lng]} zoom={15} scrollWheelZoom={false} className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <CircleMarker center={[lat, lng]} radius={8} pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.45 }}>
              <Popup>Parcel reference point</Popup>
            </CircleMarker>
          </MapContainer>
        </div>
      ) : (
        <div className="h-40 flex items-center justify-center bg-bg-secondary text-sm text-content-secondary">
          Add coordinates to enable K-GIS preview.
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <MapPin size={15} />
            K-GIS Reference Context
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
            <div key={label} className="rounded bg-bg-secondary px-3 py-2">
              <div className="text-content-muted">{label}</div>
              <div className="font-medium text-content-primary mt-0.5 truncate">{value || 'Needs verification'}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-content-secondary">{kgis?.message}</div>
      </div>
    </div>
  );
}

function VerificationLinks({ links = {}, onUploadClick }) {
  const items = [
    ['Kaveri', links.kaveri],
    ['BBMP e-Aasthi', links.bbmp_eaasthi],
    ['IGR Guidance', links.igr_guidance],
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([label, href]) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-elevated px-3 py-2 text-xs font-medium text-content-primary hover:border-primary-300"
        >
          {label}
          <ExternalLink size={13} />
        </a>
      ))}
      {onUploadClick && (
        <button
          type="button"
          onClick={onUploadClick}
          className="inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-elevated px-3 py-2 text-xs font-medium text-content-primary hover:border-primary-300"
        >
          Upload Evidence
          <FileText size={13} />
        </button>
      )}
    </div>
  );
}

export default function ParcelIntelligencePanel({ property, onUploadClick }) {
  const [activeTab, setActiveTab] = useState('verified');
  const propertyId = property?.id;
  const { data: intelligence, isLoading, isError, error } = useParcelIntelligence(propertyId);
  const refreshMutation = useRefreshParcelIntelligence();

  const buildability = intelligence?.buildability;
  const values = buildability?.values || {};
  const farCitation = buildability?.citations?.[0];
  const guidance = intelligence?.guidance_value?.official;
  const guidanceCitation = guidance?.citations?.[0];
  const selectedGuidance = guidance?.selected;

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
      <div className="space-y-4">
        <div className="h-24 rounded-editorial bg-bg-secondary animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-28 rounded-editorial bg-bg-secondary animate-pulse" />
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
            <button
              type="button"
              onClick={() => refreshMutation.mutate(propertyId)}
              disabled={refreshMutation.isPending}
              className="inline-flex items-center gap-2 rounded-editorial bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              <RefreshCw size={14} className={clsx(refreshMutation.isPending && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
        <div className="space-y-5">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <MetricTile
              label="Planning zone"
              value={intelligence?.zoning?.zone_code || 'Needs verification'}
              unit={intelligence?.zoning?.planning_zone ? `PZ-${intelligence.zoning.planning_zone}` : null}
              tone={intelligence?.zoning?.zone_code ? 'green' : 'amber'}
            />
            <MetricTile
              label="Max FAR"
              value={formatNumber(values.max_far, 2)}
              citation={farCitation}
              tone={values.max_far ? 'blue' : 'amber'}
            />
            <MetricTile
              label="Base FAR"
              value={formatNumber(values.base_far, 2)}
              citation={farCitation}
            />
            <MetricTile
              label="Buildable area"
              value={formatNumber(values.max_buildable_area_sqft)}
              unit="sqft"
              citation={farCitation}
              tone={values.max_buildable_area_sqft ? 'green' : 'amber'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <MetricTile
              label="Guidance value"
              value={formatInr(selectedGuidance?.value_inr_per_sqft)}
              unit={selectedGuidance?.value_inr_per_sqft ? '/ sqft' : null}
              citation={guidanceCitation}
              tone={selectedGuidance?.value_inr_per_sqft ? 'green' : 'amber'}
            />
            <MetricTile
              label="Ground coverage"
              value={formatNumber(values.ground_coverage_pct, 1)}
              unit={values.ground_coverage_pct ? '%' : null}
              citation={farCitation}
            />
            <MetricTile
              label="Front setback"
              value={formatNumber(values.front_setback_m, 2)}
              unit={values.front_setback_m ? 'm' : null}
              citation={farCitation}
            />
          </div>

          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
                  <Layers3 size={15} />
                  Evidence Buckets
                </div>
                <p className="mt-1 text-xs text-content-secondary">
                  Values are separated by verified source data, inferred calculations, and items requiring authority or analyst review.
                </p>
              </div>
              <div className="inline-flex rounded-editorial border border-hairline bg-bg-secondary p-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
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
            <div className="mt-4">
              <BucketList
                items={bucket}
                empty={
                  activeTab === 'verified'
                    ? 'No reviewed source facts are configured for this parcel yet.'
                    : activeTab === 'inferred'
                      ? 'No calculations are available until required inputs are present.'
                      : 'No pending verification items.'
                }
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

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
              <Landmark size={15} />
              Authority Verification
            </div>
            <div className="mt-1 text-xs text-content-secondary">
              Use these links for manual authority checks and upload resulting PDFs for reviewed facts.
            </div>
          </div>
          <VerificationLinks links={intelligence?.verification_links} onUploadClick={onUploadClick} />
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Gauge size={16} className="mt-0.5 text-content-muted" />
          <div className="min-w-0 text-xs leading-relaxed text-content-secondary">
            Additional/TDR FAR, vendor guidance values, K-GIS geometries, Kaveri/e-Aasthi records, and uploaded extracts remain screening inputs until reviewed and approved. REDIP will show them, but it will not silently promote them into verified facts.
          </div>
        </div>
      </Card>
    </div>
  );
}
