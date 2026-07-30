import { useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, FileText, Layers, Ruler, Sparkles, Upload, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Skeleton } from '../../design-system';
import { useParcelIntelligence } from '../../hooks/useProperties';
import { useDealExtractions } from '../../hooks/useDealExtractions';
import BuildabilityMassing from './BuildabilityMassing';
import AutoFillFromDocumentsModal from './AutoFillFromDocumentsModal';

// The eight canonical extraction fields that, once committed, unlock
// the FAR matrix. Matches the keys the server's extraction.service
// produces in `field_map`. Kept tight on purpose — surfacing irrelevant
// extracted fields (owner name, RERA number) inside the buildability
// CTA would dilute the affordance.
const BUILDABILITY_EXTRACTION_FIELDS = Object.freeze([
  'land_area_sqft',
  'land_area_acres',
  'road_width_m',
  'road_width_mtrs',
  'permissible_fsi',
  'existing_fsi',
  'frontage_mtrs',
  'depth_mtrs',
]);

const fmtNum = (value, digits = 0) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toLocaleString('en-IN', { maximumFractionDigits: digits });
};

function SourceChip({ citation }) {
  if (!citation) return null;
  return (
    <span
      title={[citation.label, citation.source_title, citation.authority].filter(Boolean).join(' - ')}
      className="inline-flex items-center gap-1 rounded-full bg-bg-secondary px-2 py-0.5 text-[10px] font-medium text-content-secondary"
    >
      <FileText size={11} />
      {citation.page ? `p. ${citation.page}` : citation.status || 'source'}
    </span>
  );
}

