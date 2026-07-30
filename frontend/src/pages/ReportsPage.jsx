import { useMemo, useState } from 'react';
import { Download, FileText, Loader2, Presentation, BookText } from 'lucide-react';
import { downloadAxiosResponse } from '../utils/download';
import { downloadCsv } from '../utils/csvDownload';
import { useDeals } from '../hooks/useDeals';
import { useDailyBrief } from '../hooks/useIntelligence';
import PageHeader from '../components/common/PageHeader';
import PageIntro from '../components/guide/PageIntro';
import Badge from '../components/common/Badge';
import { Skeleton, SkeletonList } from '../design-system';
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
  <div className="rounded-xl border border-dashed border-hairline-strong bg-bg-secondary px-4 py-10 text-center text-sm text-content-secondary">
    {message}
  </div>
);

const getExportErrorMessage = async (err, fallbackMessage) => {
  const responseData = err?.response?.data;

  if (responseData instanceof Blob) {
    try {
      const text = await responseData.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.message) return parsed.message;
        } catch {
          return text;
        }
      }
    } catch {
      // fall through to the regular message chain
    }
  }

  return err?.response?.data?.message || err?.message || fallbackMessage;
};

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [exportingDealsXlsx, setExportingDealsXlsx] = useState(false);
  const [exportingComps, setExportingComps] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(null);
  const [exportingXlsx, setExportingXlsx] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(null);
  // PR-NX39 (2026-05-17): per-row busy state for the new DOCX underwriting
  // report download button. Stores the deal id while in flight so only that
  // row's button shows the spinner.
  const [exportingDocx, setExportingDocx] = useState(null);

  // fields:'summary' → lightweight projection; the report charts read only
  // stage/city/irr/revenue/name, never the per-row rollup columns.
  const { data: dealsData, isLoading } = useDeals({ limit: 500, fields: 'summary' });
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

    return Object.entries(STAGE_CONFIG)
      .filter(([key]) => key !== 'dead')
      .map(([key, config]) => ({
        stage: key,
        label: config.label,
        tone: config.tone,
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
        .map((deal) => {
          // Preserve a missing IRR as null. `Number(deal.irr_pct) || 0` turned
          // every un-modeled (sourcing/screening) deal into a fabricated 0.0%
          // that rendered as a real return AND out-ranked genuinely negative
          // IRRs. Un-modeled deals now show an em-dash (via formatPct) and sort
          // last — matching the Financial tab's null handling.
          const raw = deal.irr_pct;
          const _irr = raw == null || raw === '' || !Number.isFinite(Number(raw))
            ? null
            : Number(raw);
          return { ...deal, _irr };
        })
        .sort((a, b) => (b._irr ?? -Infinity) - (a._irr ?? -Infinity)),
    [deals]
  );


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

  const handleExportDealsXlsx = async () => {
    setExportingDealsXlsx(true);
    try {
      const response = await exportsAPI.dealsXlsx();
      downloadAxiosResponse(response, 'redip-deals.xlsx');
      toast.success('Deals workbook downloaded');
    } catch (err) {
      const msg = await getExportErrorMessage(err, 'Deals workbook export failed');
      toast.error(msg);
      console.error('[ReportsPage] Export deals workbook error:', err);
    } finally {
      setExportingDealsXlsx(false);
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
      toast.error(await getExportErrorMessage(err, 'PPTX export failed'));
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
      toast.error(await getExportErrorMessage(err, 'Excel export failed'));
    } finally {
      setExportingXlsx(null);
    }
  };

  const handleExportPdf = async (dealId, dealName) => {
    setExportingPdf(dealId);
    try {
      const response = await exportsAPI.dealPdf(dealId);
      const safeName = (dealName || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      downloadAxiosResponse(response, `redip-${safeName}.pdf`);
      toast.success('PDF report downloaded');
    } catch (err) {
      const msg = await getExportErrorMessage(err, 'PDF export failed');
      toast.error(msg);
      console.error('[ReportsPage] PDF export error:', err);
    } finally {
      setExportingPdf(null);
    }
  };

  // PR-NX39 (2026-05-17): institutional-grade DOCX underwriting report
  // (22 sections — Cover → ToC → AI Briefing → Exec Summary → ... →
  // Risk Register → DD Status → Approvals Tracker → Provenance → Pros &
  // Cons → Score → Methodology → Disclaimer). Gated server-side behind
  // DOCX_REPORT_ENABLED=1 (flipped 2026-05-17). Admins bypass the gate.
  const handleExportDocx = async (dealId, dealName) => {
    setExportingDocx(dealId);
    try {
      const response = await exportsAPI.dealDocx(dealId);
      const safeName = (dealName || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      const today = new Date().toISOString().slice(0, 10);
      downloadAxiosResponse(response, `redip-${safeName}-underwriting-${today}.docx`);
      toast.success('Underwriting report (DOCX) downloaded');
    } catch (err) {
      const msg = await getExportErrorMessage(err, 'Underwriting report download failed');
      toast.error(msg);
      console.error('[ReportsPage] DOCX export error:', err);
    } finally {
      setExportingDocx(null);
    }
  };

  const getFinancialValue = (deal, key) => {
    if (deal[key] !== undefined) {
      return deal[key];
    }
    return null;
  };

  // Per-tab CSV exports. Each builds a header + row matrix from the
  // already-derived tab data and triggers a client-side download — no
  // new backend endpoint needed because every tab is in-memory math
  // over `deals` we already have.
  const today = () => new Date().toISOString().slice(0, 10);
  const num = (v) => (v == null || v === '' ? '' : Number(v));

  const handleDownloadPipelineCsv = () => {
    if (!pipelineData.length) return;
    const headers = ['Stage', 'Count', 'Total Value (Cr)'];
    const rows = pipelineData.map((r) => [r.label, r.count, num(r.totalValue)]);
    rows.push([
      'Total',
      pipelineData.reduce((s, r) => s + r.count, 0),
      num(pipelineData.reduce((s, r) => s + r.totalValue, 0)),
    ]);
    downloadCsv({ filename: `redip-pipeline-${today()}.csv`, headers, rows });
    toast.success('Pipeline report downloaded');
  };

  const handleDownloadFinancialCsv = () => {
    if (!deals.length) return;
    const headers = [
      'Deal', 'City', 'Stage',
      'Revenue (Cr)', 'Cost (Cr)', 'Profit (Cr)',
      'IRR %', 'NPV (Cr)', 'Equity Multiple',
    ];
    const rows = deals.map((d) => [
      d.name,
      d.city || '',
      d.stage || '',
      num(getFinancialValue(d, 'total_revenue_cr')),
      num(getFinancialValue(d, 'total_cost_cr')),
      num(getFinancialValue(d, 'gross_profit_cr')),
      num(getFinancialValue(d, 'irr_pct')),
      num(getFinancialValue(d, 'npv_cr')),
      num(getFinancialValue(d, 'equity_multiple')),
    ]);
    downloadCsv({ filename: `redip-financial-${today()}.csv`, headers, rows });
    toast.success('Financial report downloaded');
  };

  const handleDownloadCitywiseCsv = () => {
    if (!cityData.length) return;
    const headers = ['City', 'Deal Count', 'Avg IRR %'];
    const rows = cityData.map((r) => [r.city, r.count, r.avgIRR != null ? num(r.avgIRR) : '']);
    downloadCsv({ filename: `redip-citywise-${today()}.csv`, headers, rows });
    toast.success('City-wise report downloaded');
  };

  const handleDownloadPerformanceCsv = () => {
    if (!performanceData.length) return;
    const headers = ['Rank', 'Deal', 'City', 'Stage', 'IRR %', 'NPV (Cr)'];
    const rows = performanceData.map((d, idx) => [
      idx + 1,
      d.name,
      d.city || '',
      STAGE_CONFIG[d.stage]?.label || d.stage || '',
      d._irr == null ? '' : num(d._irr),
      num(getFinancialValue(d, 'npv_cr')),
    ]);
    downloadCsv({ filename: `redip-performance-${today()}.csv`, headers, rows });
    toast.success('Performance ranking downloaded');
  };

  // Tiny presentational helper — per-tab "Download CSV" header strip.
  const TabCsvHeader = ({ title, onDownload, disabled }) => (
    <div className="flex items-center justify-between px-6 py-3 border-b border-hairline-strong bg-bg-secondary/40 rounded-t-xl">
      <div className="text-eyebrow uppercase tracking-wider text-content-muted text-[10px] font-medium">
        {title}
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-hairline bg-bg-elevated text-content-secondary hover:text-content-primary hover:bg-bg-secondary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        title={disabled ? 'Nothing to export — table is empty' : 'Download this report as CSV'}
      >
        <Download size={11} />
        Download CSV
      </button>
    </div>
  );

  // Skeleton: header + tab strip + table-shaped body.
  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="Reports" description="Pipeline analytics, exports, and verified-data intelligence readiness" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-md" />
          ))}
        </div>
        <div className="bg-bg-elevated border border-hairline rounded-editorial p-2">
          <SkeletonList rows={6} columns={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Pipeline analytics, exports, and verified-data intelligence readiness"
      />

      <PageIntro topicId="reports" />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleExportComps}
          disabled={exportingComps}
          className="btn btn-secondary flex items-center gap-2 text-sm"
        >
          {exportingComps ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export Comps CSV
        </button>
        <button
          onClick={handleExportDealsXlsx}
          disabled={exportingDealsXlsx}
          className="btn btn-secondary flex items-center gap-2 text-sm"
        >
          {exportingDealsXlsx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export Deals XLSX
        </button>
      </div>

      <div className="border-b border-hairline-strong">
        <nav className="flex gap-6 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 pb-3 text-sm font-medium transition whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-accent text-accent'
                  : 'border-transparent text-content-secondary hover:text-content-primary dark:hover:text-content-muted'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'pipeline' && (
        <div className="rounded-xl border border-hairline-strong bg-bg-elevated shadow-sm overflow-hidden">
          <TabCsvHeader
            title="Pipeline by stage"
            onDownload={handleDownloadPipelineCsv}
            disabled={!pipelineData.length}
          />
          {deals.length === 0 ? (
            <div className="p-6">
              <EmptyTableState message="No deals yet. Add verified opportunities to generate pipeline reports." />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline-strong bg-bg-secondary">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-content-secondary">Stage</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-content-secondary">Count</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-content-secondary">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {pipelineData.map((row) => (
                  <tr key={row.stage} className="hover:bg-bg-secondary">
                    <td className="px-6 py-3">
                      <Badge tone={row.tone}>{row.label}</Badge>
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-content-primary">{row.count}</td>
                    <td className="px-6 py-3 text-right text-content-primary">{formatCrores(row.totalValue)}</td>
                  </tr>
                ))}
                <tr className="bg-bg-secondary font-semibold">
                  <td className="px-6 py-3 text-content-primary">Total</td>
                  <td className="px-6 py-3 text-right text-content-primary">
                    {pipelineData.reduce((sum, row) => sum + row.count, 0)}
                  </td>
                  <td className="px-6 py-3 text-right text-content-primary">
                    {formatCrores(pipelineData.reduce((sum, row) => sum + row.totalValue, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'financial' && (
        <div className="rounded-xl border border-hairline-strong bg-bg-elevated shadow-sm overflow-hidden">
          <TabCsvHeader
            title="Financial summary by deal"
            onDownload={handleDownloadFinancialCsv}
            disabled={!deals.length}
          />
          {deals.length === 0 ? (
            <div className="p-6">
              <EmptyTableState message="No deals yet. Create deals and financial models to populate this report." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline-strong bg-bg-secondary">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-content-secondary">Deal</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-content-secondary">City</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-content-secondary">Revenue</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-content-secondary">Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-content-secondary">Profit</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-content-secondary">IRR</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-content-secondary">NPV</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-content-secondary">Eq. Multiple</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {deals.map((deal) => (
                    <tr key={deal.id} className="hover:bg-bg-secondary">
                      <td className="px-4 py-3 font-medium text-content-primary">{deal.name}</td>
                      <td className="px-4 py-3 text-content-secondary">{deal.city || '-'}</td>
                      <td className="px-4 py-3 text-right text-content-primary">{formatCrores(getFinancialValue(deal, 'total_revenue_cr'))}</td>
                      <td className="px-4 py-3 text-right text-content-primary">{formatCrores(getFinancialValue(deal, 'total_cost_cr'))}</td>
                      <td className="px-4 py-3 text-right text-content-primary">{formatCrores(getFinancialValue(deal, 'gross_profit_cr'))}</td>
                      <td className="px-4 py-3 text-right text-content-primary">{formatPct(getFinancialValue(deal, 'irr_pct'))}</td>
                      <td className="px-4 py-3 text-right text-content-primary">{formatCrores(getFinancialValue(deal, 'npv_cr'))}</td>
                      <td className="px-4 py-3 text-right text-content-primary">
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
        <div className="rounded-xl border border-hairline-strong bg-bg-elevated shadow-sm overflow-hidden">
          <TabCsvHeader
            title="City-wise exposure"
            onDownload={handleDownloadCitywiseCsv}
            disabled={!cityData.length}
          />
          {cityData.length === 0 ? (
            <div className="p-6">
              <EmptyTableState message="No city-level portfolio data yet. Add linked properties and deals to compare city exposure." />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline-strong bg-bg-secondary">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-content-secondary">City</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-content-secondary">Deal Count</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-content-secondary">Avg IRR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {cityData.map((row) => (
                  <tr key={row.city} className="hover:bg-bg-secondary">
                    <td className="px-6 py-3 font-medium text-content-primary">{row.city}</td>
                    <td className="px-6 py-3 text-right text-content-primary">{row.count}</td>
                    <td className="px-6 py-3 text-right text-content-primary">
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
        <div className="rounded-xl border border-hairline-strong bg-bg-elevated shadow-sm overflow-hidden">
          <TabCsvHeader
            title="Performance ranking by IRR"
            onDownload={handleDownloadPerformanceCsv}
            disabled={!performanceData.length}
          />
          {performanceData.length === 0 ? (
            <div className="p-6">
              <EmptyTableState message="No performance ranking yet. As financial models are added, Acureal will rank live opportunities by return profile." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline-strong bg-bg-secondary">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-content-secondary">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-content-secondary">Deal</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-content-secondary">City</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-content-secondary">Stage</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-content-secondary">IRR</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-content-secondary">NPV</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-content-secondary">Exports</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {performanceData.map((deal, idx) => (
                    <tr key={deal.id} className="hover:bg-bg-secondary">
                      <td className="px-4 py-3 text-content-secondary">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-content-primary">{deal.name}</td>
                      <td className="px-4 py-3 text-content-secondary">{deal.city || '-'}</td>
                      <td className="px-4 py-3">
                        <Badge tone={STAGE_CONFIG[deal.stage]?.tone}>
                          {STAGE_CONFIG[deal.stage]?.label || deal.stage}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-content-primary">{formatPct(deal._irr)}</td>
                      <td className="px-4 py-3 text-right text-content-primary">{formatCrores(getFinancialValue(deal, 'npv_cr'))}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleExportPptx(deal.id, deal.name)}
                            disabled={exportingPptx === deal.id}
                            title="Download PPTX investor deck"
                            className="inline-flex items-center gap-1 rounded-lg bg-premium-soft px-2 py-1 text-xs font-medium text-premium transition hover:brightness-95 disabled:opacity-50"
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
                            className="inline-flex items-center gap-1 rounded-lg bg-pos-soft px-2 py-1 text-xs font-medium text-data-positive transition hover:brightness-95 disabled:opacity-50"
                          >
                            {exportingXlsx === deal.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Download size={11} />
                            )}
                            XLSX
                          </button>
                          <button
                            onClick={() => handleExportPdf(deal.id, deal.name)}
                            disabled={exportingPdf === deal.id}
                            title="Download PDF report"
                            className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent transition hover:brightness-95 disabled:opacity-50"
                          >
                            {exportingPdf === deal.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <FileText size={11} />
                            )}
                            PDF
                          </button>
                          <button
                            onClick={() => handleExportDocx(deal.id, deal.name)}
                            disabled={exportingDocx === deal.id}
                            title="Download 22-section institutional underwriting report (DOCX)"
                            className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent transition hover:brightness-95 disabled:opacity-50"
                          >
                            {exportingDocx === deal.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <BookText size={11} />
                            )}
                            DOCX
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
          <div className="rounded-2xl border border-hairline-strong bg-bg-elevated p-6 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                  Verified-data intelligence
                </p>
                <h3 className="mt-2 text-xl font-semibold text-content-primary">
                  {dailyBrief?.title || 'Daily Real Estate Intelligence Brief'}
                </h3>
                <p className="mt-2 max-w-3xl text-sm text-content-secondary">
                  {dailyBrief?.notes || 'Acureal only publishes verified intelligence. Connect trusted external feeds to activate market-facing Bengaluru and India brief generation.'}
                </p>
              </div>
              {dailyBrief?.mode && (
                <Badge className="bg-bg-secondary text-content-secondary">{dailyBrief.mode}</Badge>
              )}
            </div>
          </div>

          {!dailyBrief?.hasVerifiedMarketData && (
            <div className="rounded-2xl border border-hairline bg-premium-soft p-6 shadow-sm">
              <h4 className="text-base font-semibold text-premium">Verified market sources required</h4>
              <p className="mt-2 text-sm text-premium">
                Acureal is intentionally withholding external market claims until verified data feeds are connected.
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {(dailyBrief?.verifiedSourceRequirements || []).map((source) => (
                  <div key={source.key} className="rounded-xl border border-hairline bg-bg-elevated p-4">
                    <p className="text-sm font-semibold text-content-primary">{source.label}</p>
                    <p className="mt-2 text-sm text-content-secondary">{source.purpose}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dailyBrief?.dealOfDay && (
            <div className="rounded-2xl border border-hairline-strong bg-bg-elevated p-6 shadow-sm">
              <h4 className="text-base font-semibold text-content-primary">1. Deal of the Day</h4>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <p className="text-lg font-semibold text-content-primary">{dailyBrief.dealOfDay.headline}</p>
                  <p className="mt-2 text-sm text-content-secondary">{dailyBrief.dealOfDay.whyItMatters}</p>
                </div>
                <div className="rounded-xl bg-bg-secondary p-4 text-sm">
                  <p className="text-content-secondary">City</p>
                  <p className="font-medium text-content-primary">{dailyBrief.dealOfDay.city}</p>
                  <p className="mt-3 text-content-secondary">Stage</p>
                  <p className="font-medium text-content-primary">
                    {STAGE_CONFIG[dailyBrief.dealOfDay.stage]?.label || dailyBrief.dealOfDay.stage}
                  </p>
                  <p className="mt-3 text-content-secondary">IRR</p>
                  <p className="font-medium text-content-primary">{formatPct(dailyBrief.dealOfDay.irrPct)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-hairline-strong bg-bg-elevated p-6 shadow-sm">
              <h4 className="text-base font-semibold text-content-primary">2. Key Developments</h4>
              {(dailyBrief?.keyDevelopments || []).length > 0 ? (
                <div className="mt-4 space-y-4">
                  {(dailyBrief?.keyDevelopments || []).map((item, index) => (
                    <div key={`${item.headline}-${index}`} className="rounded-xl bg-bg-secondary p-4">
                      <p className="text-sm font-semibold text-content-primary">{item.headline}</p>
                      <p className="mt-1 text-xs text-content-secondary">
                        {item.city} · {item.date ? new Date(item.date).toLocaleDateString('en-IN') : ''}
                      </p>
                      <p className="mt-2 text-sm text-content-secondary">{item.whyItMatters}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-hairline-strong bg-bg-secondary p-4 text-sm text-content-secondary">
                  No verified developments are available yet. Once real activities and verified external feeds are connected, they will appear here.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-hairline-strong bg-bg-elevated p-6 shadow-sm">
              <h4 className="text-base font-semibold text-content-primary">3. Market Signals</h4>
              <div className="mt-4 grid gap-4">
                <div className="rounded-xl bg-pos-soft p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-data-positive">Bullish</p>
                  <ul className="mt-3 space-y-2 text-sm text-data-positive">
                    {(dailyBrief?.marketSignals?.bullish || []).map((item, index) => (
                      <li key={`bullish-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl bg-premium-soft p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-premium">Risk</p>
                  <ul className="mt-3 space-y-2 text-sm text-premium">
                    {(dailyBrief?.marketSignals?.risk || []).map((item, index) => (
                      <li key={`risk-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-hairline-strong bg-bg-elevated p-6 shadow-sm">
            <h4 className="text-base font-semibold text-content-primary">4. Bengaluru Demand Heatmap</h4>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-bg-secondary">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-secondary">Micro-market</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-secondary">Absorption</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-secondary">Pricing Trend</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-secondary">Inventory</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-secondary">Demand Signal</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-secondary">Insight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {(dailyBrief?.bengaluruDemandHeatmap || []).map((row) => (
                    <tr key={row.microMarket}>
                      <td className="px-4 py-3 font-medium text-content-primary">{row.microMarket}</td>
                      <td className="px-4 py-3 text-content-secondary">{row.absorption}</td>
                      <td className="px-4 py-3 text-content-secondary">{row.pricingTrend}</td>
                      <td className="px-4 py-3 text-content-secondary">{row.inventory}</td>
                      <td className="px-4 py-3 text-content-secondary">{row.demandSignal}</td>
                      <td className="px-4 py-3 text-content-secondary">{row.insight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-hairline-strong bg-bg-elevated p-6 shadow-sm">
              <h4 className="text-base font-semibold text-content-primary">5. Demand Slowdown Indicators</h4>
              <ul className="mt-4 space-y-3 text-sm text-content-secondary">
                {(dailyBrief?.demandSlowdownIndicators || []).map((item, index) => (
                  <li key={`slowdown-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-hairline-strong bg-bg-elevated p-6 shadow-sm">
              <h4 className="text-base font-semibold text-content-primary">6. Strategic Takeaways</h4>
              <ul className="mt-4 space-y-3 text-sm text-content-secondary">
                {(dailyBrief?.strategicTakeaways || []).map((item, index) => (
                  <li key={`takeaway-${index}`}>{item}</li>
                ))}
              </ul>
              {dailyBrief?.bottomLine && (
                <div className="mt-4 rounded-xl bg-bg-primary p-4 text-sm text-white">
                  <p className="text-xs uppercase tracking-wide text-content-muted">Bottom line</p>
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
