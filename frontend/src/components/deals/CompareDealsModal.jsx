import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import { X, ArrowUpRight, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { Link } from 'react-router-dom';
import { dealsAPI } from '../../services/api';
import useFocusTrap from '../../hooks/useFocusTrap';
import useScrollLock from '../../hooks/useScrollLock';

/**
 * Compare deals — side-by-side workspace view.
 *
 * The single deal page is rich, but the question a deal lead actually asks
 * three times a week is "which of these 2-4 candidates should I push next?".
 * That decision needs the headline kernel numbers, IC + Risk posture, DD
 * progress, and the top blocker — for every candidate, on one screen, with
 * no tab-switching.
 *
 * Architecture: a frontend-only feature on top of the existing workspace
 * endpoint. For each selected deal we fire `useDealWorkspace(id)` in
 * parallel via React Query's `useQueries`. The cache key matches what the
 * single-deal route uses (`['deal-workspace', id]`), so cold loads are
 * shared and warm loads are instant. No new backend, no new schema.
 *
 * UX: Bloomberg-style grid — rows are signal groups, columns are deals,
 * sticky leftmost column + sticky deal headers. Click a deal name to open
 * the full workspace in a new tab without losing the comparison.
 *
 * Hard caps:
 *   • 2 ≤ N ≤ 4 — fewer than 2 isn't a comparison; more than 4 stops
 *     fitting on a laptop without horizontal scroll-loss.
 *   • Each column is min-w-[18rem] so a 4-deal layout needs ~75rem width
 *     (covered by max-w-7xl + overflow-x-auto).
 *
 * CLAUDE.md respected: every number on this surface traces back to a
 * kernel run on the source deal. Nothing is invented; nothing is averaged
 * across deals. We render what is, side-by-side.
 */

// ───────── Formatting helpers (no JSX) ────────────────────────────────────

const fmtPct = (v, dp = 1) => {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return `${Number(v).toFixed(dp)}%`;
};

const fmtCr = (v, dp = 2) => {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  if (Math.abs(n) >= 1000) return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: dp })} Cr`;
};

const fmtMultiple = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return `${Number(v).toFixed(2)}×`;
};

const fmtCount = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v).toLocaleString('en-IN');
};

const fmtRatio = (done, total) => {
  if (total == null || !Number.isFinite(Number(total)) || Number(total) === 0) {
    return { label: null, pct: null };
  }
  const d = Number(done) || 0;
  const t = Number(total);
  return { label: `${d} / ${t}`, pct: Math.round((d / t) * 100) };
};

// ───────── Stage + tier badges ─────────────────────────────────────────────

const STAGE_TONE = {
  sourced: 'slate',
  screening: 'slate',
  site_visit: 'slate',
  loi: 'sky',
  due_diligence: 'sky',
  underwriting: 'sky',
  ic_review: 'amber',
  negotiation: 'amber',
  active: 'green',
  closed: 'slate',
  dead: 'slate',
};

const TONE_CLASS = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-bg-secondary text-content-secondary border-hairline',
};

function ToneBadge({ tone = 'slate', children }) {
  return (
    <span className={clsx(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border whitespace-nowrap',
      TONE_CLASS[tone] || TONE_CLASS.slate,
    )}>
      {children}
    </span>
  );
}

const READINESS_TIER_TONE = {
  ic_ready: 'green',
  pre_ic: 'sky',
  diligence: 'amber',
  early: 'slate',
};

const READINESS_TIER_LABEL = {
  ic_ready: 'IC-ready',
  pre_ic: 'Pre-IC',
  diligence: 'Diligence',
  early: 'Early',
};

// ───────── Row primitives ──────────────────────────────────────────────────

function GroupHeader({ title, sub }) {
  return (
    <tr className="bg-bg-secondary/60">
      <td colSpan={999} className="px-4 py-2 border-y border-hairline">
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
          {title}
        </div>
        {sub && <div className="text-[11px] text-content-muted">{sub}</div>}
      </td>
    </tr>
  );
}

function MetricRow({ label, hint, values, renderCell }) {
  return (
    <tr className="border-b border-hairline-soft last:border-b-0">
      <th scope="row" className="sticky left-0 z-10 bg-bg-elevated px-4 py-2.5 text-left align-top w-44 min-w-44">
        <div className="text-xs font-medium text-content-primary">{label}</div>
        {hint && <div className="text-[10px] text-content-muted leading-snug mt-0.5">{hint}</div>}
      </th>
      {values.map((v, i) => (
        <td key={i} className="px-4 py-2.5 align-top">
          {renderCell ? renderCell(v, i) : (
            <div className="text-sm tabular-nums text-content-primary">
              {v ?? <span className="text-content-muted">—</span>}
            </div>
          )}
        </td>
      ))}
    </tr>
  );
}

// ───────── Per-deal pluckers — narrow workspace → flat signal map ──────────

function pluckSignals(workspace) {
  if (!workspace) return null;
  const deal = workspace.deal || {};
  const finSummary = workspace.financial?.summary || {};
  const ddScore = workspace.dd?.score || {};
  const riskScore = workspace.risk?.score || {};
  const approvals = workspace.approvals || [];
  const documents = workspace.documents?.documents || workspace.documents || [];
  const readinessSummary = workspace.readiness?.summary || {};
  const icReadiness = workspace.ic_readiness || null;
  const promoter = workspace.promoter_profile || null;

  const requiredApprovals = Array.isArray(approvals)
    ? approvals.filter((a) => a.is_required !== false)
    : [];
  const availableApprovals = requiredApprovals.filter(
    (a) => a.is_available || a.is_uploaded || a.is_validated,
  );
  const documentsCount = Array.isArray(documents) ? documents.length : 0;

  // Risk postureCounts — riskRadar.service emits { flagged, unverified, cleared }
  const riskCounts = riskScore.postureCounts || riskScore.posture_counts || {};

  return {
    // Identity
    name: deal.name,
    id: deal.id,
    stage: deal.stage,
    asset_class: deal.asset_class,
    deal_structure: deal.deal_structure,

    // Headline KPIs (from financials row)
    irr_pct: finSummary.irr_pct,
    npv_cr: finSummary.npv_cr,
    dscr: finSummary.dscr,
    equity_multiple: finSummary.equity_multiple,
    total_cost_cr: finSummary.total_cost_cr,
    total_revenue_cr: finSummary.total_revenue_cr,
    developer_profit_cr: finSummary.developer_profit_cr,
    gross_margin_pct: finSummary.gross_margin_pct,
    land_cost_cr: finSummary.land_cost_cr,

    // IC readiness — from /workspace.ic_readiness OR fallback to readiness.summary
    ic_score: icReadiness?.score ?? readinessSummary.ic_score ?? null,
    ic_tier: icReadiness?.tier ?? readinessSummary.ic_tier ?? null,
    ic_top_gap: Array.isArray(icReadiness?.top_gaps) ? icReadiness.top_gaps[0]?.label : null,

    // Risk posture
    risk_flagged: Number(riskCounts.flagged) || 0,
    risk_unverified: Number(riskCounts.unverified) || 0,
    risk_cleared: Number(riskCounts.cleared) || 0,
    risk_open_critical: Number(riskScore.openCritical || riskScore.open_critical) || 0,
    risk_open_high: Number(riskScore.openHigh || riskScore.open_high) || 0,

    // DD
    dd_total: Number(ddScore.total) || 0,
    dd_done: Number(ddScore.done) || 0,
    dd_pct: Number(ddScore.percent ?? ddScore.pct) || 0,
    dd_breakers_open: Number(ddScore.dealBreakersOpen || ddScore.deal_breakers_open) || 0,

    // Approvals
    approvals_total: requiredApprovals.length,
    approvals_available: availableApprovals.length,

    // Documents + promoter
    documents_count: documentsCount,
    promoter_posture: promoter?.posture || null,
  };
}

// ───────── Main component ──────────────────────────────────────────────────

export default function CompareDealsModal({ open, dealIds, onClose }) {
  // Trap focus inside the dialog (Tab cycles within it, Escape closes, focus
  // restores to the trigger on close) and lock body scroll while open. onClose
  // is stabilised so a parent re-render (e.g. a background refetch) doesn't
  // re-arm the trap and yank focus.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const handleClose = useCallback(() => onCloseRef.current?.(), []);
  const trapRef = useFocusTrap(open, { onEscape: handleClose });
  useScrollLock(open);

  const ids = useMemo(() => Array.isArray(dealIds) ? dealIds.slice(0, 4) : [], [dealIds]);

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['deal-workspace', id],
      queryFn: () => dealsAPI.getWorkspace(id).then((r) => r.data.data),
      enabled: open && Boolean(id),
      staleTime: 30_000,
    })),
  });

  const loading = queries.some((q) => q.isLoading);
  const errored = queries.some((q) => q.isError);
  const signals = queries.map((q) => pluckSignals(q.data));

  if (!open) return null;

  const colTemplate = `11rem repeat(${ids.length}, minmax(16rem, 1fr))`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3 sm:px-6 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-deals-title"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        className="bg-bg-elevated border border-hairline rounded-editorial shadow-elevated w-full max-w-7xl h-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-hairline shrink-0">
          <div className="min-w-0">
            <h2 id="compare-deals-title" className="font-display text-base font-semibold text-content-primary">
              Compare deals · {ids.length}
            </h2>
            <p className="text-[11px] text-content-muted mt-0.5">
              Side-by-side workspace signals. Every number traces to a kernel run on the source deal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label="Close comparison"
          >
            <X size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="px-5 py-10 text-center text-sm text-content-muted">
              Loading workspace data for {ids.length} deals…
            </div>
          )}

          {!loading && errored && (
            <div className="px-5 py-10 text-center text-sm text-rose-700">
              <AlertTriangle className="inline-block mr-1 -mt-0.5" size={14} />
              One or more deals failed to load. Close and retry.
            </div>
          )}

          {!loading && !errored && (
            <table
              className="w-full text-sm"
              style={{ gridTemplateColumns: colTemplate }}
            >
              <colgroup>
                <col style={{ width: '11rem' }} />
                {ids.map((id) => (
                  <col key={id} style={{ minWidth: '16rem' }} />
                ))}
              </colgroup>

              {/* Sticky deal-header row */}
              <thead className="sticky top-0 z-20 bg-bg-elevated">
                <tr className="border-b border-hairline">
                  <th scope="col" className="sticky left-0 z-30 bg-bg-elevated px-4 py-3 text-left text-[10px] uppercase tracking-[0.12em] text-content-muted font-medium">
                    Signal
                  </th>
                  {signals.map((s, i) => (
                    <th key={ids[i]} scope="col" className="px-4 py-3 text-left align-top">
                      <Link
                        to={`/dashboard/deals/${ids[i]}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-display text-sm font-semibold text-content-primary hover:text-accent transition-colors group"
                        title="Open deal in new tab"
                      >
                        <span className="truncate max-w-[14rem]">{s?.name || 'Deal'}</span>
                        <ArrowUpRight size={12} className="text-content-muted group-hover:text-accent" />
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {s?.stage && (
                          <ToneBadge tone={STAGE_TONE[s.stage] || 'slate'}>
                            {s.stage.replace(/_/g, ' ')}
                          </ToneBadge>
                        )}
                        {s?.asset_class && (
                          <span className="text-[10px] text-content-muted">
                            {s.asset_class.replace(/_/g, ' ')}
                          </span>
                        )}
                        {s?.deal_structure && s.deal_structure !== 'outright' && (
                          <span className="text-[10px] text-content-muted">· {s.deal_structure.replace(/_/g, ' ')}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {/* ── Financials ─────────────────────────────────────────── */}
                <GroupHeader title="Headline kernel KPIs" sub="From the deterministic financial engine — every number reproducible from inputs." />
                <MetricRow
                  label="IRR"
                  hint="Internal rate of return"
                  values={signals.map((s) => s ? fmtPct(s.irr_pct) : null)}
                />
                <MetricRow
                  label="NPV"
                  hint="Net present value"
                  values={signals.map((s) => s ? fmtCr(s.npv_cr) : null)}
                />
                <MetricRow
                  label="DSCR"
                  hint="Debt service coverage"
                  values={signals.map((s) => s ? fmtMultiple(s.dscr) : null)}
                />
                <MetricRow
                  label="Equity multiple"
                  values={signals.map((s) => s ? fmtMultiple(s.equity_multiple) : null)}
                />
                <MetricRow
                  label="Gross margin"
                  values={signals.map((s) => s ? fmtPct(s.gross_margin_pct, 1) : null)}
                />

                {/* ── Capital ───────────────────────────────────────────── */}
                <GroupHeader title="Capital posture" />
                <MetricRow
                  label="Total cost"
                  values={signals.map((s) => s ? fmtCr(s.total_cost_cr, 0) : null)}
                />
                <MetricRow
                  label="Total revenue"
                  values={signals.map((s) => s ? fmtCr(s.total_revenue_cr, 0) : null)}
                />
                <MetricRow
                  label="Land cost"
                  values={signals.map((s) => s ? fmtCr(s.land_cost_cr, 1) : null)}
                />
                <MetricRow
                  label="Developer profit"
                  values={signals.map((s) => s ? fmtCr(s.developer_profit_cr, 1) : null)}
                />

                {/* ── IC + Risk + DD ───────────────────────────────────── */}
                <GroupHeader title="IC readiness · Risk · DD progress" sub="From the per-deal IC Readiness Pack, Risk Radar, and DD checklist." />
                <MetricRow
                  label="IC readiness"
                  hint="0–100 + tier"
                  values={signals}
                  renderCell={(s) => {
                    if (!s || s.ic_score == null) return <span className="text-content-muted">—</span>;
                    const tone = READINESS_TIER_TONE[s.ic_tier] || 'slate';
                    const label = READINESS_TIER_LABEL[s.ic_tier] || s.ic_tier;
                    return (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-content-primary">
                          {s.ic_score}
                        </span>
                        <span className="text-xs text-content-muted">/ 100</span>
                        <ToneBadge tone={tone}>{label}</ToneBadge>
                      </div>
                    );
                  }}
                />
                <MetricRow
                  label="Risk Radar posture"
                  hint="Per-failure-mode posture"
                  values={signals}
                  renderCell={(s) => {
                    if (!s) return <span className="text-content-muted">—</span>;
                    const total = s.risk_flagged + s.risk_unverified + s.risk_cleared;
                    if (total === 0) return <span className="text-content-muted">No assessment yet</span>;
                    return (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {s.risk_flagged > 0 && (
                          <ToneBadge tone="rose">{s.risk_flagged} flagged</ToneBadge>
                        )}
                        {s.risk_unverified > 0 && (
                          <ToneBadge tone="amber">{s.risk_unverified} unverified</ToneBadge>
                        )}
                        {s.risk_cleared > 0 && (
                          <ToneBadge tone="green">{s.risk_cleared} cleared</ToneBadge>
                        )}
                      </div>
                    );
                  }}
                />
                <MetricRow
                  label="Open critical risks"
                  values={signals.map((s) => s ? fmtCount(s.risk_open_critical) : null)}
                />
                <MetricRow
                  label="Open high risks"
                  values={signals.map((s) => s ? fmtCount(s.risk_open_high) : null)}
                />
                <MetricRow
                  label="DD progress"
                  values={signals}
                  renderCell={(s) => {
                    if (!s) return <span className="text-content-muted">—</span>;
                    const r = fmtRatio(s.dd_done, s.dd_total);
                    if (!r.label) return <span className="text-content-muted">Not seeded</span>;
                    return (
                      <div className="flex items-center gap-2">
                        <span className="text-sm tabular-nums text-content-primary">{r.label}</span>
                        <span className="text-[11px] text-content-muted">({r.pct}%)</span>
                      </div>
                    );
                  }}
                />
                <MetricRow
                  label="Deal-breakers open"
                  values={signals}
                  renderCell={(s) => {
                    if (!s) return <span className="text-content-muted">—</span>;
                    if (s.dd_breakers_open === 0) {
                      return <span className="text-xs text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={12} />None</span>;
                    }
                    return (
                      <span className="text-xs text-rose-700 inline-flex items-center gap-1">
                        <AlertTriangle size={12} />
                        {s.dd_breakers_open}
                      </span>
                    );
                  }}
                />

                {/* ── Approvals + Documents + Promoter ─────────────────── */}
                <GroupHeader title="Approvals · Documents · Promoter" />
                <MetricRow
                  label="Approvals"
                  hint="Required only"
                  values={signals}
                  renderCell={(s) => {
                    if (!s) return <span className="text-content-muted">—</span>;
                    const r = fmtRatio(s.approvals_available, s.approvals_total);
                    if (!r.label) return <span className="text-content-muted">Not seeded</span>;
                    return (
                      <div className="flex items-center gap-2">
                        <span className="text-sm tabular-nums text-content-primary">{r.label}</span>
                        <span className="text-[11px] text-content-muted">({r.pct}% available)</span>
                      </div>
                    );
                  }}
                />
                <MetricRow
                  label="Documents"
                  values={signals.map((s) => s ? fmtCount(s.documents_count) : null)}
                />
                <MetricRow
                  label="Promoter posture"
                  values={signals}
                  renderCell={(s) => {
                    if (!s) return <span className="text-content-muted">—</span>;
                    if (!s.promoter_posture) {
                      return (
                        <span className="text-xs text-content-muted inline-flex items-center gap-1">
                          <HelpCircle size={12} />
                          Not recorded
                        </span>
                      );
                    }
                    const tone = s.promoter_posture === 'cleared' ? 'green'
                      : s.promoter_posture === 'flagged' ? 'rose'
                      : 'amber';
                    return <ToneBadge tone={tone}>{s.promoter_posture}</ToneBadge>;
                  }}
                />

                {/* ── Top blocker ──────────────────────────────────────── */}
                <GroupHeader title="What's blocking IC?" />
                <MetricRow
                  label="Top gap"
                  values={signals.map((s) => s?.ic_top_gap || null)}
                  renderCell={(v) => {
                    if (!v) return <span className="text-emerald-700 text-xs inline-flex items-center gap-1"><CheckCircle2 size={12} />No blocker</span>;
                    return <span className="text-xs text-content-secondary leading-snug">{v}</span>;
                  }}
                />
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <footer className="px-5 py-2.5 border-t border-hairline shrink-0 flex items-center justify-between text-[11px] text-content-muted">
          <span>
            Comparison is an organisation aid — never an IC verdict. Numbers from the
            deterministic kernel; tier labels from the IC Readiness Pack.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded border border-hairline text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
