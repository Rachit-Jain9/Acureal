import { useState } from 'react';
import EmptyState from '../common/EmptyState';
import { ShieldAlert, Plus, Trash2, AlertCircle, Loader2, Edit2, X, Check, Sparkles, Brain, Copy, Download } from 'lucide-react';
import { clsx } from 'clsx';
import {
  // PR-NX72: useRiskFlags + useRiskScore dropped — flags + score now read
  // from the shared workspace cache via useDealRedFlags / useDealRiskScore.
  useCreateRiskFlag,
  useUpdateRiskFlag,
  useDeleteRiskFlag,
  useRunInconsistencyCheck,
  useRiskBrief,
} from '../../hooks/useRiskFlags';
import Badge from '../common/Badge';
import AiMarkdown from '../common/AiMarkdown';
import { downloadMarkdown, copyMarkdownToClipboard, buildArtifactFilename } from '../../utils/downloadMarkdown';
import { SectionHeader, SkeletonList, Card } from '../../design-system';
import { useDealContext, useDealRecord, useDealRedFlags, useDealRiskScore } from '../../hooks/useDealContext';
// PR-NX47 (2026-05-19) — surface Claude's risk synthesis (the one that
// ships in the DOCX Risk Register section) inline at the top of the tab.
import RiskNarrativePanel from './RiskNarrativePanel';
// Workstream B — the standing Deal Risk Radar, pinned to the top of the tab.
import RiskRadarPanel from './RiskRadarPanel';
// Workstream B (B4) — promoter / builder track record.
import PromoterProfileCard from './PromoterProfileCard';

const RISK_CATEGORIES = [
  { value: 'title', label: 'Title' },
  { value: 'zoning', label: 'Zoning' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'financial', label: 'Financial' },
  { value: 'physical', label: 'Physical' },
  { value: 'market', label: 'Market' },
  { value: 'legal', label: 'Legal' },
];

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', tone: 'danger',  dot: 'bg-data-negative' },
  high:     { label: 'High',     tone: 'warn',    dot: 'bg-premium' },
  medium:   { label: 'Medium',   tone: 'warn',    dot: 'bg-premium' },
  low:      { label: 'Low',      tone: 'neutral', dot: 'bg-content-muted' },
};

const STATUS_CONFIG = {
  open:     { label: 'Open',      tone: 'danger' },
  flagged:  { label: 'Flagged',   tone: 'warn' },
  mitigated:{ label: 'Mitigated', tone: 'success' },
  resolved: { label: 'Resolved',  tone: 'neutral' },
};

const buildForm = () => ({
  category: 'title',
  severity: 'medium',
  title: '',
  description: '',
  mitigation: '',
  status: 'open',
});

