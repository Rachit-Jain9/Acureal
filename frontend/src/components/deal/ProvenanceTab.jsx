import { useEffect, useMemo, useState } from 'react';
import {
  Cpu, UserCog, Gauge, Database, BadgeCheck, FileText,
  ShieldCheck, RotateCcw, Check, AlertTriangle, Fingerprint,
} from 'lucide-react';
import { clsx } from 'clsx';
import EmptyState from '../common/EmptyState';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../../design-system';
import { useDealContext } from '../../hooks/useDealContext';
import { useDealEvidenceLedger } from '../../hooks/useProvenance';
import { useVerifyDealChain } from '../../hooks/useDealEvents';
import { useCountUp } from '../../hooks/useCountUp';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * Provenance — the deal's chain of custody, made visible.
 *
 * Surfaces the deterministic evidence ledger (icEvidence.getEvidenceLedger):
 * every material figure the IC decision rests on, each traced to an honest
 * TYPED source — kernel-computed, analyst-set, REDIP benchmark, deal records,
 * verified feed. The kernel-computed figures are additionally HMAC-signed and
 * replayable; a one-click seal verifies the whole signed computation chain
 * (reusing the shipped verify-chain primitive).
 *
 * Pure read-side, deterministic — no AI anywhere on this surface. It re-presents
 * only what the kernel + the trust engines already computed; it asserts numbers,
 * never statutory conclusions (the legal four stay out of scope by construction).
 */

// Typed-source presentation. `label` comes from the ledger; this adds the icon
// + the semantic-token palette (never inline CSS vars — the css-var guard).
const SOURCE_META = {
  kernel: { icon: Cpu, cls: 'text-accent bg-accent-soft' },
  analyst: { icon: UserCog, cls: 'text-content-secondary bg-bg-secondary' },
  benchmark: { icon: Gauge, cls: 'text-premium bg-premium-soft' },
  deterministic: { icon: Database, cls: 'text-content-secondary bg-bg-secondary' },
  feed: { icon: BadgeCheck, cls: 'text-data-positive bg-pos-soft' },
  'deal-record': { icon: FileText, cls: 'text-content-muted bg-bg-secondary' },
};

const formatUnit = (n, unit) => {
  if (n == null || !Number.isFinite(n)) return '—';
  switch (unit) {
    case 'pct': return `${n.toFixed(1)}%`;
    case 'inr_cr': return `₹${n.toFixed(2)} Cr`;
    case 'inr_per_sqft': return `₹${Math.round(n).toLocaleString('en-IN')}/sqft`;
    case 'inr': return `₹${Math.round(n).toLocaleString('en-IN')}`;
    case 'sqft': return `${Math.round(n).toLocaleString('en-IN')} sqft`;
    case 'count': return `${Math.round(n).toLocaleString('en-IN')}`;
    case 'x': return `${n.toFixed(2)}×`;
    default: return `${n.toLocaleString('en-IN')}`;
  }
};

// A value that rolls to its number on mount (useCountUp snaps under reduced-motion).
function LiveValue({ value, unit }) {
  const v = Number.isFinite(Number(value)) ? Number(value) : null;
  const animated = useCountUp(v ?? 0, { duration: 700 });
  if (v == null) return <span className="text-content-muted">—</span>;
  return <span className="tabular-nums font-semibold text-content-primary">{formatUnit(animated, unit)}</span>;
}

function SourcePill({ source }) {
  const meta = SOURCE_META[source?.type] || SOURCE_META['deal-record'];
  const Icon = meta.icon;
  return (
    <span
      title={source?.detail || ''}
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium whitespace-nowrap',
        meta.cls,
      )}
    >
      <Icon size={10} className="shrink-0" />
      {source?.label || 'Traced'}
    </span>
  );
}

function ClaimRow({ claim, shown }) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 py-2 border-t border-hairline-soft first:border-t-0 transition-all duration-300 ease-out',
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1',
      )}
    >
      <span className="text-sm text-content-secondary min-w-0 flex-1 truncate">{claim.label}</span>
      <span className="text-sm shrink-0"><LiveValue value={claim.value} unit={claim.unit} /></span>
      <span className="shrink-0"><SourcePill source={claim.source} /></span>
    </div>
  );
}

