import { useState } from 'react';
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
} from 'lucide-react';
import { clsx } from 'clsx';
import { intelligenceAPI } from '../../services/api';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import { SQFT_PER_ACRE } from '../../config/india';
import Badge from '../common/Badge';
import { SectionHeader } from '../../design-system';
import BuildabilitySummary from './BuildabilitySummary';
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
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const handleAiAnalysis = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await intelligenceAPI.getDealAnalysis(dealId);
      setAiAnalysis(res.data.data);
    } catch (err) {
      setAiError(
        err.response?.data?.message ||
          'Analysis failed. Check that ANTHROPIC_API_KEY is configured.'
      );
    } finally {
      setAiLoading(false);
    }
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

      {/* AI Deal Analysis */}
      <div className="card-editorial">
        <SectionHeader
          size="sm"
          icon={Brain}
          title={
            <>
              AI Deal Analysis
              <Badge className="ml-2">Claude</Badge>
            </>
          }
          action={
            <button
              onClick={handleAiAnalysis}
              disabled={aiLoading}
              className="btn btn-primary flex items-center gap-1.5 text-sm"
            >
              {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
              {aiLoading ? 'Analysing...' : aiAnalysis ? 'Refresh' : 'Generate Analysis'}
            </button>
          }
        />
        {aiError && (
          <p className="mt-3 text-sm text-data-negative bg-bg-secondary border border-hairline rounded px-3 py-2">
            {aiError}
          </p>
        )}
        {aiAnalysis?.analysis ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-content-primary leading-relaxed whitespace-pre-line">
              {aiAnalysis.analysis}
            </p>
            <p className="text-xs text-content-muted mt-2">
              Generated{' '}
              {aiAnalysis.generatedAt
                ? new Date(aiAnalysis.generatedAt).toLocaleString('en-IN')
                : ''}{' '}
              · Cross-referenced against internal pipeline, market benchmarks, and verified comps
            </p>
          </div>
        ) : (
          !aiLoading && !aiError && (
            <p className="mt-2 text-sm text-content-secondary">
              Generate a Claude-powered Investor-Grade memo cross-referencing this deal's financials against
              Bengaluru micro-market benchmarks and verified comps.
            </p>
          )
        )}
      </div>

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