function RiskScoreCard({ score, flagCount }) {
  const label =
    score == null
      ? null
      : score <= 30
        ? { text: 'Low Risk', color: 'text-green-600', bg: 'bg-green-500' }
        : score <= 60
          ? { text: 'Moderate Risk', color: 'text-amber-600', bg: 'bg-amber-500' }
          : { text: 'High Risk', color: 'text-red-600', bg: 'bg-red-500' };

  if (score == null && flagCount === 0) return null;

  return (
    <div className="card-editorial">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <ShieldAlert size={16} className={label?.color || 'text-content-muted'} />
          Risk Score
        </h3>
        {label && (
          <span className={clsx('text-sm font-bold', label.color)}>
            {score} — {label.text}
          </span>
        )}
      </div>
      {score != null && (
        <div className="h-2.5 bg-bg-secondary rounded-full overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', label?.bg)}
            style={{ width: `${Math.min(100, score)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-content-muted mt-2">
        {flagCount} risk flag{flagCount !== 1 ? 's' : ''} registered
      </p>
    </div>
  );
}

function RiskFlagCard({ flag, dealId, onDelete, updateFlag }) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);

  const severityCfg = SEVERITY_CONFIG[flag.severity] || SEVERITY_CONFIG.medium;
  const statusCfg = STATUS_CONFIG[flag.status] || STATUS_CONFIG.open;

  const startEdit = () => {
    setEditData({
      title: flag.title || '',
      description: flag.description || '',
      mitigation: flag.mitigation || '',
      status: flag.status || 'open',
      severity: flag.severity || 'medium',
      category: flag.category || 'title',
    });
    setEditing(true);
  };

  const handleSave = () => {
    updateFlag.mutate(
      { dealId, id: flag.id, data: editData },
      { onSuccess: () => setEditing(false) }
    );
  };

  return (
    <div className="card-editorial">
      {editing && editData ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Category</label>
              <select
                value={editData.category}
                onChange={(e) => setEditData((d) => ({ ...d, category: e.target.value }))}
                className="input text-sm"
              >
                {RISK_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Severity</label>
              <select
                value={editData.severity}
                onChange={(e) => setEditData((d) => ({ ...d, severity: e.target.value }))}
                className="input text-sm"
              >
                {Object.entries(SEVERITY_CONFIG).map(([v, cfg]) => (
                  <option key={v} value={v}>{cfg.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Status</label>
              <select
                value={editData.status}
                onChange={(e) => setEditData((d) => ({ ...d, status: e.target.value }))}
                className="input text-sm"
              >
                {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                  <option key={v} value={v}>{cfg.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Title</label>
            <input
              type="text"
              value={editData.title}
              onChange={(e) => setEditData((d) => ({ ...d, title: e.target.value }))}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Description</label>
            <textarea
              value={editData.description}
              onChange={(e) => setEditData((d) => ({ ...d, description: e.target.value }))}
              rows={2}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Mitigation</label>
            <textarea
              value={editData.mitigation}
              onChange={(e) => setEditData((d) => ({ ...d, mitigation: e.target.value }))}
              rows={2}
              className="input text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="btn btn-secondary text-sm flex items-center gap-1"
            >
              <X size={13} /> Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={updateFlag.isPending}
              className="btn btn-primary text-sm flex items-center gap-1.5"
            >
              {updateFlag.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={clsx('w-2 h-2 rounded-full flex-shrink-0 mt-1', severityCfg.dot)} />
              <h4 className="text-sm font-semibold text-content-primary">{flag.title}</h4>
              <Badge tone={severityCfg.tone}>{severityCfg.label}</Badge>
              <Badge tone={statusCfg.tone}>{statusCfg.label}</Badge>
              <Badge>
                {RISK_CATEGORIES.find((item) => item.value === flag.category)?.label || flag.category}
              </Badge>
              {flag.source === 'ai_detector' && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-accent-soft text-accent border border-accent/20"
                  title="Detected by the cross-document inconsistency detector"
                >
                  <Sparkles size={9} />
                  AI
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={startEdit}
                className="p-1.5 text-content-muted hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                title="Edit"
              >
                <Edit2 size={13} />
              </button>
              <button
                onClick={() => onDelete(flag.id)}
                className="p-1.5 text-content-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {flag.description && (
            <p className="text-sm text-content-secondary mb-2">{flag.description}</p>
          )}
          {flag.mitigation && (
            <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              <p className="text-xs font-medium text-green-700 mb-0.5">Mitigation</p>
              <p className="text-sm text-green-800">{flag.mitigation}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function RiskTab() {
  // PR-NX72 (2026-05-19) — Phase A1.1: RiskTab read path migrated to the
  // shared workspace cache via useDealRedFlags + useDealRiskScore selectors.
  // Mutations stay on per-domain hooks but already invalidate
  // `['deal-workspace', dealId]` so the cache refreshes automatically.
  const { dealId, isLoading, isError, refetch } = useDealContext();
  const flags = useDealRedFlags();
  const scoreData = useDealRiskScore();
  const createFlag = useCreateRiskFlag();
  const updateFlag = useUpdateRiskFlag();
  const deleteFlag = useDeleteRiskFlag();
  // Tier-1 #4 — cross-document inconsistency detector hooks.
  const runInconsistencyCheck = useRunInconsistencyCheck();
  const { data: brief } = useRiskBrief(dealId);
  const [briefExpanded, setBriefExpanded] = useState(true);
  const [briefCopied, setBriefCopied] = useState(false);
  const dealRecord = useDealRecord();
  const dealName = dealRecord?.name;

  const handleBriefCopy = async () => {
    if (!brief?.contentMd) return;
    const ok = await copyMarkdownToClipboard(brief.contentMd);
    if (ok) {
      setBriefCopied(true);
      setTimeout(() => setBriefCopied(false), 1800);
    }
  };

  const handleBriefDownload = () => {
    if (!brief?.contentMd) return;
    downloadMarkdown(brief.contentMd, buildArtifactFilename(dealName, 'risk-brief'));
  };

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(buildForm());

  // PR-NX72: `flags` is now provided directly by useDealRedFlags() (handles
  // shape coercion + null fallback internally). Removed the redundant
  // runtime array-coercion block.
  const score = scoreData?.score ?? null;

  // Group by category
  const grouped = RISK_CATEGORIES.reduce((acc, cat) => {
    const catFlags = flags.filter((f) => (f.category || 'title') === cat.value);
    if (catFlags.length > 0) acc[cat.value] = catFlags;
    return acc;
  }, {});

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createFlag.mutateAsync({ dealId, data: form });
      setForm(buildForm());
      setShowForm(false);
    } catch {
      // handled
    }
  };

  const handleDelete = (flagId) => {
    if (!window.confirm('Remove this risk flag?')) return;
    deleteFlag.mutate({ dealId, id: flagId });
  };

  if (isLoading) return <div className="py-2"><SkeletonList rows={4} columns={4} /></div>;

  if (isError) {
    return (
      <div className="card-editorial text-center py-12">
        <AlertCircle size={28} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-3">Failed to load risk flags.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Risk Radar — standing deterministic pre-mortem across failure modes. */}
      <RiskRadarPanel dealId={dealId} />

      {/* Promoter & Execution — the verified builder track record (B4). */}
      <PromoterProfileCard dealId={dealId} />

      {/* Risk Score */}
      <RiskScoreCard score={score} flagCount={flags.length} />

      {/* PR-NX47 (2026-05-19) — AI risk-profile synthesis. Same Claude
          narrative as the DOCX Risk Register section (PR-NX43). Renders
          NOTHING when no risks are logged or all are closed — defers
          to the existing RiskScoreCard / table for that empty state. */}
      <RiskNarrativePanel dealId={dealId} />

      {/* Add Flag */}
      <SectionHeader
        size="sm"
        title="Risk Flags"
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runInconsistencyCheck.mutate(dealId)}
              disabled={runInconsistencyCheck.isPending}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md',
                'border border-hairline bg-bg-elevated text-content-primary',
                'hover:bg-bg-secondary transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                'disabled:opacity-50',
              )}
              title="Scan all uploaded extractions for cross-document contradictions and flag them as risks"
            >
              {runInconsistencyCheck.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} className="text-accent" />
              )}
              {runInconsistencyCheck.isPending ? 'Scanning…' : 'Run AI inconsistency check'}
            </button>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="btn btn-primary text-sm flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add Risk Flag
            </button>
          </div>
        }
      />

      {/* AI risk brief — most recent narrative synthesised by Claude
          from the deterministic findings. Only renders when an artifact
          exists. Expandable so the page stays tight when collapsed. */}
      {brief?.contentMd && (
        <Card className="p-4 border-accent/20 bg-accent-soft/30">
          <button
            type="button"
            onClick={() => setBriefExpanded((v) => !v)}
            className="w-full flex items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
            aria-expanded={briefExpanded}
          >
            <div className="shrink-0 w-8 h-8 rounded-md bg-accent text-white flex items-center justify-center mt-0.5">
              <Brain size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-eyebrow uppercase text-content-muted mb-0.5 font-medium">
                AI Risk Brief
              </div>
              <div className="text-sm font-medium text-content-primary">
                Cross-document inconsistencies — {new Date(brief.generatedAt).toLocaleString('en-IN')}
              </div>
            </div>
            <span className="shrink-0 text-xs text-content-muted">
              {briefExpanded ? 'Hide' : 'Show'}
            </span>
          </button>
          {briefExpanded && (
            <>
              <div className="mt-3 pl-11">
                <AiMarkdown>{brief.contentMd}</AiMarkdown>
              </div>
              {/* Export actions — Copy + Download .md so analysts can paste
                  the brief into IC decks / risk emails without losing the
                  markdown structure. */}
              <div className="mt-2 pl-11 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBriefCopy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-bg-elevated px-2 py-1 text-[11px] font-medium text-content-secondary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  title="Copy markdown to clipboard"
                >
                  {briefCopied ? <Check size={11} /> : <Copy size={11} />}
                  {briefCopied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={handleBriefDownload}
                  className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-bg-elevated px-2 py-1 text-[11px] font-medium text-content-secondary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  title="Download as a .md file"
                >
                  <Download size={11} />
                  Download
                </button>
              </div>
            </>
          )}
          <p className="pl-11 mt-3 text-[11px] text-content-muted">
            AI-assisted — requires human review. Findings above are sourced from deterministic comparators; the narrative synthesis is generated by Claude.
          </p>
        </Card>
      )}

      {showForm && (
        <div className="card-editorial border-red-100 bg-red-50/20">
          <h4 className="text-sm font-semibold text-content-primary mb-3">New Risk Flag</h4>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="input text-sm"
                >
                  {RISK_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Severity</label>
                <select
                  value={form.severity}
                  onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                  className="input text-sm"
                >
                  {Object.entries(SEVERITY_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="input text-sm"
                >
                  {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Brief risk title..."
                required
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Describe the risk and its potential impact..."
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Mitigation</label>
              <textarea
                value={form.mitigation}
                onChange={(e) => setForm((f) => ({ ...f, mitigation: e.target.value }))}
                rows={2}
                placeholder="How is this risk being managed or mitigated..."
                className="input text-sm"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(buildForm()); }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createFlag.isPending}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {createFlag.isPending && <Loader2 size={13} className="animate-spin" />}
                Add Risk Flag
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Flags List */}
      {flags.length === 0 ? (
        <div className="card-editorial">
          <EmptyState
            size="md"
            icon={ShieldAlert}
            title="No risk flags registered"
            description="Flag title risks, zoning issues, financial exposures, and mitigation plans."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([catKey, catFlags]) => (
            <div key={catKey}>
              <h4 className="text-xs font-semibold text-content-secondary uppercase tracking-wider mb-3">
                {RISK_CATEGORIES.find((item) => item.value === catKey)?.label || catKey}
              </h4>
              <div className="space-y-3">
                {catFlags.map((flag) => (
                  <RiskFlagCard
                    key={flag.id}
                    flag={flag}
                    dealId={dealId}
                    onDelete={handleDelete}
                    updateFlag={updateFlag}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
