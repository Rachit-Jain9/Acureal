import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  CheckCircle2,
  TrendingUp,
  IndianRupee,
  Layers,
  MapPin,
  Activity,
  ShieldAlert,
  ListChecks,
  StickyNote,
  History,
  Gauge,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import { SQFT_PER_ACRE } from '../../config/india';
import Badge from '../common/Badge';
import { SectionHeader, CollapsibleCard } from '../../design-system';
import BuildabilitySummary from './BuildabilitySummary';
import AiSynthesisPanel from './AiSynthesisPanel';
import DealQaBox from './DealQaBox';
import AutoFillReadyCard from './AutoFillReadyCard';
// Workstream B — compact Risk Radar pinned to the deal front page.
import RiskRadarStrip from './RiskRadarStrip';
// Workstream A — compact model-trust verdict beside the financial numbers.
import ModelTrustSummary from '../financials/ModelTrustSummary';
// PR-NX53 (2026-05-19) — inline provenance chip on the Land Area
// key-metric card. Extends the chip that already ships in ParcelTab
// (PR-NX50) to the Overview tab where operators land first.
import ProvenanceChip from '../common/ProvenanceChip';
import { useFieldProvenance } from '../../hooks/useFieldProvenance';
import DealAutoDerivedWarningsStrip from './DealAutoDerivedWarningsStrip';
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
  // PR-NX53 (2026-05-19) — field-provenance map for inline chip on the
  // Land Area card. Returns empty when no auto-fill events fire — chip
  // simply doesn't render.
  const { data: provenanceData } = useFieldProvenance(dealId);
  const fieldProvenance = provenanceData?.field_provenance || {};

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
          <p className="text-xl font-bold text-content-primary inline-flex items-center gap-1.5">
            <span>{deal.land_area_sqft ? formatArea(deal.land_area_sqft) : '-'}</span>
            {/* PR-NX53 (2026-05-19) — inline provenance chip. Renders nothing
                when land_area_sqft wasn't auto-filled from a document
                extraction; renders an (i) chip with hover popover otherwise. */}
            <ProvenanceChip field="land_area_sqft" provenance={fieldProvenance} />
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

      {/* ── Deal Pulse ────────────────────────────────────────────────────
          Compact "what's the state of this deal" ribbon — readiness %,
          DD %, approvals %, open risks count, top deal-breaker callout.
          Replaces the previous full-card Readiness section that was
          stacking 5 large tiles + key-risk pills. The full breakdown
          moved into a collapsible block lower on the page. */}
      {readiness && (
        <DealPulseRibbon readiness={readiness} keyRisks={keyRisks} />
      )}

      {/* Risk Radar — compact per-failure-mode posture, pinned to the front
          page so the sentinel is seen before it is asked for; links through
          to the full radar on the Risk tab. */}
      <RiskRadarStrip dealId={dealId} />

      {/* AI Synthesis — combined Quick Analysis + Full IC Memo behind a
          single bordered card with tabs. The tabbed container preserves
          state for whichever tab is inactive so toggling doesn't cost
          another generation. */}
      <AiSynthesisPanel dealId={dealId} dealName={deal?.name} />

      {/* Tier-2 #11 — Deal Q&A agent. Single-shot synchronous Q&A on the
          deal: pgvector retrieves relevant document chunks, Claude
          answers with mandatory citations back to source. Self-contained
          component with its own state machine + history. */}
      <DealQaBox dealId={dealId} />

      {/* PR-NX30 (2026-05-17) — discoverability surface for the auto-fill
          workflow. Renders only when ≥1 extracted field is ready to apply;
          hides entirely otherwise. Without this, the auto-fill modal
          lives buried in the Documents tab and operators landing here
          never discover it. */}
      <AutoFillReadyCard dealId={dealId} />

      {/* City-level callouts that may apply to this parcel. Empty for
          non-Bengaluru deals or before the auto-derive endpoint has
          returned warnings. Stops the "discovered in IC" failure mode. */}
      <DealAutoDerivedWarningsStrip deal={deal} />

      {/* ── Below the fold ──────────────────────────────────────────────
          Everything beneath this point is wrapped in a CollapsibleCard
          so the analyst can fold the page down to just the high-leverage
          surfaces (KPIs / pulse / synthesis / Q&A). Expand state is
          persisted to localStorage per-section so the analyst's choice
          sticks across sessions.

          Default-expanded sections: Financial Summary, Buildability,
          Next Steps, Notes (the things you want to see fast on most
          deals).
          Default-collapsed: Readiness deep-dive, Stage History, Recent
          Activities (longer, lower-priority). */}

      {/* Financial Summary */}
      {financials && (
        <CollapsibleCard
          id="overview-financial-summary"
          icon={IndianRupee}
          title="Financial Summary"
          sub="Snapshot from the latest computed model. Open the full model for the deterministic graph + sensitivities."
          meta={
            <Link
              to={`/dashboard/financials/${dealId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-accent hover:opacity-80 flex items-center gap-1"
            >
              Full Model <ArrowRight size={12} />
            </Link>
          }
          defaultExpanded
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
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
                    'text-base font-bold tabular-nums',
                    highlight ? 'text-data-positive' : 'text-content-primary'
                  )}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {/* Workstream A — model-trust verdict, sitting with the financial
          numbers. Gated on `financials`; the strip also self-hides when
          the model class is not yet catalogued. */}
      {financials && <ModelTrustSummary dealId={dealId} />}

      {propertyForBuildability && (
        <CollapsibleCard
          id="overview-buildability"
          icon={Gauge}
          title="Buildable envelope"
          sub="Deterministic FAR / setback / coverage from the Bengaluru rule engine."
          defaultExpanded
        >
          <div className="pt-3 -mx-4 -mb-4">
            <BuildabilitySummary
              property={propertyForBuildability}
              assetClass={deal.asset_class}
              title="Buildable envelope"
            />
          </div>
        </CollapsibleCard>
      )}

      {/* Readiness deep-dive — full breakdown lives here; the compact
          version is in the pulse ribbon above the fold. */}
      {readiness && (
        <CollapsibleCard
          id="overview-readiness-detail"
          icon={Activity}
          title="Readiness breakdown"
          sub="Per-axis scoring underlying the readiness ribbon. Surfaces the deal-breakers and key-risk callouts."
          defaultExpanded={false}
          meta={
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
        >
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 pt-3">
            {[
              { label: 'Readiness', value: `${readiness.readiness_pct || 0}%` },
              { label: 'DD Complete', value: `${readiness.dd_completion_pct || 0}%` },
              { label: 'Approvals Validated', value: `${readiness.approval_completion_pct || 0}%` },
              { label: 'Open Risk Score', value: `${readiness.risk_score || 0}` },
              { label: 'Documents', value: `${readiness.document_count || 0}` },
            ].map((item) => (
              <div key={item.label} className="bg-bg-secondary rounded-lg p-3">
                <p className="text-xs text-content-muted mb-1">{item.label}</p>
                <p className="text-base font-bold text-content-primary tabular-nums">{item.value}</p>
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
        </CollapsibleCard>
      )}

      {/* Next Steps */}
      {nextStepGroups.length > 0 && (
        <CollapsibleCard
          id="overview-next-steps"
          icon={ListChecks}
          title="Next Steps"
          sub="Stage-aware playbook. Refreshed when the workspace recomputes the deal snapshot."
          defaultExpanded
          meta={
            <span className="text-xs text-content-muted tabular-nums">
              {nextStepGroups.reduce((s, g) => s + (g.items?.length || 0), 0)} actions
            </span>
          }
        >
          <div className="space-y-4 pt-3">
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
        </CollapsibleCard>
      )}

      {/* Stage History — usually long; default-collapsed. */}
      {stageHistory.length > 0 && (
        <CollapsibleCard
          id="overview-stage-history"
          icon={History}
          title="Stage History"
          sub="Every stage transition with actor + timestamp. Append-only."
          defaultExpanded={false}
          meta={
            <span className="text-xs text-content-muted tabular-nums">
              {stageHistory.length} {stageHistory.length === 1 ? 'transition' : 'transitions'}
            </span>
          }
        >
          <div className="relative pt-3">
            <div className="absolute left-3 top-5 bottom-2 w-px bg-hairline" />
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
        </CollapsibleCard>
      )}

      {/* Recent Activities — default-collapsed; full Activity tab has the
          authoritative view. */}
      {recentActivities.length > 0 && (
        <CollapsibleCard
          id="overview-recent-activities"
          icon={Clock}
          title="Recent Activities"
          sub="Last five entries. Open the Activity tab for the full timeline."
          defaultExpanded={false}
          meta={
            <span className="text-xs text-content-muted tabular-nums">
              {recentActivities.length} on file
            </span>
          }
        >
          <ul className="divide-y divide-hairline-soft pt-3">
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
        </CollapsibleCard>
      )}

      {/* Deal Notes — surfaced last; default expanded only when present. */}
      {deal.notes && (
        <CollapsibleCard
          id="overview-notes"
          icon={StickyNote}
          title="Notes"
          sub="Free-text notes on this deal."
          defaultExpanded
        >
          <p className="text-sm text-content-secondary whitespace-pre-line leading-relaxed pt-3">{deal.notes}</p>
        </CollapsibleCard>
      )}
    </div>
  );
}

/**
 * Compact above-the-fold readiness ribbon — replaces the full Readiness
 * card. Surfaces the four numbers an analyst checks first ("am I close
 * to IC-ready?") plus an inline list of the top open risks. The full
 * per-axis breakdown lives in a CollapsibleCard lower on the page.
 */
function DealPulseRibbon({ readiness, keyRisks }) {
  const statusTone =
    readiness.status === 'ic_ready'
      ? 'success'
      : readiness.status === 'work_in_progress'
        ? 'warn'
        : 'danger';
  const statusLabel =
    readiness.status === 'ic_ready'
      ? 'Investor-Grade'
      : readiness.status === 'work_in_progress'
        ? 'In Progress'
        : 'Not Ready';
  const dealBreakers = Number(readiness.pending_deal_breakers || 0);
  return (
    <div className="bg-bg-elevated border border-hairline rounded-editorial p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Activity size={16} className="text-content-muted shrink-0" />
          <div className="text-eyebrow uppercase text-content-muted font-medium tracking-wider text-[10px]">
            Deal Pulse
          </div>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>
        <div className="flex items-center gap-5 flex-wrap text-xs">
          <PulseMetric label="Readiness" value={`${readiness.readiness_pct || 0}%`} />
          <PulseMetric label="DD" value={`${readiness.dd_completion_pct || 0}%`} />
          <PulseMetric label="Approvals" value={`${readiness.approval_completion_pct || 0}%`} />
          <PulseMetric label="Risk score" value={`${readiness.risk_score || 0}`} />
        </div>
      </div>
      {(dealBreakers > 0 || keyRisks.length > 0) && (
        <div className="mt-3 pt-3 border-t border-hairline-soft flex items-start gap-3 flex-wrap">
          <ShieldAlert size={13} className="text-data-negative shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            {dealBreakers > 0 && (
              <p className="text-sm text-data-negative">
                {dealBreakers} deal-breaker{dealBreakers === 1 ? '' : 's'} unresolved.
              </p>
            )}
            {keyRisks.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {keyRisks.slice(0, 5).map((risk) => (
                  <Badge key={risk} tone="danger">{risk}</Badge>
                ))}
                {keyRisks.length > 5 && (
                  <span className="text-[10px] text-content-muted self-center">
                    +{keyRisks.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PulseMetric({ label, value }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-content-muted">{label}</span>
      <span className="text-base font-semibold text-content-primary tabular-nums">{value}</span>
    </div>
  );
}
