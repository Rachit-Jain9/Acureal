import { ShieldAlert, CheckCircle, HelpCircle, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { useRiskRadar } from '../../hooks/useRiskFlags';

/**
 * Risk Radar — Workstream B ("the Risk Sentinel").
 *
 * A standing, deterministic pre-mortem at the top of the Risk tab. For each
 * failure mode that sinks Indian real-estate deals it shows a posture —
 * cleared / not-verified / flagged — synthesised server-side from the deal's
 * risk flags, due-diligence items, and approvals. "Not verified" is a
 * first-class state: REDIP warns about what hasn't been checked, not just
 * what has gone wrong.
 */

const POSTURE = {
  cleared: {
    label: 'Cleared',
    Icon: CheckCircle,
    color: 'text-green-600',
    chip: 'bg-green-50 text-green-700 border-green-200',
  },
  unverified: {
    label: 'Not verified',
    Icon: HelpCircle,
    color: 'text-amber-600',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  flagged: {
    label: 'Flagged',
    Icon: AlertTriangle,
    color: 'text-red-600',
    chip: 'bg-red-50 text-red-700 border-red-200',
  },
};

const OVERALL_COPY = {
  cleared: 'Every assessed failure mode is cleared.',
  unverified: 'Some failure modes have not been fully verified yet.',
  flagged: 'One or more failure modes have an active risk flag.',
};

const SIGNAL_TONE = {
  negative: 'text-red-700',
  warn: 'text-amber-700',
  positive: 'text-green-700',
  neutral: 'text-content-muted',
};

function CategoryRow({ category }) {
  const cfg = POSTURE[category.posture] || POSTURE.unverified;
  const { Icon } = cfg;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-hairline last:border-0">
      <Icon size={18} className={clsx('shrink-0 mt-0.5', cfg.color)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-content-primary">{category.label}</span>
          <span
            className={clsx(
              'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
              cfg.chip,
            )}
          >
            {cfg.label}
          </span>
        </div>
        {category.signals?.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {category.signals.map((s, i) => (
              <li key={i} className={clsx('text-xs', SIGNAL_TONE[s.tone] || 'text-content-muted')}>
                {s.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function RiskRadarPanel({ dealId }) {
  const { data: radar, isLoading, isError, refetch } = useRiskRadar(dealId);

  if (isLoading) {
    return (
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-3">
          <ShieldAlert size={16} className="text-content-muted" />
          Risk Radar
        </h3>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="redip-skeleton h-10 w-full rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !radar) {
    return (
      <div className="card-editorial">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <ShieldAlert size={16} className="text-content-muted" />
            Risk Radar
          </h3>
          <button type="button" onClick={() => refetch()} className="btn btn-secondary text-xs">
            Retry
          </button>
        </div>
        <p className="text-xs text-content-muted mt-2">
          Couldn&apos;t load the risk radar — this is a display issue, your data is safe.
        </p>
      </div>
    );
  }

  const overall = POSTURE[radar.overall_posture] || POSTURE.unverified;

  return (
    <div className="card-editorial">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <ShieldAlert size={16} className={overall.color} />
          Risk Radar
        </h3>
        <span
          className={clsx(
            'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0',
            overall.chip,
          )}
        >
          {overall.label}
        </span>
      </div>
      <p className="text-xs text-content-muted mb-2 max-w-2xl">
        A standing pre-mortem across the failure modes that sink Indian real-estate deals —
        what is cleared, what is flagged, and what has not been verified yet.{' '}
        {OVERALL_COPY[radar.overall_posture] || ''}
      </p>
      <div>
        {radar.categories.map((c) => (
          <CategoryRow key={c.key} category={c} />
        ))}
      </div>
    </div>
  );
}
