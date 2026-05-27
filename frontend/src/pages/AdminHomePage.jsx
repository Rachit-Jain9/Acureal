import { Link } from 'react-router-dom';
import {
  Map,
  Database,
  Inbox,
  Activity,
  Beaker,
  Sparkles,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import { Card, SectionHeader } from '../design-system';
import { useAiUsage } from '../hooks/useAiUsage';
import { useLearningSignals } from '../hooks/useLearningSignals';
import { useAuditTrail } from '../hooks/useAuditTrail';

/**
 * E7-PR3 — Admin Home / landing
 *
 * One operator-only landing page at /dashboard/admin that ties together the
 * seven admin surfaces with KPI snapshots + click-through. First page the
 * operator hits when clicking "Admin" — answers "what's happening right
 * now across the operations surfaces" without making them visit each
 * sub-page individually.
 *
 * Read-only. No new endpoints — composes the existing three admin
 * dashboard reads (AI usage, learning signals, audit trail) at narrow
 * windows (last 24h / 7d) for the snapshot tiles, and links out for
 * deeper analysis.
 */

const fmt = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-IN'));
const fmtUsd = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);
const fmtPct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

function KpiPill({ label, value, sub, tone = 'neutral' }) {
  const cls = {
    neutral: 'text-content-primary',
    success: 'text-emerald-700',
    warn:    'text-amber-700',
    danger:  'text-rose-700',
  }[tone] || 'text-content-primary';
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">
        {label}
      </div>
      <div className={clsx('text-xl font-display tabular-nums mt-0.5', cls)}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-content-muted mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function AdminTile({ to, icon: Icon, eyebrow, title, sub, kpis = [] }) {
  return (
    <Link
      to={to}
      className="block group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md"
    >
      <Card className="p-5 transition-colors hover:border-accent/40 group-focus-visible:border-accent">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="shrink-0 p-2 rounded-md bg-bg-secondary">
              <Icon size={16} className="text-content-muted group-hover:text-accent transition-colors" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">
                {eyebrow}
              </div>
              <div className="font-display text-base font-semibold text-content-primary truncate group-hover:text-accent transition-colors">
                {title}
              </div>
              {sub && <div className="text-[11px] text-content-muted mt-0.5 leading-snug">{sub}</div>}
            </div>
          </div>
          <ArrowRight size={14} className="shrink-0 text-content-muted group-hover:text-accent transition-colors mt-1" />
        </div>
        {kpis.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {kpis.map((k) => (
              <KpiPill key={k.label} {...k} />
            ))}
          </div>
        )}
      </Card>
    </Link>
  );
}

export default function AdminHomePage() {
  // Three lightweight reads in parallel — these are the same hooks the
  // detail pages use, so React Query dedupes if the operator drills in
  // afterwards.
  const { data: aiUsage } = useAiUsage(1);
  const { data: learningSignals } = useLearningSignals(7);
  const { data: auditTrail } = useAuditTrail({ days: 1, limit: 10 });

  const aiSummary = aiUsage?.summary;
  const lsSummary = learningSignals?.summary;
  const adjustedCount = learningSignals?.active_adjustments?.adjusted_rule_count ?? null;
  const eventsLast24h = auditTrail?.events?.length ?? null;
  const eventCatalog = auditTrail?.event_type_catalog || [];
  const topEventType = eventCatalog[0]?.event_type;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Operations Home"
        sub="Operator-only landing. Click a tile to open the detailed view; each tile shows a live snapshot of its surface."
      />

      <SectionHeader
        size="sm"
        eyebrow="Live snapshots"
        title="Where things stand right now"
        sub="Numbers refresh on focus."
      />

      <div className="grid md:grid-cols-2 gap-3">
        {/* AI Usage */}
        <AdminTile
          to="/dashboard/admin/ai-usage"
          icon={Activity}
          eyebrow="Today"
          title="AI Usage & Cost"
          sub="Cost-guard headroom, latency, cache-hit rate, retry health."
          kpis={[
            { label: 'Spend (24h)',  value: fmtUsd(aiSummary?.total_cost_usd) },
            { label: 'Calls',        value: fmt(aiSummary?.total_calls) },
            { label: 'Cache hit',    value: fmtPct(aiSummary?.cache_hit_rate_pct), tone: aiSummary?.cache_hit_rate_pct >= 30 ? 'success' : 'neutral' },
            { label: 'p95 latency',  value: aiSummary?.p95_latency_ms ? `${Math.round(aiSummary.p95_latency_ms)} ms` : '—' },
          ]}
        />

        {/* Learning Signals */}
        <AdminTile
          to="/dashboard/admin/learning-signals"
          icon={Sparkles}
          eyebrow="Last 7 days"
          title="Learning Signals"
          sub="Verdicts captured + rules currently being de-ranked by the engine."
          kpis={[
            { label: 'Verdicts (7d)',   value: fmt(lsSummary?.total_verdicts) },
            { label: 'Dismiss rate',    value: fmtPct(lsSummary?.dismissed_rate_pct), tone: lsSummary?.dismissed_rate_pct > 60 ? 'warn' : 'neutral' },
            { label: 'Apply rate',      value: fmtPct(lsSummary?.acted_rate_pct), tone: lsSummary?.acted_rate_pct >= 20 ? 'success' : 'neutral' },
            { label: 'De-ranked now',   value: fmt(adjustedCount), tone: adjustedCount > 0 ? 'warn' : 'success' },
          ]}
        />

        {/* Audit Trail */}
        <AdminTile
          to="/dashboard/admin/audit-trail"
          icon={ShieldCheck}
          eyebrow="Last 24h"
          title="Audit Trail"
          sub="HMAC-signed kernel runs across every deal. Filter by event type, deal, or actor."
          kpis={[
            { label: 'Events (24h)', value: fmt(eventsLast24h) },
            { label: 'Top type',     value: topEventType ? topEventType.replace(/_/g, ' ') : '—' },
          ]}
        />

        {/* Comps Review Queue */}
        <AdminTile
          to="/dashboard/admin/comps-queue"
          icon={Inbox}
          eyebrow="Curation"
          title="Comps Review Queue"
          sub="Pending comp submissions awaiting validation, dedupe, and acceptance."
        />

        {/* Parcel Intelligence */}
        <AdminTile
          to="/dashboard/admin/parcel-intelligence"
          icon={Database}
          eyebrow="Curation"
          title="Parcel Intelligence"
          sub="Regulatory evidence promotion, zoning fact verification, source attribution."
        />

        {/* Master Plan */}
        <AdminTile
          to="/dashboard/admin/master-plan"
          icon={Map}
          eyebrow="Curation"
          title="Master Plan"
          sub="Master-plan FAR / setback overlays + the parcel-buildability source data."
        />

        {/* A/B Evaluations */}
        <AdminTile
          to="/dashboard/admin/ab-eval"
          icon={Beaker}
          eyebrow="Quality"
          title="A/B Evaluations"
          sub="Production-config baseline vs experimental routing. Trends the extraction-quality score."
        />
      </div>

      <div className="text-[11px] text-content-muted leading-relaxed pt-2">
        <span className="font-medium">Operator surfaces only.</span>{' '}
        Each tile renders for users with the platform-admin role. Customer-facing pages stay clean — these views are off the export
        surface and the deal workspace per the AI-disclosure policy (CLAUDE.md).
      </div>
    </div>
  );
}
