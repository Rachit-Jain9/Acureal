// JDA / Development Agreement waterfall panel.
// Maths in `src/utils/waterfall.js#calculateJDAWaterfall`.

import { useEffect, useMemo, useState } from 'react';
import { GitFork, ChevronRight } from 'lucide-react';
import { calculateJDAWaterfall } from '../../utils/waterfall';
import Badge from '../common/Badge';
import { StatTile } from '../../design-system';
import WaterfallBridge, { jdaSegments } from './WaterfallBridge';

const JDA_STRUCTURE_LABELS = {
  area_share: 'Area Share',
  revenue_share: 'Revenue Share',
};

export default function JDAWaterfallPanel({ financials, deal }) {
  const mp = financials;
  const [open, setOpen] = useState(
    deal?.deal_structure === 'jda' ||
    deal?.deal_structure === 'area_share' ||
    deal?.deal_structure === 'revenue_share'
  );

  const [inputs, setInputs] = useState(() => ({
    landownerSharePct: 40,
    structureType: deal?.deal_structure === 'revenue_share' ? 'revenue_share' : 'area_share',
    totalRevenueCr: mp?.revenue?.totalRevenue ?? '',
    totalConstructionCostCr: mp?.costs?.construction ?? '',
    approvalCostCr: mp?.costs?.approval ?? '',
    marketingCostCr: mp?.costs?.marketing ?? '',
    financeCostCr: mp?.costs?.finance ?? '',
    landCostCr: mp?.costs?.land ?? '',
  }));

  useEffect(() => {
    if (!mp) return;
    setInputs((prev) => ({
      ...prev,
      totalRevenueCr: mp.revenue?.totalRevenue ?? prev.totalRevenueCr,
      totalConstructionCostCr: mp.costs?.construction ?? prev.totalConstructionCostCr,
      approvalCostCr: mp.costs?.approval ?? prev.approvalCostCr,
      marketingCostCr: mp.costs?.marketing ?? prev.marketingCostCr,
      financeCostCr: mp.costs?.finance ?? prev.financeCostCr,
      landCostCr: mp.costs?.land ?? prev.landCostCr,
    }));
  }, [mp]);

  const set = (k, v) => setInputs((p) => ({ ...p, [k]: v }));
  const num = (v) => (v === '' ? 0 : Number(v) || 0);

  const result = useMemo(
    () =>
      calculateJDAWaterfall({
        totalRevenueCr: num(inputs.totalRevenueCr),
        totalConstructionCostCr: num(inputs.totalConstructionCostCr),
        approvalCostCr: num(inputs.approvalCostCr),
        marketingCostCr: num(inputs.marketingCostCr),
        financeCostCr: num(inputs.financeCostCr),
        landCostCr: num(inputs.landCostCr),
        landownerSharePct: num(inputs.landownerSharePct),
        structureType: inputs.structureType,
      }),
    [inputs]
  );

  const jdaSegs = useMemo(() => jdaSegments(result), [result]);

  const fmtCr = (v) => (v != null ? `₹${v.toFixed(2)} Cr` : '—');
  const fmtPct = (v) => (v != null ? `${v.toFixed(1)}%` : '—');

  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <GitFork size={16} className="text-accent" />
          <span className="text-sm font-semibold text-content-primary">JDA / Development Agreement Waterfall</span>
          {deal?.deal_structure && ['jda', 'area_share', 'revenue_share'].includes(deal.deal_structure) && (
            <Badge tone="info">Active structure</Badge>
          )}
        </div>
        <ChevronRight
          size={16}
          className={`text-content-muted transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-hairline p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-content-secondary mb-1 block">Structure Type</label>
              <select
                value={inputs.structureType}
                onChange={(e) => set('structureType', e.target.value)}
                className="input w-full text-sm"
              >
                {Object.entries(JDA_STRUCTURE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary mb-1 block">Landowner Share (%)</label>
              <input
                type="number" step="1" min="0" max="100"
                value={inputs.landownerSharePct}
                onChange={(e) => set('landownerSharePct', e.target.value)}
                className="input w-full"
                placeholder="40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary mb-1 block">Total Revenue (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.totalRevenueCr}
                onChange={(e) => set('totalRevenueCr', e.target.value)}
                className="input w-full"
                placeholder="Auto from DCF"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary mb-1 block">Construction Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.totalConstructionCostCr}
                onChange={(e) => set('totalConstructionCostCr', e.target.value)}
                className="input w-full"
                placeholder="Auto from DCF"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary mb-1 block">Approval Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.approvalCostCr}
                onChange={(e) => set('approvalCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary mb-1 block">Marketing Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.marketingCostCr}
                onChange={(e) => set('marketingCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary mb-1 block">Finance Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.financeCostCr}
                onChange={(e) => set('financeCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary mb-1 block">Land Payment (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.landCostCr}
                onChange={(e) => set('landCostCr', e.target.value)}
                className="input w-full"
                placeholder="0 (JDA — no upfront)"
              />
            </div>
          </div>

          {result ? (
            <>
              <div>
                <h4 className="text-xs font-semibold text-content-secondary uppercase tracking-wider mb-2">
                  Distribution Waterfall
                </h4>
                {jdaSegs.length > 0 && (
                  <div className="bg-bg-secondary/40 border border-hairline rounded-lg px-4 pt-4 pb-3 mb-3">
                    <WaterfallBridge segments={jdaSegs} fmtCr={fmtCr} />
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-bg-secondary">
                        <th className="text-left px-3 py-2 font-medium text-content-secondary border-b">Party</th>
                        <th className="text-left px-3 py-2 font-medium text-content-secondary border-b">Allocation</th>
                        <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Gross Revenue</th>
                        <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Dev. Costs</th>
                        <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Net Proceeds</th>
                        <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Net Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.waterfall.map((row, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-bg-secondary transition-colors">
                          <td className="px-3 py-2.5 font-medium text-content-primary">{row.party}</td>
                          <td className="px-3 py-2.5 text-content-secondary">{row.label}</td>
                          <td className="px-3 py-2.5 text-right text-content-primary">{fmtCr(row.grossCr)}</td>
                          <td className="px-3 py-2.5 text-right text-data-negative">
                            {row.costCr > 0 ? `(${fmtCr(row.costCr)})` : '—'}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${row.netCr != null && row.netCr >= 0 ? 'text-data-positive' : 'text-data-negative'}`}>
                            {fmtCr(row.netCr)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-content-secondary">
                            {row.marginPct != null ? fmtPct(row.marginPct) : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-bg-secondary font-semibold">
                        <td colSpan={2} className="px-3 py-2.5 text-content-secondary">Project Total</td>
                        <td className="px-3 py-2.5 text-right">{fmtCr(result.summary.totalRevenueCr)}</td>
                        <td className="px-3 py-2.5 text-right text-data-negative">({fmtCr(result.summary.devCostCr)})</td>
                        <td className="px-3 py-2.5 text-right text-data-positive">{fmtCr(result.summary.projectProfitCr)}</td>
                        <td className="px-3 py-2.5 text-right">{fmtPct(result.summary.projectMarginPct)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <StatTile
                  label={`Landowner Net (${result.landownerSharePct}%)`}
                  value={fmtCr(result.summary.landownerNetCr)}
                  footnote="Implicit land value"
                />
                <StatTile
                  label={`Developer Net (${result.developerSharePct}%)`}
                  value={fmtCr(result.summary.developerNetCr)}
                  footnote="After all costs"
                  negative={result.summary.developerNetCr != null && result.summary.developerNetCr < 0}
                />
                <StatTile
                  label="Developer Margin"
                  value={fmtPct(result.summary.developerMarginPct)}
                  footnote="On developer revenue"
                />
                <StatTile
                  label="Project Margin"
                  value={fmtPct(result.summary.projectMarginPct)}
                  footnote="On total revenue"
                />
              </div>

              <p className="text-xs text-content-muted">
                JDA model: Landowner contributes land (no cash cost); Developer bears 100% of construction,
                approval, marketing, and finance costs. Sharing basis:{' '}
                {inputs.structureType === 'revenue_share' ? 'Revenue share on total project revenue' : 'Area share — proportional unit/plot allocation'}.
              </p>
            </>
          ) : (
            <p className="text-sm text-content-muted text-center py-6">
              Enter a Landowner Share % and Total Revenue to see the distribution.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
