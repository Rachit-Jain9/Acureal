import { BarChart3, Loader2, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { useOrgBenchmarkSetting, useSetOrgBenchmarkSetting } from '../../hooks/useOrgBenchmarkSetting';

/**
 * Org benchmark-contribution card — Workstream C2.
 *
 * The owner/admin control for the org-level half of the Layer-4 anonymized-
 * benchmark consent gate (docs/DATA_GOVERNANCE.md §3): whether this
 * organisation has opted out of contributing de-identified deal data to the
 * planned market-benchmark layer. Rendered in the owner/admin section of the
 * Settings page; SettingsPage gates visibility.
 */

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Switch — mirrors the Privacy Centre consent toggle so the two consent
// surfaces feel identical. Worth extracting to a shared design-system
// primitive once a third use appears.
function Switch({ checked, busy, onChange, labelledById }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledById}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border',
        'transition-colors duration-150 ease-out active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-accent border-accent' : 'bg-bg-secondary border-hairline-strong',
      )}
    >
      <span
        className={clsx(
          'inline-flex h-4 w-4 items-center justify-center transform rounded-full bg-bg-elevated shadow-sm',
          'transition-transform duration-150 ease-out',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      >
        {busy && <Loader2 size={10} className="animate-spin text-accent" />}
      </span>
    </button>
  );
}

export default function OrgBenchmarkCard() {
  const { data, isLoading, isError, refetch } = useOrgBenchmarkSetting();
  const setMutation = useSetOrgBenchmarkSetting();

  const optedOut = data?.opted_out === true;
  const available = data?.available !== false;
  const lastChange = Array.isArray(data?.history) ? data.history[0] : null;
  const eligibility = data?.your_eligibility || null;
  const lastChangeDate = fmtDate(lastChange?.created_at);

  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
      <h3 className="text-base font-semibold text-content-primary mb-1 flex items-center gap-2">
        <BarChart3 size={18} />
        Market benchmark contribution
      </h3>
      <p className="text-xs text-content-secondary mb-4 leading-relaxed">
        Acureal is building an anonymized market-benchmark layer — de-identified deal
        facts pooled across organisations so every deal can be measured against the
        real market. Contribution is gated twice over: each user opts in for their
        own data in their Privacy Centre, and an owner or admin can opt the whole
        organisation out here. No benchmark feature is live yet — this control
        records your organisation's position ahead of it.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-content-muted py-3">
          <Loader2 size={14} className="animate-spin" />
          Loading benchmark setting…
        </div>
      )}

      {!isLoading && isError && (
        <div className="flex items-start gap-2 rounded-lg border border-hairline bg-premium-soft p-3 text-xs text-premium">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-premium" />
          <span>
            Couldn't load the benchmark setting.{' '}
            <button
              type="button"
              onClick={() => refetch()}
              className="underline hover:no-underline focus-visible:outline-none"
            >
              Try again
            </button>
          </span>
        </div>
      )}

      {!isLoading && !isError && data && !available && (
        <p className="text-sm text-content-muted py-3">
          Benchmark settings are being set up. This control will become available
          shortly.
        </p>
      )}

      {!isLoading && !isError && data && available && (
        <>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-hairline p-4">
            <div className="min-w-0">
              <p
                id="org-benchmark-optout-label"
                className="text-sm font-medium text-content-primary"
              >
                Opt out of benchmark contribution
              </p>
              <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                {optedOut
                  ? 'Engaged — no data from this organisation will contribute to market benchmarks, regardless of any individual user’s consent.'
                  : 'Not engaged — this organisation may contribute, but only the data of users who have individually opted in. Turn this on to hard-stop all contribution.'}
              </p>
            </div>
            <Switch
              checked={optedOut}
              busy={setMutation.isPending}
              onChange={(next) => setMutation.mutate(next)}
              labelledById="org-benchmark-optout-label"
            />
          </div>

          {eligibility && (
            <div className="mt-3 flex items-start gap-2 text-xs text-content-secondary">
              {eligibility.included_in_aggregate ? (
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-data-positive" />
              ) : (
                <Info size={13} className="mt-0.5 shrink-0 text-content-muted" />
              )}
              <span>
                {eligibility.included_in_aggregate
                  ? 'Based on current settings, deals you create would contribute once the benchmark layer exists.'
                  : `Based on current settings, deals you create would not contribute. ${
                      eligibility.reasons?.join(' ') || ''
                    }`}
              </span>
            </div>
          )}

          {lastChangeDate && (
            <p className="mt-3 text-[11px] text-content-muted">
              Last updated
              {lastChange.changed_by_name ? ` by ${lastChange.changed_by_name}` : ''} on{' '}
              {lastChangeDate}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
