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
  IndianRupee,
  Activity,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';

import { useDashboard } from '../hooks/useDashboard';
import StatCard from '../components/common/StatCard';
import LoadingSpinner from '../components/common/LoadingSpinner';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import {
  formatCrores,
  formatPct,
  formatRelativeTime,
  STAGE_CONFIG,
} from '../utils/format';

// Editorial monochrome palette for charts — single ink scale, no rainbow.
// Ordered dark→light so the biggest slice reads strongest.
const PIE_COLORS = [
  '#141413', '#2b2b29', '#3f3f3c', '#5d5d58',
  '#8a8a83', '#b9b9b2', '#d9d9d4', '#ececea',
  '#9ca3af', '#6b7280',
];
const INK_BAR_FILL = '#2b2b29';

const TOOLTIP_STYLE = {
  borderRadius: '6px',
  border: '1px solid rgb(217, 217, 212)',
  backgroundColor: 'rgb(251, 251, 248)',
  color: '#141413',
  fontSize: '12px',
  fontFeatureSettings: '"tnum"',
  boxShadow: '0 4px 14px -4px rgb(17 17 17 / 0.08)',
};

function SectionCard({ title, children, action, eyebrow }) {
  return (
    <div className="rounded-lg border border-line bg-paper-100 p-5 shadow-editorial dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <div>
          {eyebrow && <p className="eyebrow mb-0.5 dark:text-slate-400">{eyebrow}</p>}
          <h3 className="font-display text-base font-semibold tracking-tight text-ink-900 dark:text-white">
            {title}
          </h3>
        </div>
        {action && action}
      </div>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useDashboard();

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
        <AlertTriangle size={36} className="text-red-400 mx-auto mb-3" />
        <p className="text-base font-semibold text-gray-800 dark:text-gray-200">
          Failed to load dashboard
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error?.message}</p>
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

  const totalDeals      = stats.total_deals         || 0;
  const activeDeals     = stats.active_deals_count   || 0;
  const pipelineValue   = stats.total_pipeline_value_cr || 0;
  const avgIrr          = stats.avg_irr_pct          || 0;
  const icReadyDeals    = stats.ic_ready_count        || 0;
  const dealsWithRisk   = stats.deals_with_open_risks || 0;
  const docsUploaded    = stats.total_documents       || 0;
  const closedValue     = stats.closed_value_cr       || 0;

  // Pipeline bar chart data — filter out stages with 0 deals
  const pipelineChartData = stage_distribution
    .map((item) => ({
      stage: STAGE_CONFIG[item.stage]?.label || item.stage,
      count: item.count,
      fill: INK_BAR_FILL,
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
          <Link to="/dashboard/deals" className="btn btn-secondary text-sm flex items-center gap-1.5">
            All Deals <ArrowRight size={14} />
          </Link>
        }
      />

      {/* ── KPI row ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          title="Total Deals"
          value={totalDeals}
          icon={Briefcase}
          subtitle="All in pipeline"
        />
        <StatCard
          title="Active Deals"
          value={activeDeals}
          icon={Activity}
          subtitle="In progress"
          accent={activeDeals > 0 ? 'green' : undefined}
        />
        <StatCard
          title="Pipeline Value"
          value={formatCrores(pipelineValue)}
          icon={IndianRupee}
          subtitle="Cumulative ask price"
        />
        <StatCard
          title="Avg IRR"
          value={formatPct(avgIrr)}
          icon={TrendingUp}
          subtitle="Modelled deals"
          accent={avgIrr >= 20 ? 'green' : avgIrr >= 12 ? 'amber' : undefined}
        />
      </div>

      {/* ── Secondary KPI row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          title="Investor-grade"
          value={icReadyDeals}
          icon={CheckCircle2}
          subtitle="IC-ready deals"
          accent={icReadyDeals > 0 ? 'green' : undefined}
        />
        <StatCard
          title="Open risks"
          value={dealsWithRisk}
          icon={AlertTriangle}
          subtitle="Deals with flags"
          accent={dealsWithRisk > 0 ? 'red' : undefined}
        />
        <StatCard
          title="Documents"
          value={docsUploaded}
          icon={Briefcase}
          subtitle="Uploaded across deals"
        />
        <StatCard
          title="Closed value"
          value={closedValue > 0 ? formatCrores(closedValue) : '—'}
          icon={IndianRupee}
          subtitle="Deals marked closed"
        />
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Distribution */}
        <SectionCard title="Pipeline Distribution">
          {pipelineChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={pipelineChartData}
                margin={{ top: 4, right: 10, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(107,114,128,0.15)" />
                <XAxis
                  dataKey="stage"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={{ stroke: 'rgba(107,114,128,0.2)' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: 'rgba(43,43,41,0.06)' }}
                />
                <Bar dataKey="count" fill={INK_BAR_FILL} radius={[3, 3, 0, 0]} name="Deals" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-16 text-center">
              <Briefcase size={28} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-400 dark:text-gray-500">No pipeline data yet</p>
              <Link to="/dashboard/deals" className="text-xs text-primary-600 hover:underline mt-1 inline-block">
                Create your first deal
              </Link>
            </div>
          )}
        </SectionCard>

        {/* City Distribution */}
        <SectionCard title="City Distribution">
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
                      <Cell key={item.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                    <Label
                      content={({ viewBox }) => {
                        if (!viewBox || typeof viewBox.cx !== 'number') return null;
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                            <tspan x={viewBox.cx} y={viewBox.cy - 4} fill="#111827" fontSize="22" fontWeight="700">
                              {totalCityDeals}
                            </tspan>
                            <tspan x={viewBox.cx} y={viewBox.cy + 16} fill="#6b7280" fontSize="11">
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
                    contentStyle={TOOLTIP_STYLE}
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
                      className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {item.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{pct}%</p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100 ml-2">
                        {item.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-400 dark:text-gray-500">
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
          action={
            <Link
              to="/dashboard/deals"
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
            >
              View all <ArrowRight size={12} />
            </Link>
          }
        >
          {recent_activities.length > 0 ? (
            <ul className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {recent_activities.map((activity, idx) => (
                <li
                  key={activity.id || idx}
                  className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                >
                  <div className="w-2 h-2 mt-1.5 rounded-full bg-primary-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">
                      {activity.description}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      <Clock size={10} className="inline mr-1" />
                      {formatRelativeTime(activity.activity_date || activity.created_at)}
                      {activity.deal_name && (
                        <span className="ml-1 text-gray-500 dark:text-gray-400">
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
              <p className="text-sm text-gray-400 dark:text-gray-500">No activities yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Activities logged on deals will appear here
              </p>
            </div>
          )}
        </SectionCard>

        {/* Top Deals by IRR */}
        <SectionCard
          title="Top Deals by IRR"
          action={
            <Link
              to="/dashboard/deals"
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
            >
              All deals <ArrowRight size={12} />
            </Link>
          }
        >
          {top_deals_by_irr.length > 0 ? (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left py-2 pr-3 font-medium text-gray-500 dark:text-gray-400">
                      Deal
                    </th>
                    <th className="text-left py-2 pr-3 font-medium text-gray-500 dark:text-gray-400">
                      Stage
                    </th>
                    <th className="text-right py-2 pr-3 font-medium text-gray-500 dark:text-gray-400">
                      Value
                    </th>
                    <th className="text-right py-2 font-medium text-gray-500 dark:text-gray-400">
                      IRR
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {top_deals_by_irr.map((deal, idx) => {
                    const stageConf = STAGE_CONFIG[deal.stage] || {};
                    return (
                      <tr
                        key={deal.id || idx}
                        className="border-b border-gray-50 dark:border-gray-700/50 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                      >
                        <td className="py-2.5 pr-3">
                          <Link
                            to={`/dashboard/deals/${deal.id}`}
                            className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 truncate max-w-[140px] block"
                          >
                            {deal.name}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge className={stageConf.color}>
                            {stageConf.label || deal.stage}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {formatCrores(deal.total_revenue_cr)}
                        </td>
                        <td className={`py-2.5 text-right font-bold whitespace-nowrap ${
                          Number(deal.irr_pct) >= 20
                            ? 'text-green-600 dark:text-green-400'
                            : Number(deal.irr_pct) >= 15
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-primary-600 dark:text-primary-400'
                        }`}>
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
              <TrendingUp size={28} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Run a financial model on a deal to see IRR rankings
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
