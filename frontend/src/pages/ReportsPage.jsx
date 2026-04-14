import { useMemo, useState } from 'react';
import { Download, FileText, Loader2, AlertTriangle, Presentation } from 'lucide-react';
import { downloadAxiosResponse, downloadBlob } from '../utils/download';
import { useDeals } from '../hooks/useDeals';
import { useDailyBrief } from '../hooks/useIntelligence';
import LoadingSpinner from '../components/common/LoadingSpinner';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { formatCrores, formatPct, STAGE_CONFIG } from '../utils/format';
import { exportsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const TABS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'financial', label: 'Financial' },
  { key: 'citywise', label: 'City-wise' },
  { key: 'performance', label: 'Performance' },
  { key: 'intelligence', label: 'Intelligence' },
];

const EmptyTableState = ({ message }) => (
  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center text-sm text-gray-600 dark:border-gray-700 dark:bg-slate-900/70 dark:text-slate-300">
    {message}
  </div>
);

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [exportingCSV, setExportingCSV] = useState(false);
  const [exportingComps, setExportingComps] = useState(false);
  const [generatingIC, setGeneratingIC] = useState(null);
  const [exportingPptx, setExportingPptx] = useState(null);
  const [exportingXlsx, setExportingXlsx] = useState(null);

  const { data: dealsData, isLoading } = useDeals({ limit: 500, includeArchived: true });
  const { data: dailyBrief } = useDailyBrief();
  const deals = dealsData?.data || [];

  const pipelineData = useMemo(() => {
    const stages = {};
    deals.forEach((deal) => {
      const stage = deal.stage || 'screening';
      if (!stages[stage]) {
        stages[stage] = { count: 0, totalValue: 0 };
      }
      stages[stage].count += 1;
      stages[stage].totalValue += Number(deal.total_revenue_cr || 0);
    });

    return Object.entries(STAGE_CONFIG).map(([key, config]) => ({
      stage: key,
      label: config.label,
      color: config.color,
      count: stages[key]?.count || 0,
      totalValue: stages[key]?.totalValue || 0,
    }));
  }, [deals]);

  const cityData = useMemo(() => {
    const cities = {};
    deals.forEach((deal) => {
      const city = deal.city || 'Unknown';
      if (!cities[city]) {
        cities[city] = { count: 0, irrSum: 0, irrCount: 0 };
      }

      cities[city].count += 1;
      const irr = Number(deal.irr_pct);
      if (!Number.isNaN(irr) && irr > 0) {
        cities[city].irrSum += irr;
        cities[city].irrCount += 1;
      }
    });

    return Object.entries(cities)
      .map(([city, data]) => ({
        city,
        count: data.count,
        avgIRR: data.irrCount > 0 ? data.irrSum / data.irrCount : null,
      }))
      .sort((a, b) => b.count - a.count);
  }, [deals]);

  const performanceData = useMemo(
    () =>
      [...deals]
        .map((deal) => ({
          ...deal,
          _irr: Number(deal.irr_pct) || 0,
        }))
        .sort((a, b) => b._irr - a._irr),
    [deals]
  );

  const handleExportDeals = async () => {
    setExportingCSV(true);
    try {
      const response = await exportsAPI.deals();
      downloadAxiosResponse(response, 'deals_export.csv');
      toast.success('Deals CSV downloaded');
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Export failed';
      toast.error(msg);
      console.error('[ReportsPage] Export deals error:', err);
    } finally {
      setExportingCSV(false);
    }
  };

  const handleExportComps = async () => {
    setExportingComps(true);
    try {
      const response = await exportsAPI.comps();
      downloadAxiosResponse(response, 'comps_export.csv');
      toast.success('Comps CSV downloaded');
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Comps export failed';
      toast.error(msg);
      console.error('[ReportsPage] Export comps error:', err);
    } finally {
      setExportingComps(false);
    }
  };

  const handleExportPptx = async (dealId, dealName) => {
    setExportingPptx(dealId);
    try {
      const response = await exportsAPI.dealPptx(dealId);
      const safeName = (dealName || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      downloadAxiosResponse(response, `redip-${safeName}.pptx`);
      toast.success('PPTX deck downloaded');
    } catch (err) {
      toast.error(err.response?.data?.message || 'PPTX export failed');
    } finally {
      setExportingPptx(null);
    }
  };

  const handleExportXlsx = async (dealId, dealName) => {
    setExportingXlsx(dealId);
    try {
      const response = await exportsAPI.dealXlsx(dealId);
      const safeName = (dealName || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      downloadAxiosResponse(response, `redip-${safeName}.xlsx`);
      toast.success('Excel workbook downloaded');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Excel export failed');
    } finally {
      setExportingXlsx(null);
    }
  };

  const handleGenerateIC = async (dealId, dealName) => {
    setGeneratingIC(dealId);
    try {
      const response = await exportsAPI.icReport(dealId);
      const reportPayload = response.data?.data ?? response.data;
      const safeName = (dealName || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      downloadBlob(
        JSON.stringify(reportPayload, null, 2),
        `IC_Report_${safeName}.json`,
        'application/json'
      );
      toast.success('IC Report downloaded');
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'IC Report generation failed';
      toast.error(msg);
      console.error('[ReportsPage] IC report error:', err);
    } finally {
      setGeneratingIC(null);
    }
  };

  const getFinancialValue = (deal, key) => {
    if (deal[key] !== undefined) {
      return deal[key];
    }
    return null;
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Pipeline analytics, exports, and verified-data intelligence readiness"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleExportDeals}
          disabled={exportingCSV}
          className="btn btn-secondary flex items-center gap-2 text-sm"
        >
          {exportingCSV ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export Deals CSV
        </button>
        <button
          onClick={handleExportComps}
          disabled={exportingComps}
          className="btn btn-secondary flex items-center gap-2 text-sm"
        >
          {exportingComps ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export Comps CSV
        </button>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-6 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 pb-3 text-sm font-medium transition whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'pipeline' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          {deals.length === 0 ? (
            <div className="p-6">
              <EmptyTableState message="No deals yet. Add verified opportunities to generate pipeline reports." />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Stage</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Count</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {pipelineData.map((row) => (
                  <tr key={row.stage} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-6 py-3">
                      <Badge className={row.color}>{row.label}</Badge>
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{row.count}</td>
                    <td className="px-6 py-3 text-right text-gray-900">{formatCrores(row.totalValue)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 dark:bg-gray-700/60 font-semibold">
                  <td className="px-6 py-3 text-gray-900">Total</td>
                  <td className="px-6 py-3 text-right text-gray-900">
                    {pipelineData.reduce((sum, row) => sum + row.count, 0)}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-900">
                    {formatCrores(pipelineData.reduce((sum, row) => sum + row.totalValue, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'financial' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          {deals.length === 0 ? (
            <div className="p-6">
              <EmptyTableState message="No deals yet. Create deals and financial models to populate this report." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Deal</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">City</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Revenue</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Profit</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">IRR</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">NPV</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Eq. Multiple</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {deals.map((deal) => (
                    <tr key={deal.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-3 font-medium text-gray-900">{deal.name}</td>
                      <td className="px-4 py-3 text-gray-600">{deal.city || '-'}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatCrores(getFinancialValue(deal, 'total_revenue_cr'))}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatCrores(getFinancialValue(deal, 'total_cost_cr'))}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatCrores(getFinancialValue(deal, 'gross_profit_cr'))}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatPct(getFinancialValue(deal, 'irr_pct'))}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatCrores(getFinancialValue(deal, 'npv_cr'))}</td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {getFinancialValue(deal, 'equity_multiple')
                          ? `${Number(getFinancialValue(deal, 'equity_multiple')).toFixed(2)}x`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'citywise' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          {cityData.length === 0 ? (
            <div className="p-6">
              <EmptyTableState message="No city-level portfolio data yet. Add linked properties and deals to compare city exposure." />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">City</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Deal Count</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Avg IRR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {cityData.map((row) => (
                  <tr key={row.city} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{row.city}</td>
                    <td className="px-6 py-3 text-right text-gray-900">{row.count}</td>
                    <td className="px-6 py-3 text-right text-gray-900">
                      {row.avgIRR !== null ? formatPct(row.avgIRR) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'performance' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          {performanceData.length === 0 ? (
            <div className="p-6">
              <EmptyTableState message="No performance ranking yet. As financial models are added, REDIP will rank live opportunities by return profile." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Deal</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">City</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Stage</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">IRR</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">NPV</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-gray-500">Exports</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {performanceData.map((deal, idx) => (
                    <tr key={deal.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{deal.name}</td>
                      <td className="px-4 py-3 text-gray-600">{deal.city || '-'}</td>
                      <td className="px-4 py-3">
                        <Badge className={STAGE_CONFIG[deal.stage]?.color || 'bg-gray-100 text-gray-700'}>
                          {STAGE_CONFIG[deal.stage]?.label || deal.stage}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatPct(deal._irr)}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatCrores(getFinancialValue(deal, 'npv_cr'))}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleExportPptx(deal.id, deal.name)}
                            disabled={exportingPptx === deal.id}
                            title="Download PPTX investor deck"
                            className="inline-flex items-center gap-1 rounded-lg bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
                          >
                            {exportingPptx === deal.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Presentation size={11} />
                            )}
                            PPTX
                          </button>
                          <button
                            onClick={() => handleExportXlsx(deal.id, deal.name)}
                            disabled={exportingXlsx === deal.id}
                            title="Download Excel workbook"
                            className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1 text-xs font-medium text-green-700 transition hover:bg-green-100 disabled:opacity-50"
                          >
                            {exportingXlsx === deal.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Download size={11} />
                            )}
                            XLSX
                          </button>
                          <button
                            onClick={() => handleGenerateIC(deal.id, deal.name)}
                            disabled={generatingIC === deal.id}
                            title="Generate IC report (JSON)"
                            className="inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-100 disabled:opacity-50"
                          >
                            {generatingIC === deal.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <FileText size={11} />
                            )}
                            IC
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'intelligence' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">
                  Verified-data intelligence
                </p>
                <h3 className="mt-2 text-xl font-semibold text-gray-900">
                  {dailyBrief?.title || 'Daily Real Estate Intelligence Brief'}
                </h3>
                <p className="mt-2 max-w-3xl text-sm text-gray-600">
                  {dailyBrief?.notes || 'REDIP only publishes verified intelligence. Connect trusted external feeds to activate market-facing Bengaluru and India brief generation.'}
                </p>
              </div>
              {dailyBrief?.mode && (
                <Badge className="bg-slate-100 text-slate-700">{dailyBrief.mode}</Badge>
              )}
            </div>
          </div>

          {!dailyBrief?.hasVerifiedMarketData && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
              <h4 className="text-base font-semibold text-amber-900">Verified market sources required</h4>
              <p className="mt-2 text-sm text-amber-800">
                REDIP is intentionally withholding external market claims until verified data feeds are connected.
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {(dailyBrief?.verifiedSourceRequirements || []).map((source) => (
                  <div key={source.key} className="rounded-xl border border-amber-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">{source.label}</p>
                    <p className="mt-2 text-sm text-slate-600">{source.purpose}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dailyBrief?.dealOfDay && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
              <h4 className="text-base font-semibold text-gray-900">1. Deal of the Day</h4>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <p className="text-lg font-semibold text-gray-900">{dailyBrief.dealOfDay.headline}</p>
                  <p className="mt-2 text-sm text-gray-600">{dailyBrief.dealOfDay.whyItMatters}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 text-sm">
                  <p className="text-gray-500">City</p>
                  <p className="font-medium text-gray-900">{dailyBrief.dealOfDay.city}</p>
                  <p className="mt-3 text-gray-500">Stage</p>
                  <p className="font-medium text-gray-900">
                    {STAGE_CONFIG[dailyBrief.dealOfDay.stage]?.label || dailyBrief.dealOfDay.stage}
                  </p>
                  <p className="mt-3 text-gray-500">IRR</p>
                  <p className="font-medium text-gray-900">{formatPct(dailyBrief.dealOfDay.irrPct)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
              <h4 className="text-base font-semibold text-gray-900">2. Key Developments</h4>
              {(dailyBrief?.keyDevelopments || []).length > 0 ? (
                <div className="mt-4 space-y-4">
                  {(dailyBrief?.keyDevelopments || []).map((item, index) => (
                    <div key={`${item.headline}-${index}`} className="rounded-xl bg-gray-50 p-4">
                      <p className="text-sm font-semibold text-gray-900">{item.headline}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {item.city} · {item.date ? new Date(item.date).toLocaleDateString('en-IN') : ''}
                      </p>
                      <p className="mt-2 text-sm text-gray-600">{item.whyItMatters}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                  No verified developments are available yet. Once real activities and verified external feeds are connected, they will appear here.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
              <h4 className="text-base font-semibold text-gray-900">3. Market Signals</h4>
              <div className="mt-4 grid gap-4">
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Bullish</p>
                  <ul className="mt-3 space-y-2 text-sm text-emerald-900">
                    {(dailyBrief?.marketSignals?.bullish || []).map((item, index) => (
                      <li key={`bullish-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Risk</p>
                  <ul className="mt-3 space-y-2 text-sm text-amber-900">
                    {(dailyBrief?.marketSignals?.risk || []).map((item, index) => (
                      <li key={`risk-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
            <h4 className="text-base font-semibold text-gray-900">4. Bengaluru Demand Heatmap</h4>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Micro-market</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Absorption</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Pricing Trend</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Inventory</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Demand Signal</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Insight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {(dailyBrief?.bengaluruDemandHeatmap || []).map((row) => (
                    <tr key={row.microMarket}>
                      <td className="px-4 py-3 font-medium text-gray-900">{row.microMarket}</td>
                      <td className="px-4 py-3 text-gray-700">{row.absorption}</td>
                      <td className="px-4 py-3 text-gray-700">{row.pricingTrend}</td>
                      <td className="px-4 py-3 text-gray-700">{row.inventory}</td>
                      <td className="px-4 py-3 text-gray-700">{row.demandSignal}</td>
                      <td className="px-4 py-3 text-gray-600">{row.insight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
              <h4 className="text-base font-semibold text-gray-900">5. Demand Slowdown Indicators</h4>
              <ul className="mt-4 space-y-3 text-sm text-gray-700">
                {(dailyBrief?.demandSlowdownIndicators || []).map((item, index) => (
                  <li key={`slowdown-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
              <h4 className="text-base font-semibold text-gray-900">6. Strategic Takeaways</h4>
              <ul className="mt-4 space-y-3 text-sm text-gray-700">
                {(dailyBrief?.strategicTakeaways || []).map((item, index) => (
                  <li key={`takeaway-${index}`}>{item}</li>
                ))}
              </ul>
              {dailyBrief?.bottomLine && (
                <div className="mt-4 rounded-xl bg-slate-900 p-4 text-sm text-white">
                  <p className="text-xs uppercase tracking-wide text-slate-300">Bottom line</p>
                  <p className="mt-2">{dailyBrief.bottomLine}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