// The cryptographic seal — one-click verification of the whole signed
// computation chain (kernel figures). Reuses the shipped verify-chain hook;
// deliberately a compact verdict here (the Audit tab owns the full timeline).
function VerifySeal({ dealId, signedCount }) {
  const verify = useVerifyDealChain();
  const [report, setReport] = useState(null);

  const run = async () => {
    setReport(null);
    try {
      setReport(await verify.mutateAsync(dealId));
    } catch {
      /* hook toasts */
    }
  };

  const busy = verify.isPending;
  const allOk = report && report.all_verified && report.key_available;
  const anyFail = report && report.failed > 0;

  return (
    <Card elevated className="p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-accent-soft text-accent grid place-items-center">
            <Fingerprint size={18} />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold text-content-primary">Cryptographic seal</div>
            <div className="text-xs text-content-secondary mt-0.5 max-w-[56ch]">
              {signedCount > 0
                ? `${signedCount} kernel-computed figure${signedCount === 1 ? '' : 's'} on this page ${signedCount === 1 ? 'is' : 'are'} HMAC-signed and replayable. Verify the whole signed chain — REDIP re-hashes every computation and re-runs the kernel.`
                : 'No signed computation yet — run the financial model to seal this deal’s figures.'}
            </div>
          </div>
        </div>
        {signedCount > 0 && (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 shrink-0"
          >
            <RotateCcw size={13} className={busy ? 'animate-spin' : ''} />
            {busy ? 'Verifying…' : report ? 'Re-verify' : 'Verify computations'}
          </button>
        )}
      </div>

      {report && (
        <div
          className={clsx(
            'mt-3 flex items-start gap-2.5 rounded-editorial border p-3',
            allOk && 'bg-pos-soft border-transparent',
            anyFail && 'bg-neg-soft border-transparent',
            !allOk && !anyFail && 'bg-bg-secondary border-hairline',
          )}
        >
          {allOk ? (
            <Check size={16} className="text-data-positive mt-0.5 shrink-0" />
          ) : anyFail ? (
            <AlertTriangle size={16} className="text-data-negative mt-0.5 shrink-0" />
          ) : (
            <ShieldCheck size={16} className="text-content-muted mt-0.5 shrink-0" />
          )}
          <div className="text-xs text-content-secondary leading-relaxed">
            {report.total_events === 0
              ? 'No signed computations to verify yet.'
              : allOk
                ? `${report.verified} computation${report.verified === 1 ? '' : 's'} verified — every kernel figure is cryptographically authentic and untampered.`
                : anyFail
                  ? `Integrity issue on ${report.failed} of ${report.total_events} — open the Audit tab to inspect.`
                  : 'Signatures could not be checked (signing key unavailable); content hashes were still verified.'}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ProvenanceTab() {
  const { dealId } = useDealContext();
  const reduced = useReducedMotion();
  const { data: ledger, isLoading, isError, error, refetch } = useDealEvidenceLedger(dealId);

  const groups = useMemo(() => (Array.isArray(ledger?.groups) ? ledger.groups : []), [ledger]);
  const totalClaims = useMemo(() => groups.reduce((a, g) => a + (g.claims?.length || 0), 0), [groups]);
  const structureKey = useMemo(
    () => groups.map((g) => `${g.category}:${g.claims?.length || 0}`).join('|'),
    [groups],
  );

  // Staggered top-to-bottom reveal of claim rows. Real content; snaps to full
  // under reduced-motion.
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    if (reduced || totalClaims === 0) {
      setRevealed(totalClaims);
      return undefined;
    }
    setRevealed(0);
    const per = Math.max(22, Math.min(55, Math.floor(650 / totalClaims)));
    let i = 0;
    let timer = setTimeout(function step() {
      i += 1;
      setRevealed(i);
      if (i < totalClaims) timer = setTimeout(step, per);
    }, per);
    return () => clearTimeout(timer);
  }, [structureKey, reduced, totalClaims]);

  if (isLoading) {
    return (
      <Card className="p-4">
        <SkeletonList rows={6} columns={3} />
      </Card>
    );
  }

  if (isError) {
    return (
      <ErrorState
        tone="danger"
        title="Couldn't load the provenance ledger"
        action={
          <button type="button" onClick={() => refetch()} className="text-sm text-accent hover:underline focus-visible:outline-none focus-visible:underline">
            Try again
          </button>
        }
      >
        {error?.response?.data?.message || error?.message || 'Network error.'}
      </ErrorState>
    );
  }

  if (!ledger?.available || totalClaims === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          size="md"
          icon={Fingerprint}
          title="No provenance to trace yet"
          description="Once this deal has a saved financial model, key assumptions, risks, or comps, every figure that its IC decision rests on will appear here — each traced to an honest, typed source and cryptographically sealed."
        />
      </Card>
    );
  }

  const byType = ledger.summary?.byType || {};
  const kernelCount = byType.kernel || 0;
  const total = ledger.summary?.total ?? totalClaims;

  // Running index so the reveal staggers across groups.
  let claimCursor = 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        size="sm"
        eyebrow="Chain of custody"
        title="Provenance"
        sub="Every figure this deal's decision rests on — traced to an honest, typed source, and (for kernel-computed numbers) cryptographically signed. This is the deterministic claim layer: no AI, no free-floating assertions."
      />

      {/* Summary strip */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-content-secondary">
            <span className="font-display text-lg font-semibold text-content-primary tabular-nums">{total}</span>{' '}
            figure{total === 1 ? '' : 's'} — <span className="text-data-positive font-medium">every one traced</span> to a source.
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {Object.entries(byType)
              .filter(([, n]) => n > 0)
              .map(([type, n]) => {
                const meta = SOURCE_META[type] || SOURCE_META['deal-record'];
                const Icon = meta.icon;
                return (
                  <span key={type} className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium', meta.cls)}>
                    <Icon size={10} />
                    <span className="tabular-nums">{n}</span>
                  </span>
                );
              })}
          </div>
        </div>
      </Card>

      {/* Cryptographic seal + one-click verify */}
      <VerifySeal dealId={dealId} signedCount={kernelCount} />

      {/* The ledger — grouped claims, each traced */}
      <div className="space-y-4">
        {groups.map((group) => (
          <Card key={group.category} className="p-4">
            <div className="text-[11px] uppercase tracking-[0.1em] text-content-muted font-semibold mb-1.5">
              {group.category}
            </div>
            <div>
              {(group.claims || []).map((claim) => {
                const idx = claimCursor;
                claimCursor += 1;
                return <ClaimRow key={claim.key} claim={claim} shown={idx < revealed} />;
              })}
            </div>
          </Card>
        ))}
      </div>

      <p className="text-[11px] text-content-muted leading-relaxed">
        Deterministic ledger — composed from REDIP's financial kernel, the model-confidence classifier, the risk radar,
        the comp-reliance ledger and the deal record. Kernel figures are HMAC-signed and replayable; the full
        computation timeline lives on the Audit tab.
      </p>
    </div>
  );
}
