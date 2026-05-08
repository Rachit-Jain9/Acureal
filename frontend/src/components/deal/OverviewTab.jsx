import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain,
  Loader2,
  ArrowRight,
  Clock,
  CheckCircle2,
  TrendingUp,
  IndianRupee,
  Layers,
  MapPin,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import { intelligenceAPI } from '../../services/api';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import { SQFT_PER_ACRE } from '../../config/india';
import Badge from '../common/Badge';
import { SectionHeader } from '../../design-system';
import BuildabilitySummary from './BuildabilitySummary';
import IcMemoPanel from './IcMemoPanel';
import {
  formatCrores,
  formatPct,
  formatDate,
  formatArea,
  formatRelativeTime,
  STAGE_CONFIG,
  PRIORITY_CONFIG,
  ACTIVITY_STATUS_CONFIG,
  ACTIVITY_PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
} from '../../utils/format';

const STAGE_NEXT_STEPS = {
  sourced: [
    'Conduct initial site screening and desktop review',
    'Verify survey numbers with revenue records',
    'Check basic ownership records (RTC / Pahani)',
    'Confirm land classification (agricultural vs. conversion)',
  ],
  screening: [
    'Schedule site visit with core team',
    'Request title documents from seller / broker',
    'Verify zoning and permissible land use',
    'Obtain preliminary FSI / buildability estimate',
  ],
  site_visit: [
    'Prepare site visit notes and photograph evidence',
    'Assess road access, utilities, and ground conditions',
    'Obtain seller\'s asking price and payment terms',
    'Draft preliminary LOI for internal review',
  ],
  loi: [
    'Execute signed LOI with exclusivity period',
    'Initiate title search (EC for 30 years)',
    'Commission survey and boundary demarcation',
    'Identify land conversion / khata requirements',
  ],
  due_diligence: [
    'Commission title search — EC for 30 years minimum',
    'Verify zoning / conversion order with BDA / BBMP',
    'Obtain legal opinion on encumbrances and liabilities',
    'Confirm seller entity validity (company / individual KYC)',
  ],
  underwriting: [
    'Build or update financial model with revised assumptions',
    'Run IRR and NPV sensitivity analyses',
    'Obtain construction cost estimate from quantity surveyor',
    'Prepare Investor-Grade deck first draft',
  ],
  ic_review: [
    'Circulate the Investor-Grade memo for internal review',
    'Address review queries and revise projections',
    'Obtain investor approval or conditional approval',
    'Define final negotiation mandate and walk-away terms',
  ],
  negotiation: [
    'Finalise purchase price and payment schedule',
    'Draft and redline sale agreement / development agreement',
    'Coordinate with legal counsel on SPA / DA structure',
    'Agree on registration timelines and stamp duty',
  ],
  active: [
    'Execute sale deed / development agreement',
    'File RERA registration (if applicable)',
    'Commence project planning and architect brief',
    'Track payment milestones per agreement',
  ],
  closed: [
    'Archive all closing documents',
    'Update portfolio tracker and financials',
    'Schedule post-close review for lessons learned',
  ],
  dead: [
    'Document reason for deal termination',
    'Archive all due diligence materials',
    'Consider flagging for re-evaluation in 6–12 months',
  ],
};

/**
 * Pilot consumer of `useDealContext` (TODO_ARCHITECTURE Phase A pilot).
 *
 * Reads the deal record + dealId from the workspace context that
 * `DealDetailPage` mounts via `<DealContextProvider>`. No props.
 *
 * If you're migrating another tab, copy this pattern: drop the
 * `({ deal, id })` props, replace with `useDealContext()` + a selector
 * (e.g. `useDealRecord()`), and stop the parent from passing those
 * props. The hook throws if mounted outside the provider so wiring
 * regressions surface at mount.
 */