export default function BuildabilitySummary({
  property,
  dealId = null,
  onUploadClick = null,
  title = 'Buildable envelope',
  compact = false,
}) {
  const propertyId = property?.id;
  const { data, isLoading, isError } = useParcelIntelligence(propertyId);
  // Deal-scoped pending extractions — only used to surface the auto-fill
  // CTA inside the "Buildability needs verification" empty state. Skipped
  // entirely when the panel is rendered standalone on PropertyDetailPage.
  const { data: extractionData } = useDealExtractions(dealId);
  const [autoFillOpen, setAutoFillOpen] = useState(false);

  // Pre-compute the subset of pending extractions that, if applied, would
  // unblock buildability. Numeric instead of just a boolean so the CTA can
  // say "Auto-fill 3 fields from documents" — that specificity is what
  // makes the affordance feel non-trivial vs the generic auto-fill banner
  // on the Overview top.
  const buildabilityExtractionCount = useMemo(() => {
    const map = extractionData?.field_map || {};
    return BUILDABILITY_EXTRACTION_FIELDS.reduce(
      (n, key) => (map[key] ? n + 1 : n),
      0,
    );
  }, [extractionData?.field_map]);

  if (!propertyId) return null;

  const values = data?.buildability?.values || {};
  const citation = data?.buildability?.citations?.[0];
  const hasBuildability = Boolean(values.max_far && values.max_buildable_area_sqft);
  const isReferenceMatch = data?.buildability?.status === 'reference_match';

  return (
    <div className="card-editorial p-0 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 bg-bg-elevated border-b border-hairline">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-content-inverse shadow-sm">
            <Building2 size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-secondary">Parcel intelligence</div>
            <div className="text-sm font-semibold text-content-primary truncate">{title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data?.zoning?.zone_code && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-accent-soft text-accent font-medium">
              {data.zoning.zone_code}
            </span>
          )}
          <SourceChip citation={citation} />
        </div>
      </div>

      <div className={clsx('p-4 sm:p-5', compact && 'p-3 sm:p-4')}>
        {isLoading ? (
          <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading buildable envelope">
            <Skeleton className="h-5 w-40 rounded" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="h-16 rounded-lg" ariaLabel={null} role="presentation" />
              ))}
            </div>
          </div>
        ) : isError || !hasBuildability ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-hairline bg-premium-soft px-3 py-2.5 text-xs text-premium">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold">Buildability needs verification</div>
                <div className="mt-0.5 leading-relaxed">
                  {data?.buildability?.message || 'A reviewed master-plan zone, the plot’s land area in sqft, and the road width in metres must be matched against the backend FAR matrix.'}
                </div>
                <ul className="mt-2 space-y-0.5 text-[11px] text-premium leading-relaxed">
                  <li className="flex items-start gap-1.5">
                    <span className="text-content-muted select-none">·</span>
                    <span>A reviewed master-plan zone for this parcel</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-content-muted select-none">·</span>
                    <span>Land area in sqft</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-content-muted select-none">·</span>
                    <span>Road width in metres (drives the additional/TDR FAR band)</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Action affordance — only renders when the panel is mounted
                inside a deal context that has a dealId. PropertyDetailPage
                still gets a clean read-only empty state. */}
            {dealId && (
              buildabilityExtractionCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setAutoFillOpen(true)}
                  className="w-full inline-flex items-center justify-between gap-3 rounded-md border border-hairline-strong bg-bg-elevated hover:bg-bg-secondary transition-colors px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={`Auto-fill ${buildabilityExtractionCount} buildability fields from extracted documents`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-md bg-accent-soft flex items-center justify-center flex-shrink-0">
                      <Sparkles size={13} className="text-accent" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-content-primary">
                        Auto-fill {buildabilityExtractionCount} buildability field{buildabilityExtractionCount === 1 ? '' : 's'} from documents
                      </span>
                      <span className="block text-[11px] text-content-secondary leading-snug truncate">
                        FSI, road width, and area extracted from uploads — review side-by-side, then commit.
                      </span>
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-content-muted shrink-0" />
                </button>
              ) : onUploadClick ? (
                <button
                  type="button"
                  onClick={onUploadClick}
                  className="w-full inline-flex items-center justify-between gap-3 rounded-md border border-dashed border-hairline-strong bg-bg-elevated hover:border-accent hover:text-content-primary transition-colors px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label="Upload a sanctioned plan or RTC to populate buildability fields"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-md bg-bg-secondary flex items-center justify-center flex-shrink-0">
                      <Upload size={13} className="text-content-secondary" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-content-primary">
                        Upload a sanctioned plan or RTC
                      </span>
                      <span className="block text-[11px] text-content-secondary leading-snug truncate">
                        Acureal extracts FSI, road width, and land area from uploaded documents.
                      </span>
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-content-muted shrink-0" />
                </button>
              ) : null
            )}

            {/* Modal — opens with the deal's current values pre-loaded.
                The modal is the same one mounted from the AutoFillReadyCard
                on the Overview top + the Documents-tab header. */}
            {dealId && (
              <AutoFillFromDocumentsModal
                dealId={dealId}
                open={autoFillOpen}
                onClose={() => setAutoFillOpen(false)}
                dealCurrentValues={property || {}}
                propertyCurrentValues={property || {}}
              />
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-secondary">Max FAR</span>
                <span className="text-2xl font-bold text-content-primary">{fmtNum(values.max_far, 2)}</span>
                <span className="text-[11px] text-content-secondary">
                  {fmtNum(values.base_far, 2)} base
                  {values.additional_far > 0 ? ` + ${fmtNum(values.additional_far, 2)} additional/TDR` : ''}
                </span>
              </div>
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                  isReferenceMatch ? 'bg-pos-soft text-data-positive' : 'bg-premium-soft text-premium',
                )}
              >
                {isReferenceMatch ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                {data.buildability.status.replace(/_/g, ' ')}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile
                icon={Building2}
                tone="emerald"
                label="Max built-up"
                value={fmtNum(values.max_buildable_area_sqft)}
                unit="sqft"
              />
              <Tile
                icon={Layers}
                tone="primary"
                label="Base built-up"
                value={fmtNum(values.base_buildable_area_sqft)}
                unit="sqft"
              />
              <Tile
                icon={Ruler}
                tone="indigo"
                label="Ground cov."
                value={fmtNum(values.ground_coverage_pct, 1)}
                unit="%"
              />
              <Tile
                icon={Ruler}
                tone="amber"
                label="Front setback"
                value={fmtNum(values.front_setback_m, 2)}
                unit="m"
              />
            </div>

            {/* Workstream E — the spatial canvas. An axonometric massing of
                the buildable envelope, drawn deterministically from the
                values above. Self-hides when land area / coverage is
                missing, and on the compact embed. */}
            {!compact && (
              <BuildabilityMassing
                values={values}
                landAreaSqft={property?.land_area_sqft}
                className="mt-4 pt-4 border-t border-hairline"
              />
            )}

            {data?.buildability?.message && (
              <div className="mt-3 text-[11px] leading-relaxed text-content-secondary">
                {data.buildability.message}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ icon: Icon, tone, label, value, unit }) {
  const tones = {
    primary: 'bg-accent-soft text-accent',
    emerald: 'bg-pos-soft text-data-positive',
    indigo: 'bg-accent-soft text-accent',
    amber: 'bg-premium-soft text-premium',
  };
  return (
    <div className={clsx('rounded-lg p-2.5 min-w-0', tones[tone] || tones.primary)}>
      <div className="flex items-center gap-1 mb-0.5">
        {Icon && <Icon size={11} className="opacity-70 flex-shrink-0" />}
        <span className="text-[10px] uppercase tracking-[0.1em] font-medium opacity-75 truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 min-w-0">
        <span className="text-sm sm:text-base font-bold leading-none truncate">{value}</span>
        {unit && value !== '-' && <span className="text-[10px] opacity-70 flex-shrink-0">{unit}</span>}
      </div>
    </div>
  );
}
