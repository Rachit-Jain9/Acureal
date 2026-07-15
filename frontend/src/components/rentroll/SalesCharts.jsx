import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { useChartAnim } from '../../hooks/useChartAnim';

// Shape-B data visuals: the collections funnel (contracted → collected →
// outstanding → overdue) and the receivables aging profile. Recharts, lazy-
// loaded by the tab; CSS-var colours so both themes read correctly; draw-in on
// first render (collapses under prefers-reduced-motion). Default to flat.

const compactINR = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
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

export default function SalesCharts({ metrics }) {
  const chartAnim = useChartAnim();
  const c = metrics?.collections;
  if (!c) return null;

  // Funnel: contracted GDV steps down to what is actually in hand, with the
  // overdue slice broken out as the at-risk tail. Honest, not decorative.
  const funnel = [
    { name: 'Sold GDV', value: c.soldGDV, tone: 'accent' },
    { name: 'Collected', value: c.collected, tone: 'positive' },
    { name: 'Receivable', value: c.receivable, tone: 'neutral' },
    { name: 'Overdue', value: c.overdue, tone: 'negative' },
  ];
  const toneColor = {
    accent: 'var(--color-brand-accent)',
    positive: 'var(--color-data-positive)',
    neutral: 'var(--color-text-muted)',
    negative: 'var(--color-data-negative)',
  };

  const agingBuckets = metrics?.aging?.buckets || [];
  const hasAging = metrics?.aging?.hasMilestoneData;
  const unaged = metrics?.aging?.unaged || 0;
  const agingData = hasAging
    ? agingBuckets.map((b) => ({ name: `${b.bucket}d`, value: b.amount }))
    : (unaged > 0 ? [{ name: 'Overdue', value: unaged }] : []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="bg-bg-elevated border border-hairline rounded-editorial p-4 shadow-editorial">
        <h4 className="text-eyebrow uppercase tracking-[0.06em] text-content-muted font-medium mb-3">Collections funnel</h4>
        <div className="h-56" role="img" aria-label="Collections funnel: sold GDV, collected, receivable, overdue">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border-primary)" strokeOpacity={0.5} />
              <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compactINR} />
              <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: 'var(--color-border-primary)' }} tickLine={false} width={78} />
              <Tooltip formatter={(v) => [compactINR(v), '']} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-brand-accent-soft)' }} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} {...chartAnim} animationDuration={700} animationEasing="ease-out">
                {funnel.map((entry) => <Cell key={entry.name} fill={toneColor[entry.tone]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-bg-elevated border border-hairline rounded-editorial p-4 shadow-editorial">
        <h4 className="text-eyebrow uppercase tracking-[0.06em] text-content-muted font-medium mb-3">
          Receivables aging{!hasAging && agingData.length > 0 ? ' (unaged)' : ''}
        </h4>
        {agingData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-content-muted">
            No overdue receivables recorded.
          </div>
        ) : (
          <div className="h-56" role="img" aria-label="Receivables aging by days overdue">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" strokeOpacity={0.5} />
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: 'var(--color-border-primary)' }} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compactINR} />
                <Tooltip formatter={(v) => [compactINR(v), 'Outstanding']} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-brand-accent-soft)' }} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} {...chartAnim} animationDuration={700} animationEasing="ease-out">
                  {agingData.map((entry) => (
                    <Cell key={entry.name} fill={entry.name === '90+d' || entry.name === 'Overdue' ? 'var(--color-data-negative)' : 'var(--color-brand-accent)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
