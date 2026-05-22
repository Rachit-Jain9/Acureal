import { AlertTriangle, Building2, CheckCircle2, FileText, Layers, Ruler } from 'lucide-react';
import clsx from 'clsx';
import { useParcelIntelligence } from '../../hooks/useProperties';
import BuildabilityMassing from './BuildabilityMassing';

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

export default function BuildabilitySummary({ property, title = 'Buildable envelope', compact = false }) {
  const propertyId = property?.id;
  const { data, isLoading, isError } = useParcelIntelligence(propertyId);

  if (!propertyId) return null;

  const values = data?.buildability?.values || {};
  const citation = data?.buildability?.citations?.[0];
  const hasBuildability = Boolean(values.max_far && values.max_buildable_area_sqft);
  const isReferenceMatch = data?.buildability?.status === 'reference_match';

  return (
    <div className="card-editorial p-0 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 bg-bg-elevated border-b border-hairline">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white shadow-sm">
            <Building2 size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-secondary">Parcel intelligence</div>
            <div className="text-sm font-semibold text-content-primary truncate">{title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data?.zoning?.zone_code && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 font-medium">
              {data.zoning.zone_code}
            </span>
          )}
          <SourceChip citation={citation} />
        </div>
      </div>

      <div className={clsx('p-4 sm:p-5', compact && 'p-3 sm:p-4')}>
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-bg-secondary animate-pulse" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="h-16 rounded-lg bg-bg-secondary animate-pulse" />
              ))}
            </div>
          </div>
        ) : isError || !hasBuildability ? (
          <div>
            <div className="flex items-start gap-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Buildability needs verification</div>
                <div className="mt-0.5">
                  {data?.buildability?.message || 'Assign a reviewed zone, land area, and road width to calculate the backend FAR matrix.'}
                </div>
              </div>
            </div>
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
                  isReferenceMatch ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
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
    primary: 'bg-primary-50/70 text-primary-800',
    emerald: 'bg-emerald-50/70 text-emerald-800',
    indigo: 'bg-indigo-50/70 text-indigo-800',
    amber: 'bg-amber-50/70 text-amber-800',
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
