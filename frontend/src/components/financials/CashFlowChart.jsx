import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { Card } from '../../design-system';
import { INCOME_CLASSES, getModelAssetClass } from './fieldDefs';
import { formatCrores } from '../../utils/format';

export default function CashFlowChart({ cashFlows, yearlyCashFlows, assetClass }) {
  const [view, setView] = useState('quarterly');
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
        <div className="flex rounded-lg border border-hairline overflow-hidden text-xs font-medium">
          <button
            type="button"
            onClick={() => setView('quarterly')}
            className={`px-3 py-1.5 transition-colors ${view === 'quarterly' ? 'bg-accent text-white' : 'bg-bg-elevated text-content-secondary hover:bg-surface'}`}
          >
            Quarterly
          </button>
          <button
            type="button"
            onClick={() => setView('yearly')}
            className={`px-3 py-1.5 transition-colors border-l border-hairline ${view === 'yearly' ? 'bg-accent text-white' : 'bg-bg-elevated text-content-secondary hover:bg-surface'}`}
          >
            Yearly
          </button>
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={view === 'quarterly' && !isIncome ? 1 : 0} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)} Cr`} />
            <Tooltip formatter={(v) => [formatCrores(v), 'Net Cash Flow']} contentStyle={{ borderRadius: '8px', fontSize: '13px' }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {data.map((entry, i) => <Cell key={i} fill={entry.value >= 0 ? '#22c55e' : '#ef4444'} />)}
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
