import { Fragment, useMemo, useState } from 'react';
import { Search, FileText, AlertTriangle, ExternalLink, BookOpen, ChevronRight } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, Skeleton, StatTile } from '../../design-system';
import { useSourceExplorer } from '../../hooks/useMasterPlan';

const fmt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN');
};

const FACT_TYPE_TONES = {
  rmp_table: 'info',
  sdz: 'warn',
  heritage: 'warn',
  environmental: 'success',
  road_network: 'info',
  land_use_share: 'info',
  land_use_total: 'info',
  landmark: 'neutral',
  boundary: 'neutral',
};

function factTypeBadge(type) {
  return FACT_TYPE_TONES[type] || 'neutral';
}

function shortValue(value) {
  if (value == null) return '—';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') {
    // Pull a primary scalar if present, else key count
    const scalar = ['value', 'name', 'label', 'pd_code'].find((k) => value[k] != null);
    if (scalar) return String(value[scalar]);
    return `${Object.keys(value).length} fields`;
  }
  const str = String(value);
  return str.length > 80 ? `${str.slice(0, 77)}…` : str;
}

function PanelSkeleton() {
  return (
    <Card elevated className="p-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-40 rounded" />
        <Skeleton className="h-5 w-2/3 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
          <Skeleton className="h-20 w-full rounded" />
          <Skeleton className="h-20 w-full rounded" />
          <Skeleton className="h-20 w-full rounded" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 pt-3">
          <Skeleton className="h-96 w-full rounded lg:col-span-1" />
          <Skeleton className="h-96 w-full rounded lg:col-span-2" />
        </div>
      </div>
      <span className="sr-only">Loading source explorer</span>
    </Card>
  );
}

function groupFactsByPage(facts) {
  const map = new Map();
  for (const f of facts || []) {
    const pageKey = f.page_number == null ? 'unpaged' : String(f.page_number);
    const arr = map.get(pageKey) || [];
    arr.push(f);
    map.set(pageKey, arr);
  }
  // Sorted: numeric pages ascending, "unpaged" last.
  const numeric = [...map.entries()]
    .filter(([k]) => k !== 'unpaged')
    .sort(([a], [b]) => Number(a) - Number(b));
  const unpaged = map.get('unpaged');
  if (unpaged) numeric.push(['unpaged', unpaged]);
  return numeric;
}

