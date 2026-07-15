import {
  ComposedChart, Bar, Line, Area, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { useChartAnim } from '../../hooks/useChartAnim';

// Hotel operating-history visuals from the TTM monthly series. Two charts:
//   1. Trading trend — ADR bars + occupancy line (dual axis), the classic
//      hotelier read of rate vs. fill.
//   2. Revenue composition — stacked room / F&B / other area + GOP-margin
//      line, showing the revenue mix and profitability trajectory.
// Recharts, lazy-loaded by the view; CSS-var colours; draw-in on first render
// (collapses under prefers-reduced-motion). Flat, editorial, tabular-nums.

const compactINR = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 })}L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
const monthLabel = (ym) => {
  const [y, m] = String(ym).split('-');
  const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m)] || m} ${String(y).slice(2)}`;
};

const TOOLTIP_STYLE = {
  borderRadius: '8px',
  border: '1px solid var(--color-border-primary)',
  backgroundColor: 'var(--color-bg-elevated)',
  color: 'var(--color-text-primary)',
  fontSize: '12px',
  fontFeatureSettings: '"tnum"',
  boxShadow: 'var(--shadow-elevated)',
  padding: '8px 10px',
};
const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-muted)' };

export default function HotelCharts({ metrics }) {
  const chartAnim = useChartAnim();
  const series = metrics?.operating?.series || [];
  if (series.length === 0) return null;

  const data = series.map((s) => ({
    name: monthLabel(s.month),
    adr: s.adr,
    occupancy: s.occupancyPct,
    room: s.roomRevenue || 0,
    fnb: s.fnbRevenue || 0,
    other: s.otherRevenue || 0,
    gopMargin: s.gopMarginPct,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="bg-bg-elevated border border-hairline rounded-editorial p-4 shadow-editorial">
        <h4 className="text-eyebrow uppercase tracking-[0.06em] text-content-muted font-medium mb-3">Rate &amp; occupancy trend</h4>
        <div className="h-60" role="img" aria-label="Monthly ADR bars and occupancy line">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" strokeOpacity={0.5} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: 'var(--color-border-primary)' }} tickLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="adr" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <YAxis yAxisId="occ" orientation="right" domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: 'var(--color-brand-accent-soft)' }}
                /* Recharts passes the series `name` prop here, not the dataKey. */
                formatter={(value, name) => (name === 'Occupancy'
                  ? [`${Number(value).toFixed(1)}%`, 'Occupancy']
                  : [`₹${Math.round(value).toLocaleString('en-IN')}`, 'ADR'])}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-text-muted)' }} />
              <Bar yAxisId="adr" dataKey="adr" name="ADR" fill="var(--color-brand-accent)" radius={[3, 3, 0, 0]} maxBarSize={26} {...chartAnim} animationDuration={700} animationEasing="ease-out" />
              <Line yAxisId="occ" type="monotone" dataKey="occupancy" name="Occupancy" stroke="var(--color-data-positive)" strokeWidth={2} dot={false} {...chartAnim} animationDuration={700} animationEasing="ease-out" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-bg-elevated border border-hairline rounded-editorial p-4 shadow-editorial">
        <h4 className="text-eyebrow uppercase tracking-[0.06em] text-content-muted font-medium mb-3">Revenue mix &amp; GOP margin</h4>
        <div className="h-60" role="img" aria-label="Stacked revenue composition with GOP margin line">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" strokeOpacity={0.5} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: 'var(--color-border-primary)' }} tickLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="rev" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compactINR} />
              <YAxis yAxisId="margin" orientation="right" domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-brand-accent-soft)' }} formatter={(v, key) => (key === 'gopMargin' ? [`${Number(v).toFixed(1)}%`, 'GOP margin'] : [`₹${Math.round(v).toLocaleString('en-IN')}`, key === 'room' ? 'Room' : key === 'fnb' ? 'F&B' : 'Other'])} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-text-muted)' }} />
              <Bar yAxisId="rev" dataKey="room" name="Room" stackId="rev" fill="var(--color-brand-accent)" maxBarSize={26} {...chartAnim} animationDuration={700} animationEasing="ease-out" />
              <Bar yAxisId="rev" dataKey="fnb" name="F&B" stackId="rev" fill="var(--color-brand-premium)" maxBarSize={26} {...chartAnim} animationDuration={700} animationEasing="ease-out" />
              <Bar yAxisId="rev" dataKey="other" name="Other" stackId="rev" fill="var(--color-text-muted)" radius={[3, 3, 0, 0]} maxBarSize={26} {...chartAnim} animationDuration={700} animationEasing="ease-out" />
              <Line yAxisId="margin" type="monotone" dataKey="gopMargin" name="GOP margin" stroke="var(--color-data-positive)" strokeWidth={2} dot={false} {...chartAnim} animationDuration={700} animationEasing="ease-out" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
