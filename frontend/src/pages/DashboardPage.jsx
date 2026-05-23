import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, AlertTriangle, Settings2 } from 'lucide-react';

import { useDashboard } from '../hooks/useDashboard';
import { useDashboardLayout } from '../hooks/useDashboardLayout';
import useAuthStore from '../store/authStore';
import useTourStore from '../store/tourStore';
import { isPlatformAdmin } from '../utils/permissions';
import PageHeader from '../components/common/PageHeader';
import { SkeletonKpi, SkeletonCard } from '../design-system';
import useThemeStore from '../store/themeStore';
import {
  KpiStripWidget,
  CompsQueueAlertWidget,
  PipelineChartWidget,
  CitiesChartWidget,
  RecentActivitiesWidget,
  TopDealsIrrWidget,
  AiCostSummaryWidget,
  AuditTrailTailWidget,
} from '../components/dashboard/DashboardWidgets';
import PortfolioRiskRadarWidget from '../components/dashboard/PortfolioRiskRadarWidget';
import AttentionPanel from '../components/dashboard/AttentionPanel';
import CustomizePopover from '../components/dashboard/CustomizePopover';
import GettingStarted from '../components/dashboard/GettingStarted';

// First-run panel: the canonical "dismissed" flag now lives in tourStore
// (alongside the welcome and deal-workspace tour state) so the Settings
// "Show Getting Started again" button can re-show the panel reactively
// — no page reload or storage-event listener needed.

// Precision Analysis chart palette — colorblind-safe, layered:
//   neutral blue (trust)  → primary / default
//   positive green        → upside / revenue
//   amber premium         → rare / above-bench signals
//   highlight teal        → secondary series
//   violet + coral        → long-tail categorical
// These hexes mirror --chart-1 through --chart-6 so tooltips and SVG both
// stay in sync with CSS vars the rest of the app uses.
const CHART_PALETTE_DARK = ['#60A5FA', '#22C55E', '#F5B800', '#14B8A6', '#A78BFA', '#F87171', '#38BDF8', '#34D399', '#FBBF24', '#FB7185'];
const CHART_PALETTE_LIGHT = ['#2563EB', '#16A34A', '#B45309', '#0D9488', '#7C3AED', '#DC2626', '#0EA5E9', '#059669', '#D97706', '#E11D48'];

function useChartPalette() {
  const mode = useThemeStore((s) => s.mode);
  return mode === 'light' ? CHART_PALETTE_LIGHT : CHART_PALETTE_DARK;
}

function useTooltipStyle() {
  return {
    borderRadius: '8px',
    border: '1px solid var(--color-border-primary)',
    backgroundColor: 'var(--color-bg-elevated)',
    color: 'var(--color-text-primary)',
    fontSize: '12px',
    fontFeatureSettings: '"tnum"',
    boxShadow: 'var(--shadow-elevated)',
    padding: '8px 10px',
  };
}

