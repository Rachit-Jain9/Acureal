import { useState } from 'react';
import { FileSearch, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useIcEvidence } from '../../hooks/useIcEvidence';

/**
 * IC Memo Evidence Ledger — Workstream A (Provenance Spine), A3.
 *
 * The deterministic claim layer beneath the IC memo: every material number
 * the IC decision rests on, each click-to-expand to its honest, typed source
 * (kernel-computed, analyst-set, Acureal benchmark, deal records, verified
 * feed). The AI narrative is the interpretive layer on top; this is the
 * traceable evidence under it. Pure display — computed server-side.
 *
 * Hides itself when the deal has no readable evidence ledger.
 */

const SOURCE_CHIP = {
  kernel: { label: 'Kernel-computed', cls: 'bg-accent-soft text-accent border-hairline' },
  analyst: { label: 'Analyst-set', cls: 'bg-pos-soft text-data-positive border-hairline' },
  benchmark: { label: 'Benchmark', cls: 'bg-premium-soft text-premium border-hairline' },
  deterministic: {
    label: 'Risk register',
    cls: 'bg-bg-secondary text-content-secondary border-hairline-strong',
  },
  feed: { label: 'Verified feed', cls: 'bg-pos-soft text-data-positive border-hairline' },
  'deal-record': {
    label: 'Deal record',
    cls: 'bg-bg-secondary text-content-secondary border-hairline-strong',
  },
};

const SUMMARY_LABEL = {
  kernel: 'kernel-computed',
  analyst: 'analyst-set',
  benchmark: 'on benchmark',
  deterministic: 'from the risk register',
  feed: 'from the verified feed',
  'deal-record': 'from the deal record',
};

const grp = (n) => Number(n).toLocaleString('en-IN');

function fmtValue(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const n = Number(v);
  switch (unit) {
    case 'pct':
      return `${n}%`;
    case 'x':
      return `${n}x`;
    case 'inr_cr':
      return `${n < 0 ? '−' : ''}₹${grp(Math.abs(n))} Cr`;
    case 'inr_per_sqft':
      return `₹${grp(n)}/sqft`;
    case 'inr':
      return `₹${grp(n)}`;
    case 'sqft':
      return `${grp(n)} sqft`;
    default:
      return grp(n);
  }
}

function ClaimRow({ claim, open, onToggle }) {
  const chip = SOURCE_CHIP[claim.source?.type] || SOURCE_CHIP['deal-record'];
  return (
    <div className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <ChevronRight
            size={12}
            className={clsx(
              'shrink-0 text-content-muted transition-transform duration-150 ease-out',
              open && 'rotate-90',
            )}
          />
          <span className="text-sm text-content-secondary truncate">{claim.label}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-content-primary tabular-nums">
            {fmtValue(claim.value, claim.unit)}
          </span>
          <span
            className={clsx(
              'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
              chip.cls,
            )}
          >
            {chip.label}
          </span>
        </span>
      </button>
      {open && claim.source?.detail && (
        <p className="text-[11px] text-content-muted leading-snug pl-6 pr-1 pb-2">
          {claim.source.detail}
        </p>
      )}
    </div>
  );
}

export default function IcMemoEvidence({ dealId }) {
  const { data, isLoading } = useIcEvidence(dealId);
  const [open, setOpen] = useState(false);
  const [openClaim, setOpenClaim] = useState(null);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-hairline bg-bg-secondary p-4">
        <div className="redip-skeleton h-4 w-48 rounded-md mb-2" />
        <div className="redip-skeleton h-3 w-2/3 rounded-sm" />
      </div>
    );
  }

  if (!data || !data.available || !Array.isArray(data.groups) || data.groups.length === 0) {
    return null;
  }

  const { groups, summary } = data;
  const total = summary?.total || 0;
  const byType = summary?.byType || {};
  const breakdown = Object.entries(byType)
    .map(([type, n]) => `${n} ${SUMMARY_LABEL[type] || type}`)
    .join(' · ');

  return (
    <div className="rounded-lg border border-hairline bg-bg-secondary p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
      >
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <FileSearch size={16} className="text-content-muted" />
          Evidence &amp; Sources
        </h3>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-content-muted">
            {total} {total === 1 ? 'number' : 'numbers'}, every one traced
          </span>
          <ChevronRight
            size={14}
            className={clsx(
              'text-content-muted transition-transform duration-150 ease-out',
              open && 'rotate-90',
            )}
          />
        </span>
      </button>

      {open && (
        <div className="mt-3">
          {breakdown && (
            <p className="text-xs text-content-muted mb-3 pb-3 border-b border-hairline">
              {breakdown}.
            </p>
          )}

          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.category}>
                <p className="text-[11px] uppercase tracking-wider font-medium text-content-muted mb-0.5">
                  {g.category}
                </p>
                <div>
                  {g.claims.map((c) => {
                    const id = `${g.category}:${c.key}`;
                    return (
                      <ClaimRow
                        key={id}
                        claim={c}
                        open={openClaim === id}
                        onToggle={() => setOpenClaim((cur) => (cur === id ? null : id))}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-content-muted mt-3 leading-snug">
            Every figure here is produced by Acureal&apos;s deterministic engines or maintained
            by your team — none is AI-generated. The IC memo&apos;s narrative is the
            interpretive layer; these are the traceable facts under it.
          </p>
        </div>
      )}
    </div>
  );
}
