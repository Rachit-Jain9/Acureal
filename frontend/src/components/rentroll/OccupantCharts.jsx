import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { useChartAnim } from '../../hooks/useChartAnim';

// Redevelopment-occupant visuals: the rehousing-obligation breakdown (where the
// clearance cost sits) and the rehab-area build-up (existing carpet → free
// entitlement → additional). Recharts, lazy-loaded by the tab; CSS-var colours
// so both themes read correctly; draw-in on first render (collapses under
// prefers-reduced-motion). Single-series bars — flat by default.

const compactINR = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

const compactSqft = (v) => `${Math.round(Number(v) || 0).toLocaleString('en-IN')} sqft`;

// Pure tooltip formatters — exported and unit-tested (OccupantCharts.test.js).
// These are single-series charts, so the formatter only shapes the VALUE; it
// never has to branch on a Recharts series name (the trap that bit the hotel
// charts twice). Keeping them pure makes that contract explicit and testable.
export const formatObligationTooltip = (value) => [compactINR(value), ''];
export const formatAreaTooltip = (value) => [compactSqft(value), ''];

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

const OBLIGATION_TONE = {
  'Transit rent (remaining)': 'var(--color-brand-accent)',
  Corpus: 'var(--color-data-positive)',
  Brokerage: 'var(--color-text-muted)',
  Shifting: 'var(--color-text-muted)',
  Other: 'var(--color-text-muted)',
};

export default function OccupantCharts({ metrics }) {
  const chartAnim = useChartAnim();
  const obligations = metrics?.obligations;
  const entitlement = metrics?.entitlement;
  if (!obligations || !entitlement) return null;

  const obligationData = (obligations.byType || []).filter((b) => b.amount > 0);

  const areaData = [
    { name: 'Existing carpet', value: entitlement.existingCarpetSqft || 0 },
    { name: 'Rehab entitlement', value: entitlement.rehabEntitlementSqft || 0 },
    { name: 'Additional', value: entitlement.additionalAreaSqft || 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="bg-bg-elevated border border-hairline rounded-editorial p-4 shadow-editorial">
        <h4 className="text-eyebrow uppercase tracking-[0.06em] text-content-muted font-medium mb-3">
          Rehousing obligation breakdown
        </h4>
        {obligationData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-content-muted">
            No rehousing obligations recorded yet.
          </div>
        ) : (
          <div className="h-56" role="img" aria-label="Rehousing obligation by type">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={obligationData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border-primary)" strokeOpacity={0.5} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compactINR} />
                <YAxis type="category" dataKey="type" tick={AXIS_TICK} axisLine={{ stroke: 'var(--color-border-primary)' }} tickLine={false} width={110} />
                <Tooltip formatter={formatObligationTooltip} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-brand-accent-soft)' }} />
                <Bar dataKey="amount" radius={[0, 3, 3, 0]} {...chartAnim} animationDuration={700} animationEasing="ease-out">
                  {obligationData.map((entry) => (
                    <Cell key={entry.type} fill={OBLIGATION_TONE[entry.type] || 'var(--color-text-muted)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-bg-elevated border border-hairline rounded-editorial p-4 shadow-editorial">
        <h4 className="text-eyebrow uppercase tracking-[0.06em] text-content-muted font-medium mb-3">
          Rehab area build-up
        </h4>
        {areaData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-content-muted">
            No occupier areas recorded yet.
          </div>
        ) : (
          <div className="h-56" role="img" aria-label="Existing carpet, rehab entitlement, and additional area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={areaData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" strokeOpacity={0.5} />
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: 'var(--color-border-primary)' }} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `${(Number(v) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}k`} />
                <Tooltip formatter={formatAreaTooltip} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-brand-accent-soft)' }} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} {...chartAnim} animationDuration={700} animationEasing="ease-out">
                  {areaData.map((entry) => (
                    <Cell key={entry.name} fill={entry.name === 'Existing carpet' ? 'var(--color-text-muted)' : 'var(--color-brand-accent)'} />
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
