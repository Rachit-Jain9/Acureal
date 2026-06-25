// Joint-Venture profit waterfall panel.
// Maths in `src/utils/waterfall.js#calculateJVWaterfall`.

import { useEffect, useMemo, useState } from 'react';
import { Users, ChevronRight } from 'lucide-react';
import { calculateJVWaterfall } from '../../utils/waterfall';
import Badge from '../common/Badge';
import { StatTile } from '../../design-system';

export default function JVWaterfallPanel({ financials, deal }) {
  const mp = financials;
  const [open, setOpen] = useState(
    deal?.deal_structure === 'jv' || deal?.deal_structure === 'profit_share'
  );

  const [inputs, setInputs] = useState(() => ({
    landownerEquityCr: mp?.costs?.land ?? '',
    developerEquityCr: '',
    preferredReturnPct: 8,
    preferredReturnType: 'compound',
    holdPeriodYears: 3,
    developerPromotePct: 20,
    promoteThresholdMultiple: 1.5,
    useCatchUp: false,
    totalRevenueCr: mp?.revenue?.totalRevenue ?? '',
    totalCostCr: mp?.costs?.total ?? '',
  }));

  useEffect(() => {
    if (!mp) return;
    setInputs((prev) => ({
      ...prev,
      landownerEquityCr: prev.landownerEquityCr || mp.costs?.land || '',
      totalRevenueCr: prev.totalRevenueCr || mp.revenue?.totalRevenue || '',
      totalCostCr: prev.totalCostCr || mp.costs?.total || '',
    }));
  }, [mp]);

  const set = (k, v) => setInputs((p) => ({ ...p, [k]: v }));
  const num = (v) => (v === '' ? 0 : Number(v) || 0);

  const result = useMemo(
    () =>
      calculateJVWaterfall({
        totalRevenueCr: num(inputs.totalRevenueCr),
        totalCostCr: num(inputs.totalCostCr),
        landownerEquityCr: num(inputs.landownerEquityCr),
        developerEquityCr: num(inputs.developerEquityCr),
        preferredReturnPct: num(inputs.preferredReturnPct),
        preferredReturnType: inputs.preferredReturnType || 'compound',
        holdPeriodYears: num(inputs.holdPeriodYears),
        developerPromotePct: num(inputs.developerPromotePct),
        promoteThresholdMultiple: num(inputs.promoteThresholdMultiple),
        useCatchUp: !!inputs.useCatchUp,
      }),
    [inputs]
  );

  const fmtCr = (v) => (v != null ? `₹${v.toFixed(2)} Cr` : '—');

  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <Users size={16} className="text-accent" />
          <span className="text-sm font-semibold text-content-primary">Joint Venture Profit Waterfall</span>
          {deal?.deal_structure && ['jv', 'profit_share'].includes(deal.deal_structure) && (
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
          <div>
            <h4 className="text-xs font-semibold text-content-secondary uppercase tracking-wider mb-3">
              Equity Structure
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Landowner Equity (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.landownerEquityCr}
                  onChange={(e) => set('landownerEquityCr', e.target.value)}
                  className="input w-full" placeholder="Land value" />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Developer Equity (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.developerEquityCr}
                  onChange={(e) => set('developerEquityCr', e.target.value)}
                  className="input w-full" placeholder="Cash contribution" />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Total Revenue (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.totalRevenueCr}
                  onChange={(e) => set('totalRevenueCr', e.target.value)}
                  className="input w-full" placeholder="Auto from DCF" />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Total Cost (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.totalCostCr}
                  onChange={(e) => set('totalCostCr', e.target.value)}
                  className="input w-full" placeholder="Auto from DCF" />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-content-secondary uppercase tracking-wider mb-3">
              Waterfall Terms
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Preferred Return (% pa)</label>
                <input type="number" step="0.5" value={inputs.preferredReturnPct}
                  onChange={(e) => set('preferredReturnPct', e.target.value)}
                  className="input w-full" placeholder="8" />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Hold Period (years)</label>
                <input type="number" step="0.5" value={inputs.holdPeriodYears}
                  onChange={(e) => set('holdPeriodYears', e.target.value)}
                  className="input w-full" placeholder="3" />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Developer Promote (%)</label>
                <input type="number" step="5" value={inputs.developerPromotePct}
                  onChange={(e) => set('developerPromotePct', e.target.value)}
                  className="input w-full" placeholder="20" />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Promote Threshold (x EM)</label>
                <input type="number" step="0.1" value={inputs.promoteThresholdMultiple}
                  onChange={(e) => set('promoteThresholdMultiple', e.target.value)}
                  className="input w-full" placeholder="1.5" />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary mb-1 block">Pref Return Compounding</label>
                <select
                  value={inputs.preferredReturnType || 'compound'}
                  onChange={(e) => set('preferredReturnType', e.target.value)}
                  className="input w-full"
                >
                  <option value="compound">Compound (institutional std)</option>
                  <option value="simple">Simple</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  id="jv-useCatchUp"
                  type="checkbox"
                  checked={!!inputs.useCatchUp}
                  onChange={(e) => set('useCatchUp', e.target.checked)}
                  className="rounded border-hairline-strong"
                />
                <label htmlFor="jv-useCatchUp" className="text-xs font-medium text-content-secondary">
                  GP Catch-Up tranche
                </label>
              </div>
            </div>
          </div>

          {result ? (
            <>
              <div className="flex items-center gap-3 text-sm text-content-secondary bg-bg-secondary rounded-lg px-4 py-2.5">
                <span className="font-medium text-content-primary">Equity Split:</span>
                <span className="text-accent font-semibold">
                  Landowner {result.landownerEquityPct?.toFixed(1)}%
                </span>
                <span className="text-content-muted">/</span>
                <span className="text-data-highlight font-semibold">
                  Developer {result.developerEquityPct?.toFixed(1)}%
                </span>
                <span className="ml-auto text-content-secondary">
                  Total equity: ₹{result.totalEquityCr?.toFixed(2)} Cr
                </span>
                {result.promoteTriggered && <Badge tone="warn">Promote triggered</Badge>}
                {result.catchUpTriggered && <Badge tone="success">GP catch-up</Badge>}
                {result.preferredReturnType && <Badge>Pref: {result.preferredReturnType}</Badge>}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-content-secondary uppercase tracking-wider mb-2">
                  Profit Distribution Waterfall
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-bg-secondary">
                        <th className="text-left px-3 py-2 font-medium text-content-secondary border-b">Tranche</th>
                        <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Landowner</th>
                        <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Developer</th>
                        <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Total</th>
                        <th className="text-left px-3 py-2 font-medium text-content-secondary border-b">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.waterfall.map((row, i) => (
                        <tr key={i} className={`border-b last:border-0 hover:bg-bg-secondary transition-colors ${!row.fromProfit ? 'bg-blue-50/40' : ''}`}>
                          <td className="px-3 py-2.5 font-medium text-content-primary">{row.tranche}</td>
                          <td className="px-3 py-2.5 text-right text-accent">{fmtCr(row.landownerCr)}</td>
                          <td className="px-3 py-2.5 text-right text-data-highlight">{fmtCr(row.developerCr)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-content-primary">{fmtCr(row.totalCr)}</td>
                          <td className="px-3 py-2.5 text-xs text-content-muted">{row.note}</td>
                        </tr>
                      ))}
                      <tr className="bg-bg-secondary font-semibold border-t-2 border-hairline-strong">
                        <td className="px-3 py-2.5 text-content-secondary">Total Distribution</td>
                        <td className="px-3 py-2.5 text-right text-accent">{fmtCr(result.summary.landownerTotal)}</td>
                        <td className="px-3 py-2.5 text-right text-data-highlight">{fmtCr(result.summary.developerTotal)}</td>
                        <td className="px-3 py-2.5 text-right text-content-primary">
                          {fmtCr((result.summary.landownerTotal || 0) + (result.summary.developerTotal || 0))}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile
                  label="Landowner Profit"
                  value={fmtCr(result.summary.landownerProfit)}
                  footnote="After capital return"
                />
                <StatTile
                  label="Developer Profit"
                  value={fmtCr(result.summary.developerProfit)}
                  footnote="Incl. promote"
                />
                <StatTile
                  label="Landowner Multiple"
                  value={result.summary.landownerMultiple != null ? `${result.summary.landownerMultiple.toFixed(2)}x` : '—'}
                  footnote="On land contribution"
                />
                <StatTile
                  label="Developer Multiple"
                  value={result.summary.developerMultiple != null ? `${result.summary.developerMultiple.toFixed(2)}x` : '—'}
                  footnote="On cash contribution"
                />
              </div>

              <p className="text-xs text-content-muted">
                JV model: Landowner equity = land at agreed valuation. Developer equity = cash contribution.
                Preferred return accrues on total equity at {inputs.preferredReturnPct}% pa over{' '}
                {inputs.holdPeriodYears} years before residual profit sharing.
                {result.promoteTriggered
                  ? ` Developer promote of ${inputs.developerPromotePct}% triggered at ${inputs.promoteThresholdMultiple}x equity multiple.`
                  : ` Promote threshold (${inputs.promoteThresholdMultiple}x) not reached — no promote.`}
              </p>
            </>
          ) : (
            <p className="text-sm text-content-muted text-center py-6">
              Enter equity contributions, total revenue, and total cost to see the waterfall.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