export default function SourceExplorerPanel() {
  const { data, isLoading, isError } = useSourceExplorer();
  const [selectedSourceId, setSelectedSourceId] = useState(null);
  const [search, setSearch] = useState('');

  const sources = data?.sources || [];
  const summary = data?.summary || {};

  const filteredSources = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return sources;
    return sources.filter(
      (src) =>
        (src.source_title || '').toLowerCase().includes(s)
        || (src.plan_version || '').toLowerCase().includes(s)
        || (src.plan_name || '').toLowerCase().includes(s),
    );
  }, [sources, search]);

  const selectedSource = useMemo(() => {
    if (!sources.length) return null;
    if (selectedSourceId) {
      const found = sources.find((s) => s.id === selectedSourceId);
      if (found) return found;
    }
    // Auto-select first non-empty source.
    return filteredSources[0] || sources[0];
  }, [sources, filteredSources, selectedSourceId]);

  const pages = useMemo(
    () => (selectedSource ? groupFactsByPage(selectedSource.facts) : []),
    [selectedSource],
  );

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load source explorer">
        Try refreshing. If the problem persists, the master-plan service may be unavailable.
      </ErrorState>
    );
  }

  if (!sources.length) {
    return (
      <ErrorState tone="info" title="No facts have been extracted yet">
        Once a source document has been ingested and at least one fact extracted, every fact will appear here grouped by page.
      </ErrorState>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Citation index"
        title="Source Explorer — every fact, mapped to its source page"
        sub="Pick a source on the left to see every extracted fact grouped by the exact page it came from. Use this to defend any number Acureal shows: each row links back to a specific document and page, with the fact-type tag and confidence score."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Sources with facts" value={fmt(summary.source_count)} footnote="Distinct ingest events" />
        <StatTile label="Extracted facts" value={fmt(summary.fact_count)} footnote="Linked to a source page" />
        <StatTile label="Linked documents" value={fmt(summary.linked_doc_count)} footnote="With a downloadable PDF" />
        <StatTile label="Fact types" value={fmt(Object.keys(summary.fact_type_counts || {}).length)} footnote="Categories represented" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Source list (left rail) */}
        <Card elevated className="p-3 lg:col-span-1">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sources"
              className="w-full pl-9 pr-3 py-2 text-sm bg-bg-secondary border border-hairline rounded-md text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 transition-all duration-120"
              aria-label="Search sources"
            />
          </div>
          <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-2 px-1 font-medium">
            {filteredSources.length} of {sources.length} sources
          </div>
          <ul role="listbox" aria-label="Source list" className="space-y-1 max-h-[28rem] overflow-y-auto">
            {filteredSources.map((src) => {
              const active = selectedSource?.id === src.id;
              return (
                <li key={src.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelectedSourceId(src.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-md transition-colors duration-120 border ${
                      active
                        ? 'bg-bg-secondary border-hairline ring-1 ring-accent-primary/30'
                        : 'border-transparent hover:bg-bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <FileText size={12} className="mt-0.5 text-content-muted shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="text-sm text-content-primary leading-snug truncate">
                            {src.source_title}
                          </div>
                          <div className="text-[11px] text-content-muted mt-0.5 leading-snug">
                            {src.plan_version || src.source_kind}
                            {src.first_page && ` · pp.${src.first_page}–${src.last_page}`}
                          </div>
                        </div>
                      </div>
                      <span className="text-[11px] tabular-nums text-content-muted shrink-0 mt-0.5">
                        {src.fact_count}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Fact pane (right) */}
        <div className="lg:col-span-2 space-y-3">
          {selectedSource ? (
            <>
              <Card elevated className="p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1 font-medium">
                      {selectedSource.plan_version || selectedSource.source_kind}
                    </div>
                    <h3 className="font-display text-base font-semibold text-content-primary leading-tight">
                      {selectedSource.source_title}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {selectedSource.legal_status && (
                        <Badge tone={selectedSource.legal_status === 'gazetted' ? 'success' : 'neutral'}>
                          {selectedSource.legal_status}
                        </Badge>
                      )}
                      {selectedSource.processing_mode && (
                        <Badge tone="neutral">{selectedSource.processing_mode}</Badge>
                      )}
                      {selectedSource.fact_types?.slice(0, 3).map((ft) => (
                        <Badge key={ft} tone={factTypeBadge(ft)}>{ft}</Badge>
                      ))}
                      {selectedSource.fact_types?.length > 3 && (
                        <span className="text-[11px] text-content-muted">+{selectedSource.fact_types.length - 3}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted font-medium">
                      Facts
                    </div>
                    <div className="text-2xl font-display font-semibold tabular-nums text-content-primary">
                      {selectedSource.fact_count}
                    </div>
                    <div className="text-[11px] text-content-muted">
                      {selectedSource.page_count} page{selectedSource.page_count === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </Card>

              <Card elevated className="p-0 overflow-hidden">
                <div className="max-h-[32rem] overflow-y-auto">
                  {pages.map(([pageKey, facts]) => (
                    <Fragment key={pageKey}>
                      <div className="sticky top-0 z-10 bg-bg-elevated border-b border-hairline px-4 py-1.5 flex items-center gap-2 text-eyebrow uppercase tracking-[0.08em] text-content-muted font-medium">
                        <BookOpen size={11} />
                        {pageKey === 'unpaged' ? 'Without explicit page' : `Page ${pageKey}`}
                        <span className="ml-auto tabular-nums text-[11px]">{facts.length} fact{facts.length === 1 ? '' : 's'}</span>
                      </div>
                      <ul className="divide-y divide-hairline">
                        {facts.map((f) => (
                          <li key={f.id} className="px-4 py-2.5 hover:bg-bg-secondary/40 transition-colors duration-150">
                            <div className="flex items-start gap-2">
                              <ChevronRight size={11} className="mt-1 text-content-muted shrink-0" aria-hidden="true" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge tone={factTypeBadge(f.fact_type)}>{f.fact_type}</Badge>
                                  <span className="text-sm font-medium text-content-primary">{f.fact_key}</span>
                                  {f.confidence_score != null && (
                                    <span className="text-[11px] tabular-nums text-content-muted">
                                      conf {Number(f.confidence_score).toFixed(2)}
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-content-secondary leading-snug mt-0.5">
                                  {shortValue(f.fact_value)}
                                </div>
                                {f.source_section && (
                                  <div className="text-[11px] text-content-muted mt-0.5">
                                    §{f.source_section}
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Fragment>
                  ))}
                </div>
              </Card>

              {selectedSource.document_id && (
                <div className="text-[11px] text-content-muted flex items-center gap-1.5">
                  <ExternalLink size={11} />
                  This source has a linked PDF in Source Documents — open the Documents tab to download.
                </div>
              )}
            </>
          ) : (
            <ErrorState tone="info" title="No source selected">
              Pick a source from the list to view its facts.
            </ErrorState>
          )}
        </div>
      </div>

      {data?.disclaimer && (
        <div className="text-[11px] text-content-muted flex items-start gap-1.5">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{data.disclaimer}</span>
        </div>
      )}
    </div>
  );
}
