import { useState } from 'react';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Calendar,
  MapPin,
  BarChart2,
  Lightbulb,
  ChevronDown,
  RefreshCw,
  Save,
  PlusCircle,
  Trash2,
  Lock,
  ArrowUpRight,
  Building2,
  DollarSign,
} from 'lucide-react';
import {
  useDailyBrief,
  useMarketNotes,
  useSaveMarketNotes,
  useMarketTransactions,
  useMicroMarketBenchmarks,
} from '../hooks/useIntelligence';
import LoadingSpinner from '../components/common/LoadingSpinner';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { formatPct, formatCrores, formatDate, STAGE_CONFIG } from '../utils/format';
import useAuthStore from '../store/authStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionCard({ icon: Icon, title, children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl border border-hairline-strong shadow-sm overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-5 py-3 border-b border-hairline bg-bg-secondary">
        <Icon size={16} className="text-content-secondary" />
        <h3 className="text-sm font-semibold text-content-primary">{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function UnconfiguredNotice({ requirements }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800">Internal pipeline data — external inventory feeds not yet configured</p>
          <p className="text-xs text-amber-700 mt-1">
            REDIP will not generate external absorption/inventory claims until verified live feeds are connected. Verified transaction data from public sources is displayed separately below.
          </p>
          {requirements?.length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-2 flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 font-medium"
            >
              <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              {open ? 'Hide' : 'Show'} required sources
            </button>
          )}
          {open && (
            <ul className="mt-2 space-y-1">
              {requirements.map((req) => (
                <li key={req.key} className="text-xs text-amber-700">
                  <span className="font-medium">{req.label}</span> — {req.purpose}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

const formatQuantum = (mn) => {
  if (!mn) return '—';
  const cr = mn / 100;
  return cr >= 1000
    ? `₹${(cr / 1000).toFixed(2)} TCr`
    : `₹${cr.toFixed(0)} Cr`;
};

const formatLandSize = (acres, note) => {
  if (!acres && !note) return '—';
  if (note && !acres) return note;
  if (acres && note) return `${acres} ac · ${note}`;
  return `${acres} ac`;
};

const DEAL_TYPE_BADGE = {
  'Land deal':        'bg-blue-100 text-blue-700',
  'Equity investment':'bg-emerald-100 text-emerald-700',
  'Debt':             'bg-amber-100 text-amber-700',
};

// ─── Admin Market Notes Editor ─────────────────────────────────────────────────

const SECTION_META = {
  micro_market: { label: 'Micro-Market Intelligence', placeholder: 'e.g. Whitefield absorption strong; 15,000–16,000/sqft bracket holding up.' },
  slowdown:     { label: 'Demand Slowdown Indicators', placeholder: 'e.g. Affordable segment (sub-8,000/sqft) showing 18% longer days-on-market vs Q3.' },
  strategic:    { label: 'Strategic Takeaways', placeholder: 'e.g. Prioritise Sarjapur and Whitefield for residential underwriting; avoid oversupplied ORR mid-market.' },
};

function NotesEditor({ section, initialItems, onSave, saving }) {
  const [items, setItems] = useState(initialItems || []);
  const [newItem, setNewItem] = useState('');

  const add = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    setItems((prev) => [...prev, trimmed]);
    setNewItem('');
  };

  const remove = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 rounded-lg bg-bg-secondary px-3 py-2 text-sm text-content-primary">
            <span className="flex-1">{item}</span>
            <button type="button" onClick={() => remove(idx)} className="text-content-muted hover:text-red-500 flex-shrink-0 mt-0.5">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-xs text-content-muted italic">No items yet. Add your first observation below.</li>
        )}
      </ul>
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={SECTION_META[section]?.placeholder}
          className="flex-1 rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!newItem.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-bg-secondary px-3 py-2 text-sm font-medium text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
        >
          <PlusCircle size={14} />
          Add
        </button>
      </div>
      <button
        type="button"
        onClick={() => onSave(items)}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-bg-primary disabled:opacity-50"
      >
        {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
        Save section
      </button>
    </div>
  );
}

function AdminNotesPanel() {
  const { data: marketNotes, isLoading } = useMarketNotes();
  const saveNotes = useSaveMarketNotes();
  const [openSection, setOpenSection] = useState(null);
  const [savingSection, setSavingSection] = useState(null);

  const handleSave = async (section, items) => {
    setSavingSection(section);
    try { await saveNotes.mutateAsync({ section, items }); }
    finally { setSavingSection(null); }
  };

  if (isLoading) return <p className="text-sm text-content-secondary">Loading notes...</p>;

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Lock size={15} className="text-blue-600" />
        <p className="text-sm font-semibold text-blue-800">Admin — Market Notes Editor</p>
        <span className="ml-auto text-xs text-blue-500">Only admins can edit</span>
      </div>
      <p className="text-xs text-blue-700 mb-4">
        Notes entered here appear in the intelligence brief and are stored in the database. No external data is fabricated — only what you enter here is surfaced.
      </p>
      <div className="space-y-3">
        {Object.entries(SECTION_META).map(([sectionKey, meta]) => (
          <div key={sectionKey} className="rounded-lg bg-white border border-blue-100">
            <button
              type="button"
              onClick={() => setOpenSection(openSection === sectionKey ? null : sectionKey)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-content-primary hover:bg-bg-secondary rounded-lg"
            >
              {meta.label}
              <ChevronDown size={14} className={`text-content-muted transition-transform ${openSection === sectionKey ? 'rotate-180' : ''}`} />
            </button>
            {openSection === sectionKey && (
              <div className="px-4 pb-4">
                <NotesEditor
                  section={sectionKey}
                  initialItems={marketNotes?.[sectionKey] || []}
                  onSave={(items) => handleSave(sectionKey, items)}
                  saving={savingSection === sectionKey}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Market Transaction Table ──────────────────────────────────────────────────

function TransactionTable({ rows }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 10);

  return (
    <div>
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-xs border-collapse min-w-[800px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">FY / Q</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Type</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary">Buyer / Borrower</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary">Seller / Lender</th>
              <th className="text-right py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Quantum</th>
              <th className="text-right py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Land / Size</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary">Locality</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary max-w-[200px]">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={row.id || i} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                <td className="py-2 px-3 font-mono text-content-secondary whitespace-nowrap">
                  {row.fiscal_year} {row.quarter}
                </td>
                <td className="py-2 px-3 whitespace-nowrap">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DEAL_TYPE_BADGE[row.deal_type] || 'bg-bg-secondary text-content-secondary'}`}>
                    {row.deal_type}
                  </span>
                </td>
                <td className="py-2 px-3 text-content-primary max-w-[180px]">
                  <span className="line-clamp-2">{row.buyer || '—'}</span>
                </td>
                <td className="py-2 px-3 text-content-secondary max-w-[160px]">
                  <span className="line-clamp-2">{row.investor_lender || row.seller || '—'}</span>
                </td>
                <td className="py-2 px-3 text-right font-semibold text-content-primary whitespace-nowrap">
                  {formatQuantum(row.quantum_inr_mn)}
                </td>
                <td className="py-2 px-3 text-right text-content-secondary whitespace-nowrap">
                  {formatLandSize(row.land_size_acres, row.project_size_note)}
                </td>
                <td className="py-2 px-3 text-content-secondary whitespace-nowrap">{row.locality || '—'}</td>
                <td className="py-2 px-3 text-content-secondary max-w-[200px]">
                  <span className="line-clamp-2">{row.notes || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 10 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Show less' : `Show all ${rows.length} transactions`}
        </button>
      )}

      <p className="mt-3 text-xs text-content-muted">
        Source: Economic Times, Business Standard, Hindustan Times, Moneycontrol, company press releases.
        All transactions verified from public disclosures. Quantum in ₹ Cr.
      </p>
    </div>
  );
}

// ─── Micro-Market Benchmarks Table ────────────────────────────────────────────

function BenchmarksTable({ rows }) {
  const maxPrice = Math.max(...rows.map((r) => r.avg_price_max_per_sqft || 0));

  return (
    <div>
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-xs border-collapse min-w-[600px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <th className="text-left py-2 px-3 font-semibold text-content-secondary">Micro-Market</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Price Range (₹/sqft)</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">YoY Growth</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary">Anchor Hub</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary w-36">Price Band</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const barPct = maxPrice > 0 ? Math.round((row.avg_price_max_per_sqft / maxPrice) * 100) : 0;
              const growthLabel = row.yoy_growth_min_pct != null
                ? `${row.yoy_growth_min_pct}–${row.yoy_growth_max_pct}%`
                : '—';
              const priceLabel = `₹${(row.avg_price_min_per_sqft / 1000).toFixed(1)}k – ₹${(row.avg_price_max_per_sqft / 1000).toFixed(1)}k`;
              const growthColor = row.yoy_growth_max_pct >= 10
                ? 'text-emerald-600 font-semibold'
                : row.yoy_growth_max_pct >= 7
                  ? 'text-blue-600 font-medium'
                  : 'text-content-secondary';

              return (
                <tr key={row.id || i} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                  <td className="py-2.5 px-3 font-medium text-content-primary">{row.micro_market}</td>
                  <td className="py-2.5 px-3 font-mono text-content-primary whitespace-nowrap">{priceLabel}</td>
                  <td className={`py-2.5 px-3 whitespace-nowrap ${growthColor}`}>{growthLabel}</td>
                  <td className="py-2.5 px-3 text-content-secondary">{row.anchor_hub || '—'}</td>
                  <td className="py-2.5 px-3">
                    <div className="w-full bg-bg-secondary rounded-full h-1.5">
                      <div
                        className="bg-primary-500 h-1.5 rounded-full"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-content-muted">
        Period: {rows[0]?.data_period || '2025–2026'} · Source: verified residential benchmark data, Bengaluru.
      </p>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: brief, isLoading, isError, refetch, isFetching } = useDailyBrief();
  const { data: transactions, isLoading: txLoading } = useMarketTransactions({ city: 'Bengaluru' });
  const { data: benchmarks, isLoading: bmLoading } = useMicroMarketBenchmarks({ city: 'Bengaluru' });
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600 font-medium">Failed to load intelligence brief</p>
        <button onClick={() => refetch()} className="mt-3 btn btn-secondary text-sm">Retry</button>
      </div>
    );
  }

  const notConfigured = brief?.mode === 'verified_data_required';

  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader
        title="Market Intelligence"
        description={`Bengaluru real estate intelligence — ${today}`}
        actions={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {notConfigured && <UnconfiguredNotice requirements={brief?.verifiedSourceRequirements} />}

      {/* Claude AI Brief */}
      {brief?.claudeBrief && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <Brain size={16} className="text-indigo-600" />
            <p className="text-sm font-semibold text-indigo-800">AI Brief — Claude</p>
            <span className="ml-auto text-xs text-indigo-400">Generated from internal pipeline data only</span>
          </div>
          <p className="text-sm text-indigo-900 whitespace-pre-line leading-relaxed">{brief.claudeBrief}</p>
        </div>
      )}

      {/* Row 1: Deal of Day + Key Developments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard icon={TrendingUp} title="1. Deal of the Day">
          {brief?.dealOfDay ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-content-primary">{brief.dealOfDay.headline}</h4>
                {brief.dealOfDay.stage && (
                  <Badge tone={STAGE_CONFIG[brief.dealOfDay.stage]?.tone}>
                    {STAGE_CONFIG[brief.dealOfDay.stage]?.label || brief.dealOfDay.stage}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {brief.dealOfDay.city && (
                  <div className="flex items-center gap-1 text-sm text-content-secondary">
                    <MapPin size={13} /><span>{brief.dealOfDay.city}</span>
                  </div>
                )}
                {brief.dealOfDay.assetClass && (
                  <span className="text-xs rounded-full bg-bg-secondary px-2 py-0.5 text-content-secondary capitalize">
                    {brief.dealOfDay.assetClass.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {brief.dealOfDay.irrPct != null && (
                  <div className="rounded-lg bg-bg-secondary px-3 py-2">
                    <p className="text-xs text-content-secondary">Modeled IRR</p>
                    <p className="text-base font-bold text-content-primary">{formatPct(brief.dealOfDay.irrPct)}</p>
                  </div>
                )}
                {brief.dealOfDay.totalRevenueCr != null && (
                  <div className="rounded-lg bg-bg-secondary px-3 py-2">
                    <p className="text-xs text-content-secondary">Total Revenue</p>
                    <p className="text-base font-bold text-content-primary">{formatCrores(brief.dealOfDay.totalRevenueCr)}</p>
                  </div>
                )}
              </div>
              {brief.dealOfDay.whyItMatters && (
                <p className="text-xs text-content-secondary italic border-l-2 border-primary-300 pl-3">
                  {brief.dealOfDay.whyItMatters}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-content-secondary">No deals in pipeline yet. Add a deal to see it surface here.</p>
          )}
        </SectionCard>

        <SectionCard icon={Calendar} title="2. Key Developments">
          {brief?.keyDevelopments?.length > 0 ? (
            <ul className="space-y-3">
              {brief.keyDevelopments.map((dev, i) => (
                <li key={i} className="border-b border-hairline last:border-0 pb-2 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-content-primary">{dev.headline}</span>
                    {dev.city && <span className="text-xs text-content-muted flex-shrink-0">{dev.city}</span>}
                  </div>
                  {dev.whyItMatters && <p className="text-xs text-content-secondary mt-1">{dev.whyItMatters}</p>}
                  {dev.date && <p className="text-xs text-content-muted mt-0.5">{formatDate(dev.date)}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">No pipeline activity recorded yet.</p>
          )}
        </SectionCard>
      </div>

      {/* Row 2: Market Signals + Micro-Market Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard icon={BarChart2} title="3. Market Signals">
          {brief?.marketSignals ? (
            <div className="space-y-3">
              {brief.marketSignals.bullish?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-emerald-700 mb-1 flex items-center gap-1">
                    <TrendingUp size={12} /> Bullish signals
                  </p>
                  <ul className="space-y-1">
                    {brief.marketSignals.bullish.map((s, i) => (
                      <li key={i} className="text-xs text-content-secondary flex gap-2">
                        <CheckCircle size={11} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {brief.marketSignals.risk?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                    <AlertTriangle size={12} /> Risk signals
                  </p>
                  <ul className="space-y-1">
                    {brief.marketSignals.risk.map((s, i) => (
                      <li key={i} className="text-xs text-content-secondary flex gap-2">
                        <TrendingDown size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {brief.marketSignals.sourceType === 'internal_pipeline_only' && (
                <p className="text-xs text-content-muted italic mt-2">Source: internal pipeline data only</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-content-secondary">No market signals available.</p>
          )}
        </SectionCard>

        <SectionCard icon={MapPin} title="4. Bengaluru Micro-Market Intelligence">
          {brief?.bengaluruMicroMarketIntelligence?.length > 0 ? (
            <ul className="space-y-2">
              {brief.bengaluruMicroMarketIntelligence.map((item, i) => (
                <li key={i} className="text-xs text-content-secondary border-l-2 border-primary-200 pl-3">{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">
              Micro-market intelligence will appear here once admin notes are entered or verified external data sources are configured.
            </p>
          )}
        </SectionCard>
      </div>

      {/* Section 5: Micro-Market Benchmark Summary */}
      <SectionCard icon={DollarSign} title="5. Micro-Market Benchmark Summary — Bengaluru (2025–2026)">
        {bmLoading ? (
          <div className="flex items-center gap-2 text-sm text-content-secondary py-4">
            <RefreshCw size={14} className="animate-spin" /> Loading benchmarks…
          </div>
        ) : benchmarks?.length > 0 ? (
          <BenchmarksTable rows={benchmarks} />
        ) : (
          <p className="text-sm text-content-secondary">
            Run the migration <code className="text-xs bg-bg-secondary px-1 rounded">20260404_market_data.sql</code> in Supabase to load benchmark data.
          </p>
        )}
      </SectionCard>

      {/* Section 6: Market Transaction Flow */}
      <SectionCard icon={ArrowUpRight} title="6. Market Transaction Flow — Bengaluru (FY2025–FY2027)">
        {txLoading ? (
          <div className="flex items-center gap-2 text-sm text-content-secondary py-4">
            <RefreshCw size={14} className="animate-spin" /> Loading transactions…
          </div>
        ) : transactions?.length > 0 ? (
          <TransactionTable rows={transactions} />
        ) : (
          <p className="text-sm text-content-secondary">
            Run the migration <code className="text-xs bg-bg-secondary px-1 rounded">20260404_market_data.sql</code> in Supabase to load transaction data.
          </p>
        )}
      </SectionCard>

      {/* Section 7: Demand Heatmap */}
      {brief?.bengaluruDemandHeatmap?.length > 0 && (
        <SectionCard icon={BarChart2} title="7. Demand Heatmap — Bengaluru Micro-Markets">
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-xs border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary">Micro-Market</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Avg Price (₹/sqft)</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">YoY Growth</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Demand Signal</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary">Anchor Hub</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary max-w-[220px]">Insight</th>
                </tr>
              </thead>
              <tbody>
                {brief.bengaluruDemandHeatmap.map((row, i) => {
                  const signalColor =
                    row.demandSignal === 'Strong'          ? 'bg-emerald-100 text-emerald-700' :
                    row.demandSignal === 'Moderate-High'   ? 'bg-blue-100 text-blue-700' :
                    row.demandSignal === 'Moderate'        ? 'bg-amber-100 text-amber-700' :
                    row.demandSignal === 'Soft'            ? 'bg-red-100 text-red-700' :
                                                             'bg-bg-secondary text-content-secondary';
                  const trendColor = row.pricingTrend && row.pricingTrend !== 'Not available'
                    ? 'text-emerald-600 font-medium' : 'text-content-muted';
                  return (
                    <tr key={i} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                      <td className="py-2.5 px-3 font-medium text-content-primary">{row.microMarket}</td>
                      <td className="py-2.5 px-3 font-mono text-content-primary whitespace-nowrap">
                        {row.avgPriceRange || <span className="text-content-muted">—</span>}
                      </td>
                      <td className={`py-2.5 px-3 whitespace-nowrap ${trendColor}`}>
                        {row.pricingTrend || '—'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${signalColor}`}>
                          {row.demandSignal}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-content-secondary">{row.anchorHub || '—'}</td>
                      <td className="py-2.5 px-3 text-content-secondary max-w-[220px]">
                        <span className="line-clamp-2">{row.insight}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-content-muted">
            Pricing data from verified internal benchmarks (2025–2026). Absorption &amp; inventory data awaiting verified external feed.
          </p>
        </SectionCard>
      )}

      {/* Row 3: Slowdown Indicators + Strategic Takeaways */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard icon={TrendingDown} title="8. Demand Slowdown Indicators">
          {brief?.demandSlowdownIndicators?.length > 0 ? (
            <ul className="space-y-2">
              {brief.demandSlowdownIndicators.map((item, i) => (
                <li key={i} className="text-xs text-content-secondary flex gap-2">
                  <AlertTriangle size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">No slowdown indicators.</p>
          )}
        </SectionCard>

        <SectionCard icon={Lightbulb} title="9. Strategic Takeaways">
          {brief?.strategicTakeaways?.length > 0 ? (
            <ul className="space-y-2">
              {brief.strategicTakeaways.map((item, i) => (
                <li key={i} className="text-xs text-content-secondary flex gap-2">
                  <CheckCircle size={11} className="text-primary-500 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">No strategic takeaways.</p>
          )}
        </SectionCard>
      </div>

      {/* Section 10: Bottom Line */}
      {brief?.bottomLine && (
        <div className="rounded-xl border border-hairline-strong bg-bg-primary px-6 py-4">
          <div className="flex items-start gap-3">
            <Brain size={18} className="text-primary-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-content-muted uppercase tracking-wide mb-1">10. Bottom Line</p>
              <p className="text-sm text-white">{brief.bottomLine}</p>
            </div>
          </div>
        </div>
      )}

      {/* Admin: Market Notes Editor */}
      {isAdmin && (
        <div className="pt-2">
          <AdminNotesPanel />
        </div>
      )}

      <p className="text-xs text-content-muted text-center pb-4">
        Brief generated {today} · Internal pipeline data
        {transactions?.length > 0 ? ` · ${transactions.length} verified market transactions` : ''}
        {benchmarks?.length > 0 ? ` · ${benchmarks.length} micro-market benchmarks` : ''}
        {brief?.claudeBrief ? ' · AI-enhanced' : ''}
      </p>
    </div>
  );
}
