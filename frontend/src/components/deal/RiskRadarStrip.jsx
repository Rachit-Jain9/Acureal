import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useRiskRadar } from '../../hooks/useRiskFlags';

/**
 * Risk Radar strip — Workstream B ("the Risk Sentinel"), Overview surface.
 *
 * The full Risk Radar lives on the Risk tab; a sentinel, though, must be seen
 * on the deal's front page. This is the compact form: one line per failure
 * mode with its posture, pinned to the Overview tab and linking through to the
 * full radar. Reuses the same /risk/radar read — no extra backend.
 */

// Short labels for the compact strip (the Risk tab uses the long form).
const SHORT_LABEL = {
  title_ownership: 'Title',
  approvals_regulatory: 'Approvals',
  financial: 'Financial',
  physical_technical: 'Physical',
  market: 'Market',
  promoter_execution: 'Promoter',
};

const POSTURE = {
  cleared: { label: 'Cleared', dot: 'bg-green-500', text: 'text-green-700' },
  unverified: { label: 'Not verified', dot: 'bg-amber-500', text: 'text-amber-700' },
  flagged: { label: 'Flagged', dot: 'bg-red-500', text: 'text-red-700' },
};

const OVERALL = {
  cleared: { label: 'Cleared', tone: 'text-green-700', icon: 'text-green-600' },
  unverified: { label: 'Not verified', tone: 'text-amber-700', icon: 'text-amber-600' },
  flagged: { label: 'Flagged', tone: 'text-red-700', icon: 'text-red-600' },
};

export default function RiskRadarStrip({ dealId }) {
  const { data: radar, isLoading, isError } = useRiskRadar(dealId);

  if (isLoading) {
    return (
      <div className="bg-bg-elevated border border-hairline rounded-editorial p-3">
        <div className="redip-skeleton h-5 w-full rounded" />
      </div>
    );
  }

  // Secondary surface: if the radar can't load, stay quiet rather than putting
  // an error on the deal's front page — the Risk tab is the authoritative view.
  if (isError || !radar || !Array.isArray(radar.categories)) return null;

  const overall = OVERALL[radar.overall_posture] || OVERALL.unverified;

  return (
    <Link
      to={`/dashboard/deals/${dealId}?tab=risk`}
      className="block bg-bg-elevated border border-hairline rounded-editorial p-3 transition-colors duration-150 ease-out hover:border-primary-300 active:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <ShieldAlert size={15} className={clsx('shrink-0', overall.icon)} aria-hidden="true" />
          <span className="text-eyebrow uppercase text-content-muted font-medium tracking-wider text-[10px]">
            Risk Radar
          </span>
          <span className={clsx('text-xs font-medium', overall.tone)}>{overall.label}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-accent shrink-0">
          View detail <ArrowRight size={12} />
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-x-5 gap-y-1.5 flex-wrap">
        {radar.categories.map((c) => {
          const p = POSTURE[c.posture] || POSTURE.unverified;
          return (
            <div key={c.key} className="flex items-center gap-1.5">
              <span
                className={clsx('w-2 h-2 rounded-full shrink-0', p.dot)}
                aria-hidden="true"
              />
              <span className="text-xs text-content-secondary">
                {SHORT_LABEL[c.key] || c.label}
              </span>
              <span className={clsx('text-xs font-medium', p.text)}>{p.label}</span>
            </div>
          );
        })}
      </div>
    </Link>
  );
}
