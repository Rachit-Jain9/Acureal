import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Label,
} from 'recharts';
import {
  Briefcase,
  TrendingUp,
  ArrowRight,
  AlertTriangle,
  Clock,
} from 'lucide-react';

import { useDashboard } from '../hooks/useDashboard';
import LoadingSpinner from '../components/common/LoadingSpinner';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, MetricTile } from '../design-system';
import useThemeStore from '../store/themeStore';
import {
  formatCrores,
  formatPct,
  formatRelativeTime,
  STAGE_CONFIG,
} from '../utils/format';

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

function SectionCard({ title, children, action, eyebrow }) {
  return (
    <Card elevated className="p-5">
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        action={action}
        className="mb-4 items-center"
      />
      {children}
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useDashboard();
  const chartPalette = useChartPalette();
  const tooltipStyle = useTooltipStyle();
  const accentBarFill = chartPalette[0];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-20">
        <AlertTriangle
          size={36}
          className="mx-auto mb-3"
          style={{ color: 'var(--color-data-negative)' }}
        />
        <p
          className="text-base font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Failed to load dashboard
        </p>
        <p
          className="text-sm mt-1"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {error?.message}
        </p>
        <button onClick={() => refetch()} className="btn btn-secondary mt-4">
          Retry
        </button>
      </div>
    );
  }

  const {
    stats = {},
    stage_distribution = [],
    recent_activities = [],
    top_deals_by_irr = [],
    cities_distribution = [],
  } = data || {};

  const activeDeals     = stats.active_deals_count   || 0;
  const pipelineValue   = stats.total_pipeline_value_cr || 0;
  const avgIrr          = stats.avg_irr_pct          || 0;
  const icReadyDeals    = stats.ic_ready_count        || 0;
  const dealsWithRisk   = stats.deals_with_open_risks || 0;

  // Pipeline bar chart data — filter out stages with 0 deals
  const pipelineChartData = stage_distribution
    .map((item) => ({
      stage: STAGE_CONFIG[item.stage]?.label || item.stage,
      count: item.count,
      fill: accentBarFill,
    }))
    .filter((d) => d.count > 0);

  // City pie chart data
  const cityChartData = cities_distribution
    .map((item) => ({
      name: item.city || item.name || 'Unknown',
      value: Number(item.deal_count ?? item.count ?? 0),
    }))
    .filter((item) => item.value > 0);
  const totalCityDeals = cityChartData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="REDIP — Deal Intelligence"
        title="Dashboard"
        description="Live overview of sourcing, underwriting, and IC-ready deals across the pipeline."
        actions={
          <Link
            to="/dashboard/deals"
            className="btn btn-secondary text-sm flex items-center gap-1.5"
          >
            All Deals <ArrowRight size={14} />
          </Link>
        }
      />

      {/* ── Primary KPI row — institutional scan: pipeline size, flow, return, readiness ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile
          label="Pipeline Value"
          value={formatCrores(pipelineValue)}
          footnote="Cumulative ask · active deals"
        />
        <MetricTile
          label="Active Deals"
          value={activeDeals}
          footnote="Live in pipeline"
          delta={dealsWithRisk > 0 ? `${dealsWithRisk} with open risk` : null}
          tone={dealsWithRisk > 0 ? 'down' : 'neutral'}
        />
        <MetricTile
          label="Avg IRR"
          value={formatPct(avgIrr)}
          footnote="Across modelled deals"
          delta={avgIrr >= 20 ? 'Above 20% bench' : avgIrr >= 12 ? null : 'Below bench'}
          tone={avgIrr >= 20 ? 'up' : avgIrr >= 12 ? 'neutral' : 'down'}
        />
        <MetricTile
          label="Investor-Grade"
          value={icReadyDeals}
          footnote="IC-ready · fully vetted"
          delta={icReadyDeals > 0 ? 'Ready to deploy' : null}
          tone={icReadyDeals > 0 ? 'up' : 'neutral'}
        />
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Distribution */}
        <SectionCard title="Pipeline Distribution" eyebrow="Stage mix">
          {pipelineChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={pipelineChartData}
                margin={{ top: 4, right: 10, bottom: 4, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border-primary)"
                  strokeOpacity={0.5}
                />
                <XAxis
                  dataKey="stage"
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  axisLine={{ stroke: 'var(--color-border-primary)' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: 'var(--color-brand-accent-soft)' }}
                />
                <Bar
                  dataKey="count"
                  fill={accentBarFill}
                  radius={[3, 3, 0, 0]}
                  name="Deals"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-16 text-center">
              <Briefcase
                size={28}
                className="mx-auto mb-2"
                style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}
              />
              <p
                className="text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                No pipeline data yet
              </p>
              <Link
                to="/dashboard/deals"
                className="text-xs mt-1 inline-block hover:underline"
                style={{ color: 'var(--color-brand-accent)' }}
              >
                Create your first deal
              </Link>
            </div>
          )}
        </SectionCard>

        {/* City Distribution */}
        <SectionCard title="City Distribution" eyebrow="Geography">
          {cityChartData.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_180px] gap-4 items-center">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={cityChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    innerRadius={58}
                    paddingAngle={3}
                    stroke="transparent"
                    isAnimationActive={false}
                  >
                    {cityChartData.map((item, idx) => (
                      <Cell
                        key={item.name}
                        fill={chartPalette[idx % chartPalette.length]}
                      />
                    ))}
                    <Label
                      content={({ viewBox }) => {
                        if (!viewBox || typeof viewBox.cx !== 'number') return null;
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy - 4}
                              fill="var(--color-text-primary)"
                              fontSize="22"
                              fontWeight="700"
                            >
                              {totalCityDeals}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy + 16}
                              fill="var(--color-text-muted)"
                              fontSize="11"
                            >
                              deals
                            </tspan>
                          </text>
                        );
                      }}
                    />
                  </Pie>
                  <Tooltip
                    formatter={(value, _n, entry) => [
                      `${value} deal${value === 1 ? '' : 's'}`,
                      entry.payload.name,
                    ]}
                    contentStyle={tooltipStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {cityChartData.map((item, idx) => {
                  const pct = totalCityDeals > 0
                    ? Math.round((item.value / totalCityDeals) * 100)
                    : 0;
                  return (
                    <div
                      key={item.name}
                      className="flex items-center justify-between rounded-md px-3 py-2"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        border: '1px solid var(--color-border-secondary)',
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: chartPalette[idx % chartPalette.length] }}
                        />
                        <div className="min-w-0">
                          <p
                            className="text-sm font-medium truncate"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {item.name}
                          </p>
                          <p
                            className="text-xs tabular-nums"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            {pct}%
                          </p>
                        </div>
                      </div>
                      <span
                        className="text-sm font-bold ml-2 tabular-nums"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {item.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-16 text-center">
              <p
                className="text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Cities will appear once deals have location data
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Lower row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activities */}
        <SectionCard
          title="Recent Activities"
          eyebrow="Timeline"
          action={
            <Link
              to="/dashboard/deals"
              className="text-xs hover:underline flex items-center gap-1"
              style={{ color: 'var(--color-brand-accent)' }}
            >
              View all <ArrowRight size={12} />
            </Link>
          }
        >
          {recent_activities.length > 0 ? (
            <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {recent_activities.map((activity, idx) => (
                <li
                  key={activity.id || idx}
                  className="flex items-start gap-3 p-3 rounded-md"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border-secondary)',
                  }}
                >
                  <div
                    className="w-1.5 h-1.5 mt-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-brand-accent)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm leading-snug"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {activity.description}
                    </p>
                    <p
                      className="text-xs mt-1"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <Clock size={10} className="inline mr-1" />
                      {formatRelativeTime(activity.activity_date || activity.created_at)}
                      {activity.deal_name && (
                        <span
                          className="ml-1"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          &middot; {activity.deal_name}
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-10 text-center">
              <p
                className="text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                No activities yet
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}
              >
                Activities logged on deals will appear here
              </p>
            </div>
          )}
        </SectionCard>

        {/* Top Deals by IRR */}
        <SectionCard
          title="Top Deals by IRR"
          eyebrow="Performance"
          action={
            <Link
              to="/dashboard/deals"
              className="text-xs hover:underline flex items-center gap-1"
              style={{ color: 'var(--color-brand-accent)' }}
            >
              All deals <ArrowRight size={12} />
            </Link>
          }
        >
          {top_deals_by_irr.length > 0 ? (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <th
                      className="text-left py-2 pr-3 font-medium"
                      style={{
                        color: 'var(--color-text-muted)',
                        fontSize: '0.6875rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      Deal
                    </th>
                    <th
                      className="text-left py-2 pr-3 font-medium"
                      style={{
                        color: 'var(--color-text-muted)',
                        fontSize: '0.6875rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      Stage
                    </th>
                    <th
                      className="text-right py-2 pr-3 font-medium"
                      style={{
                        color: 'var(--color-text-muted)',
                        fontSize: '0.6875rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      Value
                    </th>
                    <th
                      className="text-right py-2 font-medium"
                      style={{
                        color: 'var(--color-text-muted)',
                        fontSize: '0.6875rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      IRR
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {top_deals_by_irr.map((deal, idx) => {
                    const stageConf = STAGE_CONFIG[deal.stage] || {};
                    const irrColor = Number(deal.irr_pct) >= 20
                      ? 'var(--color-data-positive)'
                      : Number(deal.irr_pct) >= 15
                        ? 'var(--color-brand-premium)'
                        : 'var(--color-brand-accent)';
                    return (
                      <tr
                        key={deal.id || idx}
                        className="transition-colors"
                        style={{
                          borderBottom: '1px solid var(--color-border-secondary)',
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = 'var(--color-surface)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = 'transparent')
                        }
                      >
                        <td className="py-2.5 pr-3">
                          <Link
                            to={`/dashboard/deals/${deal.id}`}
                            className="font-medium truncate max-w-[140px] block"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {deal.name}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge tone={stageConf.tone}>
                            {stageConf.label || deal.stage}
                          </Badge>
                        </td>
                        <td
                          className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          {formatCrores(deal.total_revenue_cr)}
                        </td>
                        <td
                          className="py-2.5 text-right font-semibold whitespace-nowrap tabular-nums"
                          style={{ color: irrColor }}
                        >
                          {formatPct(deal.irr_pct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-10 text-center">
              <TrendingUp
                size={28}
                className="mx-auto mb-2"
                style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}
              />
              <p
                className="text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Run a financial model on a deal to see IRR rankings
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
