import { useEffect, useMemo, useState } from 'react';
import {
  Download, FileSpreadsheet, Loader2, MapPin, Search, ChevronDown,
  ChevronUp, Info, X,
} from 'lucide-react';
import { downloadAxiosResponse } from '../utils/download';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Skeleton } from '../design-system';
import { exportsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// PR-TPL2 (2026-05-15) — Excel Reference Templates page (enhanced)
//
// 19 India-context Excel templates, one per asset class, each supporting
// multiple deal structures. Click any structure → backend generates the
// blank workbook on-demand and streams it as a .xlsx download.
//
// PR-TPL2 enhancements over PR-TPL1:
//   - Search input (filters by label / market context / id)
//   - India-context badges per template (RERA / GST / JDA / LTCG / BBMP)
//   - Expandable "View defaults" section per card — shows the seeded
//     inputs the workbook will be pre-populated with, so the analyst
//     can preview before downloading.
//   - "What's inside every template" hero strip explaining the value prop.
//   - Better visual hierarchy + responsive layout.

const FAMILY_LABELS = {
  development: 'Development',
  income: 'Income / Lease',
};

const FAMILY_TONES = {
  development: 'accent',
  income: 'positive',
};

const ICON_BY_ID = {
  residential_apartments: '🏢',
  villas: '🏡',
  plotted_development: '🟦',
  commercial_office: '🏬',
  retail: '🛍️',
  industrial_warehousing: '🏭',
  hospitality: '🏨',
  mixed_use: '🌆',
  redevelopment: '♻️',
  raw_land: '🌾',
  data_centres: '💾',
  co_living: '🛏️',
  student_housing: '🎓',
  senior_living: '🌅',
  build_to_rent: '🔑',
  logistics_parks: '🚛',
  flex_spaces: '💼',
  sez_business_parks: '🏛️',
  township: '🌇',
};

// India-context tag inference. Each tag maps to a real piece of Indian
// real-estate regulation / market convention that the template's formulas
// incorporate. Tags surface to the operator so they know at a glance what
// India-specific structure the template encodes — a single source of
// confidence that the export isn't generic US/UK pro-forma.
const tagsForTemplate = (t) => {
  const tags = [];
  if (t.family === 'development') tags.push({ key: 'rera', label: 'RERA', tone: 'info' });
  if (t.family === 'development' && t.id !== 'plotted_development' && t.id !== 'raw_land') {
    tags.push({ key: 'gst', label: 'GST 5%', tone: 'neutral' });
  }
  tags.push({ key: 'stamp', label: 'Stamp 6.6%', tone: 'neutral' });
  if (t.supportedDealStructures.some((d) => d.id.startsWith('jda_'))) {
    tags.push({ key: 'jda', label: 'JDA', tone: 'accent' });
  }
  if (t.family === 'income') tags.push({ key: 'usali', label: t.id === 'hospitality' ? 'USALI' : 'LRD-ready', tone: 'positive' });
  if (t.family === 'income') tags.push({ key: 'ltcg', label: 'LTCG 12.5%', tone: 'neutral' });
  if (t.id === 'commercial_office' || t.id === 'retail' || t.id === 'industrial_warehousing') {
    tags.push({ key: 'bbmp', label: 'BBMP UAV', tone: 'info' });
  }
  return tags;
};

// Curated subset of inputDefaults to show in the preview drawer. The
// builder seeds many more values, but these are the ones an analyst
// most cares about when sanity-checking a template before download.
const DEFAULTS_PREVIEW_KEYS = {
  development: [
    ['saleableAreaSqft', 'Saleable area', 'sqft', (v) => v.toLocaleString('en-IN')],
    ['sellingRatePerSqft', 'Selling rate', '₹/sqft', (v) => `₹${v.toLocaleString('en-IN')}`],
    ['landCostCr', 'Land cost', '₹ Cr', (v) => `₹${v} Cr`],
    ['constructionCostPerSqft', 'Construction', '₹/sqft', (v) => `₹${v.toLocaleString('en-IN')}`],
    ['salesVelocityPct', 'Sales velocity', '%/quarter', (v) => `${(v * 100).toFixed(0)}%`],
    ['customerCollectionPct', 'Collection (RERA)', '% of contracted', (v) => `${(v * 100).toFixed(0)}%`],
    ['gstPct', 'GST rate', '%', (v) => `${(v * 100).toFixed(1)}%`],
    ['debtLTV', 'Debt LTV', '%', (v) => `${(v * 100).toFixed(0)}%`],
    ['debtRatePct', 'Debt rate', '% / yr', (v) => `${(v * 100).toFixed(1)}%`],
    ['discountRatePct', 'Discount rate', '% / yr', (v) => `${(v * 100).toFixed(0)}%`],
  ],
  income: [
    ['saleableAreaSqft', 'Leasable area', 'sqft', (v) => v.toLocaleString('en-IN')],
    ['baseRentPerSqftMonth', 'Base rent', '₹/sqft/mo', (v) => `₹${v.toLocaleString('en-IN')}`],
    ['rentEscalationPct', 'Rent escalation', '% / yr', (v) => `${(v * 100).toFixed(0)}%`],
    ['occupancyPct', 'Stabilised occupancy', '%', (v) => `${(v * 100).toFixed(0)}%`],
    ['landCostCr', 'Land cost', '₹ Cr', (v) => `₹${v} Cr`],
    ['constructionCostPerSqft', 'Construction', '₹/sqft', (v) => `₹${v.toLocaleString('en-IN')}`],
    ['exitCapRate', 'Exit cap rate', '%', (v) => `${(v * 100).toFixed(1)}%`],
    ['debtLTV', 'Debt LTV', '%', (v) => `${(v * 100).toFixed(0)}%`],
    ['debtRatePct', 'Debt rate', '% / yr', (v) => `${(v * 100).toFixed(1)}%`],
    ['discountRatePct', 'Discount rate', '% / yr', (v) => `${(v * 100).toFixed(0)}%`],
  ],
};

export default function TemplatesPage() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data } = await exportsAPI.templateCatalog();
        if (!cancelled) setCatalog(data?.templates || []);
      } catch (err) {
        toast.error(err?.response?.data?.message || err?.message || 'Failed to load templates.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.filter((t) => {
      if (filter !== 'all' && t.family !== filter) return false;
      if (!q) return true;
      return (
        t.label.toLowerCase().includes(q)
        || t.id.toLowerCase().includes(q)
        || (t.description || '').toLowerCase().includes(q)
        || (t.marketContext || '').toLowerCase().includes(q)
      );
    });
  }, [catalog, filter, search]);

  const counts = useMemo(() => {
    if (!catalog) return { all: 0, development: 0, income: 0 };
    return {
      all: catalog.length,
      development: catalog.filter((t) => t.family === 'development').length,
      income: catalog.filter((t) => t.family === 'income').length,
    };
  }, [catalog]);

  const handleDownload = async (assetClass, dealStructure, label) => {
    const downloadKey = `${assetClass}-${dealStructure}`;
    setDownloading(downloadKey);
    try {
      const response = await exportsAPI.templateXlsx(assetClass, dealStructure);
      downloadAxiosResponse(response, `redip-template-${assetClass}-${dealStructure}.xlsx`);
      toast.success(`Downloaded ${label}`);
    } catch (err) {
      let message = 'Download failed.';
      if (err?.response?.data instanceof Blob) {
        try { const text = await err.response.data.text(); message = JSON.parse(text).message || text; }
        catch { /* keep default */ }
      } else if (err?.response?.data?.message) {
        message = err.response.data.message;
      }
      toast.error(message);
    } finally {
      setDownloading(null);
    }
  };

  const toggleExpand = (id) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Excel Reference Templates"
        subtitle="19 India-context, RERA-aware, fully formula-driven Excel templates. One per asset class with multiple deal-structure variants. Download, edit, model."
      />

      {/* Hero strip — what's inside every template */}
      <div className="rounded-xl border border-hairline bg-gradient-to-br from-bg-primary to-bg-secondary p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <HeroCallout
            icon="🇮🇳"
            title="India-native"
            body="RERA escrow 70/30, GST 5%/1%/0%, Karnataka stamp 6.6%, BBMP UAV property tax, LTCG 12.5% post-Jul-2024."
          />
          <HeroCallout
            icon="⚡"
            title="Fully formula-driven"
            body="Every cell references the Inputs sheet. Edit one input and Dashboard, Cash Flow, Sensitivity, Tornado all recalculate live."
          />
          <HeroCallout
            icon="📊"
            title="Investor-grade"
            body="USALI hospitality engine, FCFE-basis IRR, kernel-vs-modeled reconciliation, Post-Tax IRR, sensitivity heatmap + tornado."
          />
          <HeroCallout
            icon="🏗️"
            title="65 variants"
            body="19 asset classes × 3-5 deal structures each. JDA / DM / Outright / Platform / Forward / BTS / Sale-Leaseback."
          />
        </div>
      </div>

      {/* Filter + search bar */}
      <div className="flex flex-col items-stretch gap-3 border-b border-hairline pb-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {['all', 'development', 'income'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filter === key
                  ? 'bg-accent text-ink-deep'
                  : 'text-content-secondary hover:text-content-primary hover:bg-bg-secondary'
              }`}
            >
              {key === 'all' ? 'All' : FAMILY_LABELS[key]}
              <span className="ml-1.5 text-xs opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-tertiary" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by asset class, market…"
            className="w-full rounded-md border border-hairline bg-bg-primary py-1.5 pl-8 pr-8 text-sm text-content-primary placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-72"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-content-tertiary hover:text-content-primary"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Template grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline-strong bg-bg-secondary px-4 py-10 text-center text-sm text-content-secondary">
          {search ? `No templates match "${search}".` : 'No templates match the current filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isExpanded={!!expanded[template.id]}
              onToggleExpand={() => toggleExpand(template.id)}
              onDownload={handleDownload}
              isDownloading={(structureId) => downloading === `${template.id}-${structureId}`}
            />
          ))}
        </div>
      )}

      {/* Footer note */}
      <div className="rounded-lg border border-hairline bg-bg-secondary px-4 py-3 text-xs text-content-secondary">
        <strong className="text-content-primary">How to use:</strong> Download any variant → open in Excel / Google Sheets / LibreOffice → all formulas evaluate on load (full recalc forced). Edit the yellow input cells on the <em>Inputs &amp; Assumptions</em> sheet. The Dashboard, Cash Flow Engine, Sensitivity, Tornado, and Sources &amp; Uses all update live. <strong className="text-content-primary">Note:</strong> Templates carry realistic Bengaluru-priority defaults — refine for your specific deal before any IC-grade reliance.
      </div>
    </div>
  );
}

function HeroCallout({ icon, title, body }) {
  return (
    <div className="flex items-start gap-2">
      <div className="text-xl leading-none">{icon}</div>
      <div className="min-w-0">
        <div className="font-semibold text-content-primary text-sm">{title}</div>
        <div className="text-xs text-content-secondary leading-snug mt-0.5">{body}</div>
      </div>
    </div>
  );
}

function TemplateCard({ template, isExpanded, onToggleExpand, onDownload, isDownloading }) {
  const icon = ICON_BY_ID[template.id] || '📄';
  const familyTone = FAMILY_TONES[template.family] || 'neutral';
  const tags = tagsForTemplate(template);
  const previewKeys = DEFAULTS_PREVIEW_KEYS[template.family] || [];

  return (
    <div className="group relative rounded-xl border border-hairline bg-bg-primary p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 pb-2">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-secondary text-2xl">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-content-primary leading-tight">{template.label}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={familyTone}>{FAMILY_LABELS[template.family]}</Badge>
              {template.projectDurationMonths && (
                <span className="text-xs text-content-tertiary">
                  {Math.round(template.projectDurationMonths / 12)}-yr horizon
                </span>
              )}
            </div>
          </div>
        </div>
        <FileSpreadsheet className="h-5 w-5 text-content-tertiary opacity-60 transition-opacity group-hover:opacity-100" />
      </div>

      {/* India-context badge strip */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-2">
          {tags.map((tag) => (
            <span
              key={tag.key}
              className="inline-flex items-center rounded-md bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-content-tertiary border border-hairline"
            >
              {tag.label}
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      <p className="text-sm text-content-secondary leading-snug pb-2">
        {template.description}
      </p>

      {/* India market context */}
      {template.marketContext && (
        <div className="flex items-start gap-1.5 text-xs text-content-tertiary pb-3">
          <MapPin className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>{template.marketContext}</span>
        </div>
      )}

      {/* Defaults preview drawer */}
      {previewKeys.length > 0 && (
        <div className="border-t border-hairline pt-3 pb-3">
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex w-full items-center justify-between text-xs font-medium text-content-secondary hover:text-content-primary"
          >
            <span className="inline-flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" />
              {isExpanded ? 'Hide' : 'Preview'} defaults
            </span>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {isExpanded && (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {previewKeys.map(([key, label, _unit, fmt]) => {
                const raw = template.inputDefaults?.[key];
                if (raw === undefined || raw === null) return null;
                return (
                  <div key={key} className="flex items-center justify-between gap-2 border-b border-hairline pb-1">
                    <dt className="text-content-tertiary truncate">{label}</dt>
                    <dd className="font-mono text-content-primary whitespace-nowrap">{fmt(raw)}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      )}

      {/* Deal structure buttons */}
      <div className="border-t border-hairline pt-3">
        <div className="text-xs font-medium text-content-tertiary uppercase tracking-wide pb-2">
          Download variant
        </div>
        <div className="flex flex-wrap gap-1.5">
          {template.supportedDealStructures.map((structure) => (
            <button
              key={structure.id}
              type="button"
              disabled={isDownloading(structure.id)}
              onClick={() => onDownload(template.id, structure.id, `${template.label} — ${structure.label}`)}
              title={structure.description}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-bg-secondary px-2.5 py-1.5 text-xs font-medium text-content-primary transition-colors hover:bg-accent hover:text-ink-deep disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading(structure.id) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {structure.label}
            </button>
          ))}
        </div>

        {/* Exit strategy hint */}
        {template.supportedExitStrategies.length > 0 && (
          <div className="mt-3 text-xs text-content-tertiary">
            <span className="font-medium">Exit strategies:</span>{' '}
            {template.supportedExitStrategies.map((es) => es.label).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
