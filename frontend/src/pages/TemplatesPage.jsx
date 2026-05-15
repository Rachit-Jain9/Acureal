import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, MapPin, Building2 } from 'lucide-react';
import { downloadAxiosResponse } from '../utils/download';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Skeleton } from '../design-system';
import { exportsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// PR-TPL (2026-05-15) — Reference Templates page
//
// 19 India-context Excel templates, one per asset class, each supporting
// multiple deal structures. Click a template → backend generates the
// blank workbook on-demand and streams it as a .xlsx download. Templates
// are formula-driven (not static), so the same dynamic Dashboard / Cash
// Flow / Sensitivity / Tornado engine that powers deal exports also
// powers the reference templates — single source of truth.

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

export default function TemplatesPage() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [downloading, setDownloading] = useState(null);

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
    if (filter === 'all') return catalog;
    return catalog.filter((t) => t.family === filter);
  }, [catalog, filter]);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Excel Reference Templates"
        subtitle="19 India-context, RERA-aware, fully formula-driven Excel templates. One per asset class with multiple deal-structure variants. Download, edit, model."
      />

      {/* Family filter strip */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline pb-3">
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
            {key === 'all' ? `All Templates (${catalog?.length || 0})` : FAMILY_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Template grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline-strong bg-bg-secondary px-4 py-10 text-center text-sm text-content-secondary">
          No templates match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onDownload={handleDownload}
              isDownloading={(structureId) => downloading === `${template.id}-${structureId}`}
            />
          ))}
        </div>
      )}

      {/* Footer note */}
      <div className="rounded-lg border border-hairline bg-bg-secondary px-4 py-3 text-xs text-content-secondary">
        <strong className="text-content-primary">Note:</strong> Templates use realistic Bengaluru-priority defaults. Every cell is formula-driven and references the Inputs sheet — edit any input and the Dashboard, Cash Flow, Sensitivity, and Tornado charts recalculate live. Templates include India-specific RERA escrow logic, GST + Karnataka stamp duty, LTCG/STCG taxation, and JDA / DM structure economics where applicable.
      </div>
    </div>
  );
}

function TemplateCard({ template, onDownload, isDownloading }) {
  const icon = ICON_BY_ID[template.id] || '📄';
  const familyTone = FAMILY_TONES[template.family] || 'neutral';

  return (
    <div className="group relative rounded-xl border border-hairline bg-bg-primary p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-secondary text-2xl">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-content-primary leading-tight">{template.label}</h3>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={familyTone}>{FAMILY_LABELS[template.family]}</Badge>
              {template.projectDurationMonths && (
                <span className="text-xs text-content-tertiary">
                  {Math.round(template.projectDurationMonths / 12)}-yr hold/build
                </span>
              )}
            </div>
          </div>
        </div>
        <FileSpreadsheet className="h-5 w-5 text-content-tertiary opacity-60 transition-opacity group-hover:opacity-100" />
      </div>

      {/* Description */}
      <p className="text-sm text-content-secondary leading-snug pb-2">
        {template.description}
      </p>

      {/* India context */}
      {template.marketContext && (
        <div className="flex items-start gap-1.5 text-xs text-content-tertiary pb-3">
          <MapPin className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>{template.marketContext}</span>
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
