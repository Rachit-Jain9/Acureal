import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { Card } from '../../design-system';
import { INCOME_CLASSES, getModelAssetClass } from './fieldDefs';
import { formatCrores } from '../../utils/format';
import { useChartAnim } from '../../hooks/useChartAnim';

export default function CashFlowChart({ cashFlows, yearlyCashFlows, assetClass }) {
  const [view, setView] = useState('quarterly');
  const chartAnim = useChartAnim();
  if (!cashFlows || cashFlows.length === 0) return null;
  const isIncome = INCOME_CLASSES.has(getModelAssetClass(assetClass));

  const quarterlyData = cashFlows.map((cf) => ({ name: `Q${cf.quarter}`, value: cf.value }));
  const yearlyData    = (yearlyCashFlows || []).map((cf) => ({ name: cf.label, value: cf.value }));
  const data          = view === 'yearly' ? yearlyData : quarterlyData;

  return (
    <Card elevated className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-content-primary flex items-center gap-2">
          <BarChart3 size={16} className="text-accent" />
          Cash Flows
        </h3>
        {/* PR-NX65 (2026-05-19) — proper interaction states per
            FRONTEND_GUIDELINES §3: every interactive element needs default
            + hover + focus-visible + active. Pre-NX65 the toggle buttons
            had only the hover state. Added focus ring + active scale-down
            for keyboard / tactile feedback. */}
        <div className="flex rounded-lg border border-hairline overflow-hidden text-xs font-medium">
          <button
            type="button"
            onClick={() => setView('quarterly')}
            className={`px-3 py-1.5 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] ${view === 'quarterly' ? 'bg-accent text-white' : 'bg-bg-elevated text-content-secondary hover:bg-surface'}`}
            aria-pressed={view === 'quarterly'}
          >
            Quarterly
          </button>
          <button
            type="button"
            onClick={() => setView('yearly')}
            className={`px-3 py-1.5 transition-colors duration-150 ease-out border-l border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] ${view === 'yearly' ? 'bg-accent text-white' : 'bg-bg-elevated text-content-secondary hover:bg-surface'}`}
            aria-pressed={view === 'yearly'}
          >
            Yearly
          </button>
        </div>
      </div>
      <div className="h-72" role="img" aria-label={`Cash flow bar chart, ${view} view, ${data.length} periods`}>
        <ResponsiveContainer width="100%" height="100%">
          {/* PR-NX65 — chart polish matching DashboardWidgets conventions:
              - grid stroke uses CSS var with 50% opacity (was hardcoded #f0f0f0
                which is invisible in dark theme)
              - axis ticks use CSS var for text-muted (was inheriting default)
              - reference line uses CSS var (was hardcoded #94a3b8)
              - bar fills use CSS vars for data-positive/negative (was
                hardcoded #22c55e / #ef4444)
              - tooltip mirrors the dashboard tooltipStyle (uses bg-elevated
                + border + shadow + tabular-nums) for cross-page consistency
              - first-render draw-in tuned to 700ms ease-out per §2 timing table */}
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" strokeOpacity={0.5} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={{ stroke: 'var(--color-border-primary)' }} tickLine={false} interval={view === 'quarterly' && !isIncome ? 1 : 0} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(0)} Cr`} />
            <Tooltip
              formatter={(v) => [formatCrores(v), 'Net Cash Flow']}
              contentStyle={{
                borderRadius: '8px',
                border: '1px solid var(--color-border-primary)',
                backgroundColor: 'var(--color-bg-elevated)',
                color: 'var(--color-text-primary)',
                fontSize: '12px',
                fontFeatureSettings: '"tnum"',
                boxShadow: 'var(--shadow-elevated)',
                padding: '8px 10px',
              }}
              cursor={{ fill: 'var(--color-brand-accent-soft)' }}
            />
            <ReferenceLine y={0} stroke="var(--color-border-strong)" strokeOpacity={0.7} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} {...chartAnim} animationDuration={700} animationEasing="ease-out">
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.value >= 0 ? 'var(--color-data-positive)' : 'var(--color-data-negative)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {view === 'yearly' && yearlyData.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-content-muted border-t border-hairline pt-3">
          {yearlyData.map((y) => (
            <span key={y.name} className={`font-medium ${y.value >= 0 ? 'text-data-positive' : 'text-data-negative'}`}>
              {y.name}: {formatCrores(y.value)}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