// Map widget id → render. Each entry is a small thunk that produces the
// component for the current dashboard payload + chart context. Wrapping
// in thunks (vs an object of components) keeps the heavy chart deps
// from rendering when a widget is toggled off.
const buildWidgetRenderer = ({ data, chartPalette, tooltipStyle, canCurate }) => ({
  kpi_strip:             () => <KpiStripWidget stats={data?.stats} />,
  comps_queue_alert:     () => <CompsQueueAlertWidget stats={data?.stats} canCurate={canCurate} />,
  // Self-fetches via usePortfolioRiskRadar — independent of the dashboard
  // stats payload so it can refetch on its own staleTime cadence.
  portfolio_risk_radar:  () => <PortfolioRiskRadarWidget />,
  // Today's Attention — specific item-level signals (overdue DD, expiring
  // approvals, recent risks, stale deals, recent activity). Self-fetches.
  attention_panel:       () => <AttentionPanel />,
  pipeline_chart:        () => <PipelineChartWidget stage_distribution={data?.stage_distribution} chartPalette={chartPalette} tooltipStyle={tooltipStyle} />,
  cities_chart:          () => <CitiesChartWidget cities_distribution={data?.cities_distribution} chartPalette={chartPalette} tooltipStyle={tooltipStyle} />,
  recent_activities:     () => <RecentActivitiesWidget recent_activities={data?.recent_activities} />,
  top_deals_irr:         () => <TopDealsIrrWidget top_deals_by_irr={data?.top_deals_by_irr} />,
  ai_cost_summary:       () => <AiCostSummaryWidget />,
  audit_trail_tail:      () => <AuditTrailTailWidget />,
});

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useDashboard();
  const chartPalette = useChartPalette();
  const tooltipStyle = useTooltipStyle();
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;
  const userName = user?.name;
  // The Comps Review Queue widget links to a platform-admin surface, so the
  // signal that gates it is "is REDIP platform admin", not workspace role.
  const canCurate = isPlatformAdmin(user);

  const { layout, toggleVisible, moveUp, moveDown, reset } = useDashboardLayout();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Getting Started visibility is owned by the tour store — DashboardPage
  // is just a consumer. That way the Settings "Show Getting Started
  // again" button re-renders this page without a reload.
  const onboardingDismissed = useTourStore((s) => s.gettingStartedDismissed);
  const dismissOnboarding = useTourStore((s) => s.dismissGettingStarted);

  // Skeleton mirrors the real dashboard shape — KPI row + two chart cards —
  // so the layout doesn't reflow when data lands. Per FRONTEND_GUIDELINES §2:
  // skeletons not spinners for any load > 100ms.
  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader
          eyebrow="REDIP — Deal Intelligence"
          title="Dashboard"
          description="Live overview of sourcing, underwriting, and IC-ready deals across the pipeline."
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonCard height="h-64" />
          <SkeletonCard height="h-64" />
        </div>
        <SkeletonCard height="h-72" titleWidth="w-1/4" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-20">
        <AlertTriangle size={36} className="mx-auto mb-3 text-data-negative" />
        <p className="text-base font-semibold text-content-primary">Failed to load dashboard</p>
        <p className="text-sm mt-1 text-content-muted">{error?.message}</p>
        <button onClick={() => refetch()} className="btn btn-secondary mt-4">
          Retry
        </button>
      </div>
    );
  }

  // First-run: a workspace with zero deals gets the role-aware Getting
  // Started panel in place of a grid of empty widgets. `total_deals`
  // counts archived deals too, so this only fires for a truly fresh
  // workspace — and never again once the operator dismisses it.
  const isFirstRun = (data?.stats?.total_deals ?? 0) === 0;
  if (isFirstRun && !onboardingDismissed) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="REDIP — Deal Intelligence"
          title="Dashboard"
          description="Live overview of sourcing, underwriting, and IC-ready deals across the pipeline."
        />
        <GettingStarted userName={userName} role={userRole} onDismiss={dismissOnboarding} />
      </div>
    );
  }

  const renderer = buildWidgetRenderer({ data, chartPalette, tooltipStyle, canCurate });

  // Walk the persisted layout in order. Skip non-visible widgets, skip
  // unknown ids, and pair adjacent "chart-grid" widgets into a 2-col row
  // so the existing pipeline+cities visual rhythm survives the refactor.
  const SIDE_BY_SIDE_PAIRS = [
    new Set(['pipeline_chart', 'cities_chart']),
    new Set(['recent_activities', 'top_deals_irr']),
    new Set(['ai_cost_summary', 'audit_trail_tail']),
  ];

  const blocks = [];
  let i = 0;
  while (i < layout.length) {
    const entry = layout[i];
    if (!entry.visible || !renderer[entry.id]) {
      i += 1;
      continue;
    }
    const next = layout[i + 1];
    const pair = SIDE_BY_SIDE_PAIRS.find(
      (set) =>
        set.has(entry.id)
        && next?.visible
        && set.has(next.id)
        && renderer[next.id],
    );
    if (pair) {
      blocks.push(
        <div key={`${entry.id}+${next.id}`} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {renderer[entry.id]()}
          {renderer[next.id]()}
        </div>,
      );
      i += 2;
    } else {
      blocks.push(<div key={entry.id}>{renderer[entry.id]()}</div>);
      i += 1;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="REDIP — Deal Intelligence"
        title="Dashboard"
        description="Live overview of sourcing, underwriting, and IC-ready deals across the pipeline."
        actions={
          <div className="flex items-center gap-2 relative">
            <button
              type="button"
              data-customize-toggle
              onClick={() => setCustomizeOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-haspopup="dialog"
              aria-expanded={customizeOpen}
              title="Show, hide, and reorder dashboard sections"
            >
              <Settings2 size={13} />
              Customize
            </button>
            <Link
              to="/dashboard/deals"
              className="btn btn-secondary text-sm flex items-center gap-1.5"
            >
              All Deals <ArrowRight size={14} />
            </Link>
            <CustomizePopover
              open={customizeOpen}
              onClose={() => setCustomizeOpen(false)}
              layout={layout}
              toggleVisible={toggleVisible}
              moveUp={moveUp}
              moveDown={moveDown}
              reset={reset}
            />
          </div>
        }
      />

      {blocks}
    </div>
  );
}
