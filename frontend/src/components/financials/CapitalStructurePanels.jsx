// Capital-structure panels — JDA / JV waterfalls + construction/operating debt
// schedule. Extracted from FinancialsPage.jsx so the monolithic page can focus
// on orchestration and each panel can evolve (and be tested) independently.
//
// Maths lives in `src/utils/waterfall.js` (client-side) and the kernel post-
// process (`packages/financial-kernel/src/postprocess/debtSchedule.ts`). These
// components are presentation-only — they read `financials` / `deal` and
// render the resulting tables and KPI tiles.

import { useEffect, useMemo, useState } from 'react';
import { GitFork, Users, Layers, ChevronRight } from 'lucide-react';
import {
  calculateJDAWaterfall,
  calculateJVWaterfall,
  buildDebtSchedule,
} from '../../utils/waterfall';

// ─── JDA WATERFALL PANEL ──────────────────────────────────────────────────

const JDA_STRUCTURE_LABELS = {
  area_share: 'Area Share',
  revenue_share: 'Revenue Share',
};

export function JDAWaterfallPanel({ financials, deal }) {
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

  // Sync from financial results when they arrive
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

  const fmtCr = (v) => (v != null ? `₹${v.toFixed(2)} Cr` : '—');
  const fmtPct = (v) => (v != null ? `${v.toFixed(1)}%` : '—');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <GitFork size={16} className="text-primary-600" />
          <span className="text-sm font-semibold text-gray-900">JDA / Development Agreement Waterfall</span>
          {deal?.deal_structure && ['jda', 'area_share', 'revenue_share'].includes(deal.deal_structure) && (
            <span className="text-xs bg-primary-50 text-primary-700 border border-primary-200 rounded px-2 py-0.5">
              Active structure
            </span>
          )}
        </div>
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-5">
          {/* Inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Structure Type</label>
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
              <label className="text-xs font-medium text-gray-600 mb-1 block">Landowner Share (%)</label>
              <input
                type="number" step="1" min="0" max="100"
                value={inputs.landownerSharePct}
                onChange={(e) => set('landownerSharePct', e.target.value)}
                className="input w-full"
                placeholder="40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Total Revenue (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.totalRevenueCr}
                onChange={(e) => set('totalRevenueCr', e.target.value)}
                className="input w-full"
                placeholder="Auto from DCF"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Construction Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.totalConstructionCostCr}
                onChange={(e) => set('totalConstructionCostCr', e.target.value)}
                className="input w-full"
                placeholder="Auto from DCF"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Approval Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.approvalCostCr}
                onChange={(e) => set('approvalCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Marketing Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.marketingCostCr}
                onChange={(e) => set('marketingCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Finance Cost (₹ Cr)</label>
              <input
                type="number" step="0.01"
                value={inputs.financeCostCr}
                onChange={(e) => set('financeCostCr', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Land Payment (₹ Cr)</label>
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
              {/* Waterfall table */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Distribution Waterfall
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Party</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Allocation</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Gross Revenue</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Dev. Costs</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Net Proceeds</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Net Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.waterfall.map((row, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2.5 font-medium text-gray-800">{row.party}</td>
                          <td className="px-3 py-2.5 text-gray-600">{row.label}</td>
                          <td className="px-3 py-2.5 text-right text-gray-800">{fmtCr(row.grossCr)}</td>
                          <td className="px-3 py-2.5 text-right text-red-600">
                            {row.costCr > 0 ? `(${fmtCr(row.costCr)})` : '—'}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${row.netCr != null && row.netCr >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {fmtCr(row.netCr)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-500">
                            {row.marginPct != null ? fmtPct(row.marginPct) : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td colSpan={2} className="px-3 py-2.5 text-gray-700">Project Total</td>
                        <td className="px-3 py-2.5 text-right">{fmtCr(result.summary.totalRevenueCr)}</td>
                        <td className="px-3 py-2.5 text-right text-red-600">({fmtCr(result.summary.devCostCr)})</td>
                        <td className="px-3 py-2.5 text-right text-green-700">{fmtCr(result.summary.projectProfitCr)}</td>
                        <td className="px-3 py-2.5 text-right">{fmtPct(result.summary.projectMarginPct)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-500 mb-0.5">Landowner Net ({result.landownerSharePct}%)</p>
                  <p className="text-base font-bold text-blue-800">{fmtCr(result.summary.landownerNetCr)}</p>
                  <p className="text-xs text-blue-400 mt-0.5">Implicit land value</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className="text-xs text-indigo-500 mb-0.5">Developer Net ({result.developerSharePct}%)</p>
                  <p className={`text-base font-bold ${result.summary.developerNetCr != null && result.summary.developerNetCr >= 0 ? 'text-indigo-800' : 'text-red-700'}`}>
                    {fmtCr(result.summary.developerNetCr)}
                  </p>
                  <p className="text-xs text-indigo-400 mt-0.5">After all costs</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3">
                  <p className="text-xs text-emerald-500 mb-0.5">Developer Margin</p>
                  <p className="text-base font-bold text-emerald-800">{fmtPct(result.summary.developerMarginPct)}</p>
                  <p className="text-xs text-emerald-400 mt-0.5">On developer revenue</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Project Margin</p>
                  <p className="text-base font-bold text-gray-800">{fmtPct(result.summary.projectMarginPct)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">On total revenue</p>
                </div>
              </div>

              <p className="text-xs text-gray-400">
                JDA model: Landowner contributes land (no cash cost); Developer bears 100% of construction,
                approval, marketing, and finance costs. Sharing basis:{' '}
                {inputs.structureType === 'revenue_share' ? 'Revenue share on total project revenue' : 'Area share — proportional unit/plot allocation'}.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">
              Enter a Landowner Share % and Total Revenue to see the distribution.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── JV WATERFALL PANEL ───────────────────────────────────────────────────

export function JVWaterfallPanel({ financials, deal }) {
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <Users size={16} className="text-primary-600" />
          <span className="text-sm font-semibold text-gray-900">Joint Venture Profit Waterfall</span>
          {deal?.deal_structure && ['jv', 'profit_share'].includes(deal.deal_structure) && (
            <span className="text-xs bg-primary-50 text-primary-700 border border-primary-200 rounded px-2 py-0.5">
              Active structure
            </span>
          )}
        </div>
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-5">
          {/* Equity structure inputs */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Equity Structure
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Landowner Equity (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.landownerEquityCr}
                  onChange={(e) => set('landownerEquityCr', e.target.value)}
                  className="input w-full" placeholder="Land value" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Developer Equity (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.developerEquityCr}
                  onChange={(e) => set('developerEquityCr', e.target.value)}
                  className="input w-full" placeholder="Cash contribution" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Total Revenue (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.totalRevenueCr}
                  onChange={(e) => set('totalRevenueCr', e.target.value)}
                  className="input w-full" placeholder="Auto from DCF" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Total Cost (₹ Cr)</label>
                <input type="number" step="0.01" value={inputs.totalCostCr}
                  onChange={(e) => set('totalCostCr', e.target.value)}
                  className="input w-full" placeholder="Auto from DCF" />
              </div>
            </div>
          </div>

          {/* Waterfall terms */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Waterfall Terms
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Preferred Return (% pa)</label>
                <input type="number" step="0.5" value={inputs.preferredReturnPct}
                  onChange={(e) => set('preferredReturnPct', e.target.value)}
                  className="input w-full" placeholder="8" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Hold Period (years)</label>
                <input type="number" step="0.5" value={inputs.holdPeriodYears}
                  onChange={(e) => set('holdPeriodYears', e.target.value)}
                  className="input w-full" placeholder="3" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Developer Promote (%)</label>
                <input type="number" step="5" value={inputs.developerPromotePct}
                  onChange={(e) => set('developerPromotePct', e.target.value)}
                  className="input w-full" placeholder="20" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Promote Threshold (x EM)</label>
                <input type="number" step="0.1" value={inputs.promoteThresholdMultiple}
                  onChange={(e) => set('promoteThresholdMultiple', e.target.value)}
                  className="input w-full" placeholder="1.5" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Pref Return Compounding</label>
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
                  className="rounded border-gray-300"
                />
                <label htmlFor="jv-useCatchUp" className="text-xs font-medium text-gray-600">
                  GP Catch-Up tranche
                </label>
              </div>
            </div>
          </div>

          {result ? (
            <>
              {/* Equity split header */}
              <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-2.5">
                <span className="font-medium text-gray-800">Equity Split:</span>
                <span className="text-blue-700 font-semibold">
                  Landowner {result.landownerEquityPct?.toFixed(1)}%
                </span>
                <span className="text-gray-400">/</span>
                <span className="text-indigo-700 font-semibold">
                  Developer {result.developerEquityPct?.toFixed(1)}%
                </span>
                <span className="ml-auto text-gray-500">
                  Total equity: ₹{result.totalEquityCr?.toFixed(2)} Cr
                </span>
                {result.promoteTriggered && (
                  <span className="text-amber-700 bg-amber-50 border border-amber-200 text-xs px-2 py-0.5 rounded">
                    Promote triggered
                  </span>
                )}
                {result.catchUpTriggered && (
                  <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 text-xs px-2 py-0.5 rounded">
                    GP catch-up
                  </span>
                )}
                {result.preferredReturnType && (
                  <span className="text-gray-600 bg-white border border-gray-200 text-xs px-2 py-0.5 rounded">
                    Pref: {result.preferredReturnType}
                  </span>
                )}
              </div>

              {/* Waterfall table */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Profit Distribution Waterfall
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Tranche</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Landowner</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Developer</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Total</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.waterfall.map((row, i) => (
                        <tr key={i} className={`border-b last:border-0 hover:bg-gray-50 transition-colors ${!row.fromProfit ? 'bg-blue-50/40' : ''}`}>
                          <td className="px-3 py-2.5 font-medium text-gray-800">{row.tranche}</td>
                          <td className="px-3 py-2.5 text-right text-blue-700">{fmtCr(row.landownerCr)}</td>
                          <td className="px-3 py-2.5 text-right text-indigo-700">{fmtCr(row.developerCr)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-800">{fmtCr(row.totalCr)}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-400">{row.note}</td>
                        </tr>
                      ))}
                      {/* Totals */}
                      <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                        <td className="px-3 py-2.5 text-gray-700">Total Distribution</td>
                        <td className="px-3 py-2.5 text-right text-blue-700">{fmtCr(result.summary.landownerTotal)}</td>
                        <td className="px-3 py-2.5 text-right text-indigo-700">{fmtCr(result.summary.developerTotal)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-800">
                          {fmtCr((result.summary.landownerTotal || 0) + (result.summary.developerTotal || 0))}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-500 mb-0.5">Landowner Profit</p>
                  <p className="text-base font-bold text-blue-800">{fmtCr(result.summary.landownerProfit)}</p>
                  <p className="text-xs text-blue-400 mt-0.5">After capital return</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className="text-xs text-indigo-500 mb-0.5">Developer Profit</p>
                  <p className="text-base font-bold text-indigo-800">{fmtCr(result.summary.developerProfit)}</p>
                  <p className="text-xs text-indigo-400 mt-0.5">Incl. promote</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-500 mb-0.5">Landowner Multiple</p>
                  <p className="text-base font-bold text-blue-800">
                    {result.summary.landownerMultiple != null ? `${result.summary.landownerMultiple.toFixed(2)}x` : '—'}
                  </p>
                  <p className="text-xs text-blue-400 mt-0.5">On land contribution</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className="text-xs text-indigo-500 mb-0.5">Developer Multiple</p>
                  <p className="text-base font-bold text-indigo-800">
                    {result.summary.developerMultiple != null ? `${result.summary.developerMultiple.toFixed(2)}x` : '—'}
                  </p>
                  <p className="text-xs text-indigo-400 mt-0.5">On cash contribution</p>
                </div>
              </div>

              <p className="text-xs text-gray-400">
                JV model: Landowner equity = land at agreed valuation. Developer equity = cash contribution.
                Preferred return accrues on total equity at {inputs.preferredReturnPct}% pa over{' '}
                {inputs.holdPeriodYears} years before residual profit sharing.
                {result.promoteTriggered
                  ? ` Developer promote of ${inputs.developerPromotePct}% triggered at ${inputs.promoteThresholdMultiple}x equity multiple.`
                  : ` Promote threshold (${inputs.promoteThresholdMultiple}x) not reached — no promote.`}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">
              Enter equity contributions, total revenue, and total cost to see the waterfall.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DEBT SCHEDULE PANEL ──────────────────────────────────────────────────

export function DebtSchedulePanel({ financials: rawFinancials, normalizedFinancials }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const capitalStack = rawFinancials?.capital_stack || rawFinancials?.model_params?.capitalStack;
  const inputs = rawFinancials?.model_params?.inputs || {};

  const debtLTV = capitalStack?.debtLTV ?? inputs.debtLTV ?? 0;
  const debtRatePct = capitalStack?.debtRatePct ?? inputs.debtRatePct ?? 0;
  const debtDrawnCr = capitalStack?.debtCr ?? 0;
  const projectDurationMonths =
    (inputs.projectDurationYears != null ? Number(inputs.projectDurationYears) * 12 : null)
    ?? inputs.projectDurationMonths
    ?? rawFinancials?.project_duration_months
    ?? 36;
  const constructionStartMonths =
    (inputs.constructionStartMonths != null && inputs.constructionStartMonths !== '' ? Number(inputs.constructionStartMonths) : null)
    ?? (inputs.constructionStartYears != null ? Number(inputs.constructionStartYears) * 12 : null)
    ?? 0;
  const constructionEndMonths =
    (inputs.constructionEndMonths != null && inputs.constructionEndMonths !== '' ? Number(inputs.constructionEndMonths) : null)
    ?? (inputs.constructionEndYears != null ? Number(inputs.constructionEndYears) * 12 : null)
    ?? projectDurationMonths * 0.85;

  const debtTenorYearsRaw = capitalStack?.debtTenorYears ?? inputs.debtTenorYears;
  const debtTenorMonths = debtTenorYearsRaw != null && debtTenorYearsRaw !== ''
    ? Number(debtTenorYearsRaw) * 12
    : null;

  const schedule = useMemo(() => {
    if (!(debtDrawnCr > 0) || !(debtRatePct > 0)) return null;
    return buildDebtSchedule({
      debtDrawnCr,
      debtRatePct,
      projectDurationMonths,
      constructionStartMonths,
      constructionEndMonths,
      debtTenorMonths,
    });
  }, [debtDrawnCr, debtRatePct, projectDurationMonths, constructionStartMonths, constructionEndMonths, debtTenorMonths]);

  // Backend-computed amortizing schedule for income assets + hospitality.
  // Present when debtCoverage > 0 on an income-asset model.
  const amortizingSchedule = capitalStack?.debtSchedule;

  // Render if we have either (a) a construction-loan S-curve (residential/plotted
  // with debtLTV > 0), or (b) a backend amortizing schedule (income/hospitality).
  if (!capitalStack || (!schedule && !amortizingSchedule?.termLoan && !amortizingSchedule?.lrd)) {
    return null;
  }

  const rows = schedule ? (showAll ? schedule.rows : schedule.rows.slice(0, 10)) : [];
  const fmtCr = (v) => (v != null && v !== 0 ? `₹${v.toFixed(2)} Cr` : '—');
  const hasAmortizing = !!(amortizingSchedule?.termLoan || amortizingSchedule?.lrd);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-primary-600" />
          <span className="text-sm font-semibold text-gray-900">Debt Schedule</span>
          {schedule && (
            <span className="text-xs text-gray-500">
              ₹{schedule.totalDebtCr.toFixed(2)} Cr @ {schedule.debtRatePct}% pa
            </span>
          )}
          {hasAmortizing && (
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5">
              Amortizing — {amortizingSchedule.termLoan?.amortizationYears || amortizingSchedule.lrd?.amortizationYears}yr
            </span>
          )}
          {debtLTV > 0 && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">
              {(debtLTV * 100).toFixed(0)}% LTV
            </span>
          )}
        </div>
        <ChevronRight
          size={16}
          className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-4">
          {/* Amortizing term-loan summary (income assets / hospitality) */}
          {hasAmortizing && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Operating-Phase Amortizing Debt
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {amortizingSchedule.termLoan && (
                  <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
                    <p className="text-xs font-semibold text-emerald-700 mb-2">Term Loan</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-gray-500">Principal</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.principalCr)}</dd>
                      <dt className="text-gray-500">Rate / Amort</dt>
                      <dd className="text-right text-gray-800 font-medium">
                        {amortizingSchedule.termLoan.annualRatePct}% / {amortizingSchedule.termLoan.amortizationYears}yr
                      </dd>
                      <dt className="text-gray-500">Quarterly P&amp;I</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.quarterlyPaymentCr)}</dd>
                      <dt className="text-gray-500">Annual Debt Service</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.annualDebtServiceCr)}</dd>
                      <dt className="text-gray-500">Total Interest</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.totalInterestCr)}</dd>
                      <dt className="text-gray-500">Balloon at Exit</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.termLoan.balloonRepaymentCr)}</dd>
                    </dl>
                  </div>
                )}
                {amortizingSchedule.lrd && (
                  <div className="bg-sky-50 rounded-lg p-4 border border-sky-100">
                    <p className="text-xs font-semibold text-sky-700 mb-2">LRD Refinance</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-gray-500">Principal</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.lrd.principalCr)}</dd>
                      <dt className="text-gray-500">Rate / Amort</dt>
                      <dd className="text-right text-gray-800 font-medium">
                        {amortizingSchedule.lrd.annualRatePct}% / {amortizingSchedule.lrd.amortizationYears}yr
                      </dd>
                      <dt className="text-gray-500">Quarterly P&amp;I</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.lrd.quarterlyPaymentCr)}</dd>
                      <dt className="text-gray-500">Annual Debt Service</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.lrd.annualDebtServiceCr)}</dd>
                      <dt className="text-gray-500">Refinance Quarter</dt>
                      <dd className="text-right text-gray-800 font-medium">Q{amortizingSchedule.lrd.refinanceQuarter}</dd>
                      <dt className="text-gray-500">Balloon at Exit</dt>
                      <dd className="text-right text-gray-800 font-medium">{fmtCr(amortizingSchedule.lrd.balloonRepaymentCr)}</dd>
                    </dl>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Quarterly P&amp;I based on standard CRE annuity amortization; remaining balance paid as balloon at exit.
              </p>
            </div>
          )}

          {/* Construction S-curve summary (residential / plotted) */}
          {schedule && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs text-amber-500 mb-0.5">Total Debt Drawn</p>
              <p className="text-base font-bold text-amber-800">₹{schedule.totalDebtCr.toFixed(2)} Cr</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs text-amber-500 mb-0.5">Interest Cost</p>
              <p className="text-base font-bold text-amber-800">₹{schedule.totalInterestCr.toFixed(2)} Cr</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-0.5">Interest Rate</p>
              <p className="text-base font-bold text-gray-800">{schedule.debtRatePct}% pa</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-0.5">Total Debt Service</p>
              <p className="text-base font-bold text-gray-800">
                ₹{(schedule.totalDebtCr + schedule.totalInterestCr).toFixed(2)} Cr
              </p>
            </div>
          </div>
          )}

          {/* Construction S-curve schedule table */}
          {schedule && (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Quarter</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Opening Balance</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Draw</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Repayment</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Closing Balance</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Interest</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Cum. Interest</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.quarter} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 text-gray-600">Q{row.quarter}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{fmtCr(row.openingBalance)}</td>
                    <td className="px-3 py-2 text-right text-green-600">
                      {row.draw > 0 ? `+${fmtCr(row.draw)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-red-600">
                      {row.repayment < 0 ? fmtCr(Math.abs(row.repayment)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-800">{fmtCr(row.closingBalance)}</td>
                    <td className="px-3 py-2 text-right text-amber-600">{fmtCr(row.interest)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtCr(row.cumulativeInterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {schedule.rows.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="text-xs text-primary-600 hover:underline"
            >
              {showAll ? 'Show less' : `Show all ${schedule.rows.length} quarters`}
            </button>
          )}

          <p className="text-xs text-gray-400">
            Draw schedule follows construction S-curve. Repayment is a balloon at project completion
            (typical India construction finance). Interest accrues quarterly on outstanding balance.
          </p>
          </>
          )}
        </div>
      )}
    </div>
  );
}