export default function OverviewTab() {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  // Streaming AI analysis. The text accumulates as Claude generates it
  // (perceived latency drops from ~30s to <1s first paint). `streamCtrl`
  // holds the active stream's `abort()` so the user can cancel mid-flight.
  const [aiText, setAiText] = useState('');
  const [aiMeta, setAiMeta] = useState(null);
  // Tier-1 #3 — drifts flagged by the post-hoc numerical verifier.
  // null = verifier hasn't run; [] = ran clean; non-empty = review needed.
  const [aiDrifts, setAiDrifts] = useState(null);
  const [driftsExpanded, setDriftsExpanded] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiCached, setAiCached] = useState(false);
  const streamCtrl = useRef(null);

  // On mount, fetch the last persisted analysis. If one exists, render it
  // immediately so the user sees the most recent IC-grade memo without
  // re-running Claude. The user can press Refresh to regenerate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await intelligenceAPI.getCachedDealAnalysis(dealId);
        const cached = res?.data?.data;
        if (cancelled || !cached) return;
        setAiText(cached.analysis || '');
        setAiMeta({ generatedAt: cached.generatedAt, callId: cached.callId });
        setAiDrifts(cached.numericalDrifts ?? null);
        setAiCached(true);
      } catch {
        // Cache fetch is best-effort — silent on failure. User can still
        // generate a fresh analysis.
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  const handleAiAnalysis = () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiText('');
    setAiMeta(null);
    setAiDrifts(null);
    setDriftsExpanded(false);
    setAiCached(false);

    const stream = intelligenceAPI.streamDealAnalysis(dealId, {
      onText: (delta) => setAiText((t) => t + delta),
      onDone: (meta) => {
        setAiMeta(meta);
        if (meta?.numericalDrifts !== undefined) {
          setAiDrifts(meta.numericalDrifts);
        }
      },
    });
    streamCtrl.current = stream;

    stream.promise
      .catch((err) => {
        // AbortError → user clicked Cancel; don't surface as error.
        if (err?.name === 'AbortError') return;
        setAiError(
          err?.message ||
            'Analysis failed. Check that ANTHROPIC_API_KEY is configured.',
        );
      })
      .finally(() => {
        setAiLoading(false);
        streamCtrl.current = null;
      });
  };

  const handleAiCancel = () => {
    if (streamCtrl.current) streamCtrl.current.abort();
  };

  const financials = deal.financials;
  const stageHistory = deal.stage_history || [];
  const recentActivities = deal.recent_activities || [];
  const readiness = deal.readiness_summary || null;
  const nextStepGroups =
    Array.isArray(deal.next_steps) && deal.next_steps.length > 0
      ? deal.next_steps
      : (STAGE_NEXT_STEPS[deal.stage] || []).length > 0
        ? [{ group: 'Stage Playbook', items: STAGE_NEXT_STEPS[deal.stage] }]
        : [];
  const keyRisks = Array.isArray(deal.key_risks) ? deal.key_risks : [];

  const propertyForBuildability = deal?.property_id
    ? {
        id: deal.property_id,
        zone_id: deal.zone_id ?? null,
        zone_notes: deal.zone_notes ?? null,
        road_width_mtrs: deal.road_width_mtrs ?? null,
        permissible_fsi: deal.permissible_fsi ?? null,
        land_area_sqft: deal.land_area_sqft ?? null,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-editorial p-4">
          <div className="flex items-center gap-2 mb-1">
            <IndianRupee size={14} className="text-content-muted" />
            <span className="text-xs text-content-secondary uppercase tracking-wide">Ask Price</span>
          </div>
          <p className="text-xl font-bold text-content-primary">
            {deal.land_ask_price_cr ? formatCrores(deal.land_ask_price_cr) : '-'}
          </p>
          {deal.negotiated_price_cr && (
            <p className="text-xs text-content-muted mt-1">
              Negotiated: {formatCrores(deal.negotiated_price_cr)}
            </p>
          )}
        </div>

        <div className="card-editorial p-4">
          <div className="flex items-center gap-2 mb-1">
            <MapPin size={14} className="text-content-muted" />
            <span className="text-xs text-content-secondary uppercase tracking-wide">Land Area</span>
          </div>
          <p className="text-xl font-bold text-content-primary">
            {deal.land_area_sqft ? formatArea(deal.land_area_sqft) : '-'}
          </p>
          {deal.land_area_sqft && (
            <p className="text-xs text-content-muted mt-1">
              {(deal.land_area_sqft / SQFT_PER_ACRE).toFixed(3)} acres
            </p>
          )}
        </div>

        <div className="card-editorial p-4">
          <div className="flex items-center gap-2 mb-1">
            <Layers size={14} className="text-content-muted" />
            <span className="text-xs text-content-secondary uppercase tracking-wide">Asset Class</span>
          </div>
          <p className="text-lg font-bold text-content-primary capitalize">
            {deal.asset_class ? deal.asset_class.replace(/_/g, ' ') : '-'}
          </p>
          {deal.deal_structure && (
            <p className="text-xs text-content-muted mt-1 capitalize">
              {deal.deal_structure.replace(/_/g, ' ')}
            </p>
          )}
        </div>

        <div className="card-editorial p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-content-muted" />
            <span className="text-xs text-content-secondary uppercase tracking-wide">Deal Type</span>
          </div>
          <p className="text-lg font-bold text-content-primary">
            {DEAL_TYPE_LABELS[deal.deal_type] || deal.deal_type || '-'}
          </p>
          {deal.assigned_to_name && (
            <p className="text-xs text-content-muted mt-1">By {deal.assigned_to_name}</p>
          )}
        </div>
      </div>

      {propertyForBuildability && (
        <BuildabilitySummary
          property={propertyForBuildability}
          assetClass={deal.asset_class}
          title="Buildable envelope"
        />
      )}

      {readiness && (
        <div className="card-editorial">
          <SectionHeader
            size="sm"
            title="Deal Readiness"
            sub="Deterministic readiness based on DD completion, approvals, document coverage, and open risks."
            action={
              <Badge
                tone={
                  readiness.status === 'ic_ready'
                    ? 'success'
                    : readiness.status === 'work_in_progress'
                      ? 'warn'
                      : 'danger'
                }
              >
                {readiness.status === 'ic_ready'
                  ? 'Investor-Grade'
                  : readiness.status === 'work_in_progress'
                    ? 'In Progress'
                    : 'Not Ready'}
              </Badge>
            }
          />

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: 'Readiness', value: `${readiness.readiness_pct || 0}%` },
              { label: 'DD Complete', value: `${readiness.dd_completion_pct || 0}%` },
              { label: 'Approvals Validated', value: `${readiness.approval_completion_pct || 0}%` },
              { label: 'Open Risk Score', value: `${readiness.risk_score || 0}` },
              { label: 'Documents', value: `${readiness.document_count || 0}` },
            ].map((item) => (
              <div key={item.label} className="bg-bg-secondary rounded-lg p-3">
                <p className="text-xs text-content-muted mb-1">{item.label}</p>
                <p className="text-base font-bold text-content-primary">{item.value}</p>
              </div>
            ))}
          </div>

          {(keyRisks.length > 0 || readiness.pending_deal_breakers > 0) && (
            <div className="mt-4 space-y-2">
              {readiness.pending_deal_breakers > 0 && (
                <p className="text-sm text-data-negative">
                  {readiness.pending_deal_breakers} deal-breaker DD item
                  {readiness.pending_deal_breakers === 1 ? '' : 's'} remain unresolved.
                </p>
              )}
              {keyRisks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {keyRisks.map((risk) => (
                    <Badge key={risk} tone="danger">{risk}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Financial Summary */}
      {financials && (
        <div className="card-editorial">
          <SectionHeader
            size="sm"
            icon={IndianRupee}
            title="Financial Summary"
            action={
              <Link
                to={`/dashboard/financials/${dealId}`}
                className="text-sm text-accent hover:opacity-80 flex items-center gap-1"
              >
                Full Model <ArrowRight size={14} />
              </Link>
            }
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Cost', value: formatCrores(financials.total_cost_cr) },
              { label: 'Total Revenue', value: formatCrores(financials.total_revenue_cr) },
              {
                label: 'Gross Margin',
                value: formatPct(financials.gross_margin_pct),
                highlight: financials.gross_margin_pct >= 20,
              },
              { label: 'Gross Profit', value: formatCrores(financials.gross_profit_cr) },
              {
                label: 'IRR',
                value: formatPct(financials.irr_pct),
                highlight: financials.irr_pct >= 20,
              },
              { label: 'NPV', value: formatCrores(financials.npv_cr) },
              {
                label: 'Equity Multiple',
                value:
                  financials.equity_multiple != null
                    ? `${Number(financials.equity_multiple).toFixed(2)}x`
                    : '-',
              },
              { label: 'Developer Profit', value: formatCrores(financials.developer_profit_cr) },
            ].map(({ label, value, highlight }) => (
              <div key={label} className="bg-bg-secondary rounded-lg p-3">
                <p className="text-xs text-content-muted mb-1">{label}</p>
                <p
                  className={clsx(
                    'text-base font-bold',
                    highlight ? 'text-data-positive' : 'text-content-primary'
                  )}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Deal Analysis — streamed via SSE; text accumulates as Claude
          generates so the user sees first paint in <1s instead of waiting
          ~30s for the full response. Cancel button aborts the upstream
          call so cancelled analyses don't burn token budget. */}
      <div className="card-editorial">
        <SectionHeader
          size="sm"
          icon={Brain}
          title={
            <>
              AI Deal Analysis
              <Badge className="ml-2">Claude</Badge>
              <Badge className="ml-1" tone="neutral">AI-assisted — review before relying</Badge>
              {aiCached && !aiLoading && (
                <Badge className="ml-1" tone="neutral">Cached</Badge>
              )}
            </>
          }
          action={
            <div className="flex items-center gap-2">
              {aiLoading && (
                <button
                  onClick={handleAiCancel}
                  className="btn btn-ghost flex items-center gap-1.5 text-sm"
                  type="button"
                >
                  <X size={14} /> Cancel
                </button>
              )}
              <button
                onClick={handleAiAnalysis}
                disabled={aiLoading}
                className="btn btn-primary flex items-center gap-1.5 text-sm"
                type="button"
              >
                {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                {aiLoading ? 'Analysing…' : aiText ? 'Refresh' : 'Generate Analysis'}
              </button>
            </div>
          }
        />
        {aiError && (
          <p className="mt-3 text-sm text-data-negative bg-bg-secondary border border-hairline rounded px-3 py-2">
            {aiError}
          </p>
        )}
        {aiText ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-content-primary leading-relaxed whitespace-pre-line">
              {aiText}
              {aiLoading && (
                <span
                  aria-hidden="true"
                  className="inline-block ml-1 w-1.5 h-3.5 align-middle bg-content-secondary animate-pulse"
                />
              )}
            </p>

            {/* Numerical drift surface (Tier-1 #3 — post-hoc verifier).
                Only renders when drifts > 0; clean narratives render
                nothing to keep the page tight. */}
            {!aiLoading && Array.isArray(aiDrifts) && aiDrifts.length > 0 && (() => {
              const highCount   = aiDrifts.filter((d) => d.severity === 'high').length;
              const mediumCount = aiDrifts.filter((d) => d.severity === 'medium').length;
              const tone =
                highCount > 0 ? 'danger' : mediumCount > 0 ? 'warn' : 'info';
              const palette =
                tone === 'danger'
                  ? { bg: 'bg-rose-50',  border: 'border-rose-200',  text: 'text-rose-900',  icon: 'text-rose-600' }
                  : tone === 'warn'
                  ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', icon: 'text-amber-600' }
                  : { bg: 'bg-sky-50',   border: 'border-sky-200',   text: 'text-sky-900',   icon: 'text-sky-600' };
              return (
                <div className={clsx('mt-3 border rounded-md', palette.bg, palette.border)}>
                  <button
                    type="button"
                    onClick={() => setDriftsExpanded((v) => !v)}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium',
                      palette.text,
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md'
                    )}
                    aria-expanded={driftsExpanded}
                  >
                    <AlertTriangle size={13} className={clsx('shrink-0', palette.icon)} />
                    <span className="flex-1">
                      {aiDrifts.length} numerical claim{aiDrifts.length === 1 ? '' : 's'} flagged
                      {highCount > 0 && <span> · {highCount} high</span>}
                      {mediumCount > 0 && <span> · {mediumCount} medium</span>}
                    </span>
                    {driftsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {driftsExpanded && (
                    <div className="px-3 pb-3 pt-0 space-y-2 text-xs">
                      {aiDrifts.map((d, i) => (
                        <div key={i} className={clsx('pt-2 border-t', palette.border)}>
                          <div className="flex items-baseline justify-between gap-2 tabular-nums">
                            <span className={clsx('font-medium', palette.text)}>{d.label || d.field}</span>
                            <span className={palette.text}>
                              claimed <strong>{d.claimed}{d.unit ? ` ${d.unit}` : ''}</strong>
                              {d.snapshot != null && (
                                <> · model says <strong>{d.snapshot}{d.unit ? ` ${d.unit}` : ''}</strong></>
                              )}
                              {d.delta_pct != null && <> · {d.delta_pct.toFixed(1)}% drift</>}
                              {d.reason === 'no_snapshot_value' && <> · no model baseline to compare</>}
                            </span>
                          </div>
                          {d.claim_context && (
                            <p className={clsx('mt-1 italic text-[11px] opacity-80', palette.text)}>
                              "…{d.claim_context}…"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* AI-assisted disclaimer — required by CLAUDE.md hard rule
                for every AI-synthesized narrative. */}
            <p className="mt-2 text-[11px] text-content-muted">
              AI-assisted — requires human review. Numbers are validated against the
              underlying financial model; flagged drifts (if any) appear above.
            </p>

            {aiMeta && (
              <p className="text-xs text-content-muted">
                Generated {new Date(aiMeta.generatedAt).toLocaleString('en-IN')} · Cross-referenced
                against internal pipeline, market benchmarks, and verified comps
              </p>
            )}
          </div>
        ) : (
          !aiLoading && !aiError && (
            <p className="mt-2 text-sm text-content-secondary">
              Generate a Claude-powered Investor-Grade memo cross-referencing this deal's financials against
              Bengaluru micro-market benchmarks and verified comps. Streamed live as Claude writes it.
            </p>
          )
        )}
      </div>

      {/* Tier-2 #13 — IC Memo. Long-form structured markdown across 8 IC
          sections, synthesised from financials + risk_flags + dd_items +
          approval_items. Self-contained component because it carries its
          own state machine for cached-on-mount + streaming generate. */}
      <IcMemoPanel dealId={dealId} dealName={deal?.name} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stage History */}
        {stageHistory.length > 0 && (
          <div className="card-editorial">
            <SectionHeader size="sm" icon={Clock} title="Stage History" />
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px bg-hairline" />
              <ul className="space-y-4">
                {stageHistory.map((entry, index) => {
                  const toConfig = STAGE_CONFIG[entry.to_stage] || STAGE_CONFIG.screening;
                  return (
                    <li key={entry.id || index} className="relative pl-8">
                      <div
                        className={clsx(
                          'absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-bg-elevated',
                          index === stageHistory.length - 1 ? 'bg-accent' : 'bg-hairline-strong'
                        )}
                      />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.from_stage && (
                            <>
                              <Badge
                                tone={(STAGE_CONFIG[entry.from_stage] || STAGE_CONFIG.screening).tone}
                              >
                                {(STAGE_CONFIG[entry.from_stage] || STAGE_CONFIG.screening).label}
                              </Badge>
                              <ArrowRight size={12} className="text-content-muted" />
                            </>
                          )}
                          <Badge tone={toConfig.tone}>{toConfig.label}</Badge>
                        </div>
                        <p className="text-xs text-content-secondary mt-1">
                          {entry.changed_by_name} · {formatDate(entry.changed_at)}
                        </p>
                        {entry.notes && (
                          <p className="text-xs text-content-muted mt-0.5 italic">{entry.notes}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}

        {/* Next Steps */}
        {nextStepGroups.length > 0 && (
          <div className="card-editorial">
            <SectionHeader size="sm" icon={CheckCircle2} title="Next Steps" />
            <div className="space-y-4">
              {nextStepGroups.map((group) => (
                <div key={group.group}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-content-secondary mb-2">
                    {group.group}
                  </p>
                  <ul className="space-y-2">
                    {group.items.map((step, index) => (
                      <li key={`${group.group}-${index}`} className="flex items-start gap-2 text-sm text-content-secondary">
                        <span className="mt-0.5 w-5 h-5 rounded-full bg-accent-soft text-accent flex items-center justify-center text-xs font-medium flex-shrink-0">
                          {index + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent Activities */}
      {recentActivities.length > 0 && (
        <div className="card-editorial">
          <SectionHeader size="sm" title="Recent Activities" />
          <ul className="divide-y divide-hairline-soft">
            {recentActivities.slice(0, 5).map((activity) => {
              const statusCfg =
                ACTIVITY_STATUS_CONFIG[activity.status] || ACTIVITY_STATUS_CONFIG.open;
              const priorityCfg =
                ACTIVITY_PRIORITY_CONFIG[activity.priority] || ACTIVITY_PRIORITY_CONFIG.medium;
              return (
                <li key={activity.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge className="capitalize">
                      {(activity.activity_type || activity.type || '').replace(/_/g, ' ')}
                    </Badge>
                    <Badge tone={statusCfg.tone}>{statusCfg.label}</Badge>
                    <Badge tone={priorityCfg.tone}>{priorityCfg.label}</Badge>
                    <span className="text-xs text-content-muted ml-auto">
                      {formatRelativeTime(activity.activity_date)}
                    </span>
                  </div>
                  <p className="text-sm text-content-primary">{activity.description}</p>
                  {activity.performed_by_name && (
                    <p className="text-xs text-content-muted mt-0.5">by {activity.performed_by_name}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Deal Notes */}
      {deal.notes && (
        <div className="card-editorial">
          <SectionHeader size="sm" title="Notes" />
          <p className="text-sm text-content-secondary whitespace-pre-line leading-relaxed">{deal.notes}</p>
        </div>
      )}
    </div>
  );
}
