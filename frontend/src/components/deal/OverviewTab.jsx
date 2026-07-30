import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  TrendingUp,
  IndianRupee,
  Layers,
  MapPin,
  Activity,
  ShieldAlert,
  ListChecks,
  StickyNote,
  Gauge,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDealContext, useDealRecord, useDealRecommendations } from '../../hooks/useDealContext';
import { useScrollOnMount } from '../../hooks/useEvidenceNavigate';
import { SQFT_PER_ACRE } from '../../config/india';
import Badge from '../common/Badge';
import { SectionHeader, CollapsibleCard } from '../../design-system';
import BuildabilitySummary from './BuildabilitySummary';
import AiSynthesisPanel from './AiSynthesisPanel';
import DealQaBox from './DealQaBox';
import AutoFillReadyCard from './AutoFillReadyCard';
// Workstream B — compact Risk Radar pinned to the deal front page.
import RiskRadarStrip from './RiskRadarStrip';
// Acureal Pending §5.7 — Recommendation Engine cards on the Overview.
import RecommendationsPanel from './RecommendationsPanel';
// Phase 1 / Pillar 1 — Bengaluru micro-market intelligence briefing.
import MicroMarketBriefingPanel from './MicroMarketBriefingPanel';
// Phase 2 closeout — Strategic Fit Section that unifies the three property-
// consultant ranking cards (Best Use Simulator + Deal-Structure Recommender +
// Capital-Stack Optimizer) under one section header with a glanceable summary.
import StrategicFitSection from './StrategicFitSection';
// Workstream A — compact model-trust verdict beside the financial numbers.
import ModelTrustSummary from '../financials/ModelTrustSummary';
// PR-NX53 (2026-05-19) — inline provenance chip on the Land Area
// key-metric card. Extends the chip that already ships in ParcelTab
// (PR-NX50) to the Overview tab where operators land first.
import ProvenanceChip from '../common/ProvenanceChip';
import { useFieldProvenance } from '../../hooks/useFieldProvenance';
import DealAutoDerivedWarningsStrip from './DealAutoDerivedWarningsStrip';
import DealPlanningSnapshot from './DealPlanningSnapshot';
import {
  formatCrores,
  formatCroresOrDash,
  formatPct,
  formatArea,
  PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
} from '../../utils/format';
import { buildPlaybook } from '../../utils/dealPlaybook';

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
export default function OverviewTab({ setTab }) {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const recommendations = useDealRecommendations();
  useScrollOnMount();
  // PR-NX53 (2026-05-19) — field-provenance map for inline chip on the
  // Land Area card. Returns empty when no auto-fill events fire — chip
  // simply doesn't render.
  const { data: provenanceData } = useFieldProvenance(dealId);
  const fieldProvenance = provenanceData?.field_provenance || {};

  const financials = deal.financials;
  const readiness = deal.readiness_summary || null;
  // Backend-provided custom next-step groups, if any — preserved as-is.
  const nextStepGroups =
    Array.isArray(deal.next_steps) && deal.next_steps.length > 0 ? deal.next_steps : [];
  // The live, stage-aware playbook — every step done/pending from the deal's
  // own state. The deterministic core of the adaptive deal workspace (D1).
  const playbook = buildPlaybook(deal);
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
            {formatCroresOrDash(deal.land_ask_price_cr)}
          </p>
          {Number(deal.negotiated_price_cr) > 0 && (
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

      {/* Acureal Pending §5.7 — Recommendation Engine cards. Deterministic
          signal-extractor + rule-engine output on every workspace load.
          Cards are evidence-backed; legal-carve-out cards (RERA, approvals,
          title, encumbrance) bypass any future AI narrator. */}
      <RecommendationsPanel recommendations={recommendations} />

      {/* Phase 1 / Pillar 1 — Bengaluru Micro-Market Briefing. Surfaces the
          per-locality benchmark bands + demand signals for the deal's parcel
          (auto-classified by Haversine-nearest-centroid). Renders empty-state
          honestly when the parcel has no coordinates or sits outside the
          seeded micro-markets. */}
      <MicroMarketBriefingPanel />

      {/* Phase 2 closeout — Strategic Fit Analysis. Visually unifies the three
          property-consultant ranking cards (Best Use Simulator + Deal-Structure
          Recommender + Capital-Stack Optimizer) under one section header with
          a glanceable top-fit summary strip. Each card retains its expandable
          functionality. Section is collapsible to reduce vertical weight when
          the operator wants to focus on other Overview content. */}
      <StrategicFitSection />

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

      {/* Planning context — resolved Bengaluru Planning District + census
          demographics + BBMP guidance band, auto-derived from the deal's
          address. The positive counterpart to the warnings strip below;
          shares the same cached hook and renders nothing off-BBMP or when
          the geocode is approximate. Surfaces the master-plan context on
          the front page instead of only the Parcel tab. */}
      <DealPlanningSnapshot deal={deal} />

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
              dealId={dealId}
              onUploadClick={setTab ? () => setTab('documents') : undefined}
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

      {/* Stage Playbook — Workstream D1, the adaptive face. A live,
          stage-aware checklist: every step's done/pending status is computed
          deterministically from the deal's own state, so the workspace
          genuinely guides the operator through the current stage instead of
          listing generic advice. Backend-provided custom next-step groups,
          if any, render beneath. */}
      {(playbook || nextStepGroups.length > 0) && (
        <CollapsibleCard
          id="overview-next-steps"
          icon={ListChecks}
          title="Stage Playbook"
          sub="What matters now for this deal's stage — live status from its own data."
          defaultExpanded
          meta={
            playbook ? (
              <span className="text-xs text-content-muted tabular-nums">
                {playbook.done} of {playbook.total} done
              </span>
            ) : null
          }
        >
          <div className="space-y-4 pt-3">
            {playbook && (
              <div className="space-y-2.5">
                {!playbook.terminal && (
                  <div
                    className="h-1.5 rounded-full bg-bg-secondary overflow-hidden"
                    role="progressbar"
                    aria-valuenow={playbook.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Stage playbook progress"
                  >
                    <div
                      className="h-full bg-accent rounded-full transition-[width] duration-500 ease-out"
                      style={{ width: `${playbook.pct}%` }}
                    />
                  </div>
                )}
                <ul className="space-y-1.5">
                  {playbook.steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2.5 text-sm">
                      {step.status === 'done' ? (
                        <CheckCircle2 size={16} className="text-data-positive mt-px shrink-0" />
                      ) : (
                        <Circle size={16} className="text-content-muted mt-px shrink-0" />
                      )}
                      <span
                        className={clsx(
                          'flex-1 leading-snug',
                          step.status === 'done'
                            ? 'text-content-muted'
                            : 'text-content-primary',
                        )}
                      >
                        {step.label}
                        {step.detail && (
                          <span className="text-xs text-content-muted ml-1.5">· {step.detail}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

      {/* Stage History and Recent Activities used to live here as
          default-collapsed CollapsibleCards. Both were strict duplicates
          of authoritative views on the Activity tab — the Activity tab
          is THE place to see "what changed when" + "the latest 50
          actions". Operator audit 2026-05-28: cut both from Overview to
          stop the two-places-to-look-for-history pattern. The Stage
          Playbook block above is the only stage-related surface that
          earns Overview real estate, since it lists what STILL NEEDS
          DOING for the current stage, not the historical record. */}

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
