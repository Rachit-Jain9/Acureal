import { useState } from 'react';
import {
  Stethoscope, ChevronRight, ChevronDown, AlertOctagon, AlertTriangle, Info, FileSearch,
  RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDealContext } from '../../hooks/useDealContext';
import { GuideHelp } from '../../design-system';
import { useEvidenceNavigate } from '../../hooks/useEvidenceNavigate';
import { isNavigableRef } from '../../utils/evidenceRef';
import { formatRelativeTime } from '../../utils/format';

/**
 * DealDoctorPanel — Acureal Pending §5.8.
 *
 * Diagnostic view over the same signal set the Recommendation Engine consumes.
 * Surfaced on the Risk tab. Findings grouped by diagnostic theme (Underwriting,
 * Market & comps, Execution & data, Legal carve-out). Verbs are observational:
 * Diverges / Lacks support / Inconsistent / Below benchmark / Above benchmark /
 * Missing.
 *
 * Legal-carve-out findings ship deterministic templates (RERA, approvals,
 * title, encumbrance) — the AI narrator is bypassed for those.
 *
 * Tone bar: institutional / analytical / sharp / diagnostic. Server-side tone
 * classifier rejects theatrical or slander-grade narrations before they land.
 */

const VERB_TONE = {
  Diverges:           'bg-premium-soft text-premium border-hairline',
  'Lacks support':    'bg-neg-soft text-data-negative border-hairline',
  Inconsistent:       'bg-premium-soft text-premium border-hairline',
  'Below benchmark':  'bg-neg-soft text-data-negative border-hairline',
  'Above benchmark':  'bg-accent-soft text-accent border-hairline',
  Missing:            'bg-bg-secondary text-content-secondary border-hairline',
};

const GROUP_ICON = {
  underwriting: AlertOctagon,
  market: AlertTriangle,
  execution: Info,
  legal: Info,
};

const severityIcon = (severity) => {
  if (severity >= 4) return <AlertOctagon size={14} className="text-data-negative" />;
  if (severity >= 3) return <AlertTriangle size={14} className="text-premium" />;
  return <Info size={14} className="text-content-muted" />;
};

function FindingCard({ finding }) {
  const [open, setOpen] = useState(false);
  const navigateToEvidence = useEvidenceNavigate();
  const verbCls = VERB_TONE[finding.verb] || 'bg-bg-secondary text-content-secondary border-hairline';

  return (
    <div className="border border-hairline rounded-md bg-surface px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 mt-0.5">{severityIcon(finding.severity)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className={clsx(
                'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
                verbCls,
              )}
            >
              {finding.verb}
            </span>
            {!finding.ai_narratable && (
              <span className="text-[10px] uppercase tracking-wider text-content-muted italic">
                Deterministic
              </span>
            )}
          </div>
          <div className="text-sm text-content-primary leading-snug">{finding.finding}</div>
          {finding.why_it_matters && (
            <div className="text-xs text-content-secondary mt-1 leading-relaxed italic">
              Why it matters — {finding.why_it_matters}
            </div>
          )}
          {Array.isArray(finding.evidence) && finding.evidence.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-1.5 text-[11px] inline-flex items-center gap-1 text-content-secondary hover:text-content-primary"
              aria-expanded={open}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {open ? 'Hide evidence' : `Show evidence (${finding.evidence.length})`}
            </button>
          )}
          {open && Array.isArray(finding.evidence) && finding.evidence.length > 0 && (
            <ul className="mt-1.5 space-y-1 border-t border-hairline pt-1.5">
              {finding.evidence.map((e, i) => {
                const navigable = isNavigableRef(e.ref);
                if (navigable) {
                  return (
                    <li key={i} className="text-[11px] flex items-start gap-1.5">
                      <FileSearch size={11} className="mt-0.5 shrink-0 text-content-muted" />
                      <button
                        type="button"
                        onClick={() => navigateToEvidence(e.ref)}
                        className="text-left text-content-secondary hover:text-accent underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
                        title={`Jump to ${e.ref}`}
                      >
                        {e.label}{e.ref ? ` — ${e.ref}` : ''}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={i} className="text-[11px] text-content-muted flex items-start gap-1.5">
                    <FileSearch size={11} className="mt-0.5 shrink-0" />
                    <span>{e.label}{e.ref ? ` — ${e.ref}` : ''}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function DiagnosticGroup({ group }) {
  const Icon = GROUP_ICON[group.key] || Info;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} className="text-content-muted" />
        <span className="text-xs uppercase tracking-wider text-content-secondary font-medium">
          {group.label}
        </span>
        <span className="text-[10px] text-content-muted">
          ({group.findings.length})
        </span>
      </div>
      <div className="space-y-2">
        {group.findings.map((f) => (
          <FindingCard key={f.id} finding={f} />
        ))}
      </div>
    </div>
  );
}

export default function DealDoctorPanel({ dealDoctor }) {
  const { refetch, isLoading, isAiPending } = useDealContext();
  const groups = Array.isArray(dealDoctor?.groups) ? dealDoctor.groups : [];
  const totalFindings = dealDoctor?.finding_count || 0;
  const generatedAt = dealDoctor?.generated_at || null;

  return (
    <div className="card-editorial">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <Stethoscope size={16} className="text-content-muted" />
          Deal Doctor
          <GuideHelp topic="deal.deal-doctor" label="Deal Doctor" />
          {totalFindings > 0 && (
            <span className="text-xs text-content-muted ml-1">
              ({totalFindings} finding{totalFindings === 1 ? '' : 's'})
            </span>
          )}
        </h3>
        {generatedAt && (
          <button
            type="button"
            onClick={() => refetch?.()}
            disabled={isLoading}
            aria-label="Refresh Deal Doctor"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-content-muted hover:text-content-secondary px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            <RefreshCw size={11} className={clsx(isLoading && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="text-sm text-content-muted py-4 text-center">
          No diagnostic findings yet — either the deal looks clean against current
          benchmarks, or there isn't enough data on file to evaluate.
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <DiagnosticGroup key={g.key} group={g} />
          ))}
        </div>
      )}
      {generatedAt && totalFindings > 0 && (
        <div className="mt-4 pt-2 border-t border-hairline text-[10px] text-content-muted">
          computed {formatRelativeTime(generatedAt)}
          {isAiPending && <span className="text-accent"> · refining wording with AI…</span>}
        </div>
      )}
    </div>
  );
}
