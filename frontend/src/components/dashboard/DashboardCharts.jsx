// Dashboard charts — the only dashboard widgets that pull in recharts.
//
// Split out of DashboardWidgets.jsx and lazy-loaded by DashboardPage so the
// recharts vendor chunk (~115 KB gzipped) stays OFF the dashboard's first-paint
// critical path. The dashboard shell + KPI strip + non-chart widgets render
// immediately; this module (and recharts) only fetches when the chart blocks
// mount, with a SkeletonCard holding the layout in the meantime. Returning
// users get it from cache. Sharing SectionCard from DashboardWidgets keeps the
// card chrome identical — DashboardWidgets no longer imports recharts, so this
// import pulls in no chart code.

import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Label,
} from 'recharts';
import { Briefcase, ArrowRight, MapPin } from 'lucide-react';
import EmptyState from '../common/EmptyState';
import { Button } from '../../design-system';
import { STAGE_CONFIG } from '../../utils/format';
import { SectionCard } from './DashboardWidgets';

// ── Pipeline distribution chart ────────────────────────────────────────────
export function PipelineChartWidget({ stage_distribution = [], chartPalette, tooltipStyle }) {
  const accentBarFill = chartPalette[0];
  const data = stage_distribution
    .map((item) => ({
      stage: STAGE_CONFIG[item.stage]?.label || item.stage,
      count: item.count,
      fill: accentBarFill,
    }))
    .filter((d) => d.count > 0);
  return (
    <SectionCard title="Pipeline Distribution" eyebrow="Stage mix">
      {data.length > 0 ? (
        <div role="img" aria-label={`Pipeline distribution by stage — ${data.map((d) => `${d.stage}: ${d.count}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 10, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" strokeOpacity={0.5} />
            <XAxis dataKey="stage" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={{ stroke: 'var(--color-border-primary)' }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-brand-accent-soft)' }} />
            {/* PR-NX60: 700ms draw-in matches FRONTEND_GUIDELINES §7
                (recharts default is 1500ms which feels sluggish on a
                small KPI-adjacent chart). */}
            <Bar dataKey="count" fill={accentBarFill} radius={[3, 3, 0, 0]} name="Deals" animationDuration={700} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          size="md"
          icon={Briefcase}
          title="No deals in your pipeline"
          description="Create your first deal to see how the pipeline splits across sourcing, diligence, and IC."
          action={(
            <Button as={Link} to="/dashboard/deals" variant="secondary" size="sm" rightIcon={<ArrowRight size={13} />}>
              Create a deal
            </Button>
          )}
        />
      )}
    </SectionCard>
  );
}

// ── Cities distribution chart ──────────────────────────────────────────────
export function CitiesChartWidget({ cities_distribution = [], chartPalette, tooltipStyle }) {
  const data = cities_distribution
    .map((item) => ({ name: item.city || item.name || 'Unknown', value: Number(item.deal_count ?? item.count ?? 0) }))
    .filter((item) => item.value > 0);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <SectionCard title="City Distribution" eyebrow="Geography">
      {data.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_180px] gap-4 items-center">
          <div role="img" aria-label={`City distribution — ${total} deals: ${data.map((d) => `${d.name} ${d.value}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              {/* PR-NX60 (2026-05-19): re-enable first-render draw-in
                  with 700ms decelerating cubic-bezier per FRONTEND_GUIDELINES §7
                  "Charts and data viz must be alive · First render: bars/lines/
                  pie segments draw in over 700ms". Pre-NX60 isAnimationActive
                  was hardcoded false — the pie just popped. Update animations
                  during data refresh stay smooth via recharts' default
                  inter-render tween. */}
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} innerRadius={58} paddingAngle={3} stroke="transparent" isAnimationActive animationDuration={700} animationEasing="ease-out">
                {data.map((item, idx) => (
                  <Cell key={item.name} fill={chartPalette[idx % chartPalette.length]} />
                ))}
                <Label content={({ viewBox }) => {
                  if (!viewBox || typeof viewBox.cx !== 'number') return null;
                  return (
                    <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                      <tspan x={viewBox.cx} y={viewBox.cy - 4} fill="var(--color-text-primary)" fontSize="22" fontWeight="700">{total}</tspan>
                      <tspan x={viewBox.cx} y={viewBox.cy + 16} fill="var(--color-text-muted)" fontSize="11">deals</tspan>
                    </text>
                  );
                }} />
              </Pie>
              <Tooltip formatter={(value, _n, entry) => [`${value} deal${value === 1 ? '' : 's'}`, entry.payload.name]} contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {data.map((item, idx) => {
              const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
              return (
                <div key={item.name} className="flex items-center justify-between rounded-md px-3 py-2 bg-surface border border-hairline-soft">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: chartPalette[idx % chartPalette.length] }} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate text-content-primary">{item.name}</p>
                      <p className="text-xs tabular-nums text-content-muted">{pct}%</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold ml-2 tabular-nums text-content-primary">{item.value}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          size="md"
          icon={MapPin}
          title="No location data yet"
          description="City distribution appears once your deals have a location set on the Parcel tab."
          action={(
            <Button as={Link} to="/dashboard/deals" variant="secondary" size="sm" rightIcon={<ArrowRight size={13} />}>
              Go to deals
            </Button>
          )}
        />
      )}
    </SectionCard>
  );
}
