import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock, Database, FileSearch, PlusCircle, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import Badge from '../components/common/Badge';
import { ErrorState, SkeletonList } from '../design-system';
import {
  useParcelIntelligenceReviewQueue,
  useParcelIntelligenceStatus,
  useCreateAuthorityInput,
  usePromoteEvidenceFactToProperty,
  usePromoteEvidenceFactsToProperty,
  useReviewParcelIntelligenceItem,
  useReviewParcelIntelligenceItems,
} from '../hooks/useParcelIntelligenceAdmin';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'evidence_source', label: 'Sources' },
  { value: 'evidence_fact', label: 'Facts' },
  { value: 'guidance_value', label: 'Guidance Values' },
  { value: 'far_rule', label: 'FAR Rules' },
];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All Statuses' },
];

const TYPE_VALUES = new Set(TYPE_OPTIONS.map((option) => option.value));
const STATUS_VALUES = new Set(STATUS_OPTIONS.map((option) => option.value));

function initialOption(searchParams, key, fallback, allowedValues) {
  const value = searchParams.get(key);
  return allowedValues.has(value) ? value : fallback;
}

function statusTone(status) {
  if (status === 'approved' || status === 'configured' || status === 'parser_available' || status === 'ready') return 'success';
  if (status === 'rejected' || status === 'error' || status === 'action_required' || status === 'unknown') return 'danger';
  if (status === 'not_configured' || status === 'review') return 'warn';
  return 'neutral';
}

function StatusBadge({ status }) {
  const Icon = status === 'approved' || status === 'configured' || status === 'ready' ? CheckCircle2 : status === 'rejected' || status === 'action_required' ? XCircle : Clock;
  return (
    <Badge tone={statusTone(status)} className="gap-1">
      <Icon size={11} />
      {String(status || 'unknown').replace(/_/g, ' ')}
    </Badge>
  );
}

function StatCard({ label, value, sub, icon: Icon = Database }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-content-muted">{label}</div>
          <div className="mt-2 font-display text-2xl font-semibold text-content-primary tabular-nums">{value}</div>
          {sub && <div className="mt-1 text-xs text-content-secondary">{sub}</div>}
        </div>
        <div className="rounded-lg bg-accent-soft p-2 text-accent">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ label, provider }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-content-primary">{label}</div>
          <p className="mt-1 text-xs leading-relaxed text-content-secondary">{provider?.message || 'No status message.'}</p>
        </div>
        <StatusBadge status={provider?.status} />
      </div>
    </div>
  );
}

function SchemaReadinessCard({ schema }) {
  const missing = schema?.missing || [];
  const summary = schema?.summary || {};
  const status = schema?.status || 'unknown';
  const missingCount = Number(summary.missing_critical || 0) + Number(summary.missing_warning || 0);

  return (
    <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 rounded-lg bg-accent-soft p-2 text-accent">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-content-primary">Database Schema Readiness</div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-content-secondary">
              {schema?.message || 'Schema readiness has not been checked yet.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-content-secondary">
              <Badge tone="neutral">{summary.required_relations ?? 0} objects checked</Badge>
              <Badge tone="neutral">{summary.required_columns ?? 0} columns checked</Badge>
              <Badge tone={missingCount ? 'danger' : 'success'}>{missingCount} missing</Badge>
            </div>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {missing.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {missing.slice(0, 4).map((item) => (
            <div key={`${item.type}-${item.name}`} className="rounded-lg border border-hairline bg-neg-soft px-3 py-2 text-xs text-data-negative">
              <div className="font-semibold">{item.label}</div>
              <div className="mt-0.5 truncate opacity-80">{item.name}</div>
            </div>
          ))}
          {missing.length > 4 && (
            <div className="rounded-lg border border-hairline bg-neg-soft px-3 py-2 text-xs font-medium text-data-negative">
              +{missing.length - 4} more missing schema item{missing.length - 4 === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SEVERITY_TONE = { high: 'danger', medium: 'warn', low: 'neutral' };

function RedFlagRulesCard({ rules = [] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rules : rules.slice(0, 4);

  return (
    <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="rounded-lg bg-accent-soft p-2 text-accent">
          <AlertTriangle size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-content-primary">Red Flag Rule Registry</div>
          <p className="mt-0.5 text-xs text-content-secondary">
            {rules.length} deterministic rules evaluated on every parcel snapshot — pure predicates, no AI, no fabrication.
          </p>
        </div>
      </div>
      <div className="divide-y divide-hairline">
        {visible.map((rule) => (
          <div key={rule.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <Badge tone={SEVERITY_TONE[rule.severity] || 'neutral'} className="mt-0.5 shrink-0">
              {rule.severity}
            </Badge>
            <div className="min-w-0">
              <div className="text-sm font-medium text-content-primary">{rule.label}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-content-secondary">{rule.description}</div>
              <div className="mt-1 font-mono text-[10px] text-content-muted">{rule.id}</div>
            </div>
          </div>
        ))}
      </div>
      {rules.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 text-xs font-medium text-accent hover:underline"
        >
          {expanded ? 'Show less' : `Show ${rules.length - 4} more rules`}
        </button>
      )}
    </div>
  );
}

// Last-7-day AI cost / latency / failure rollup. Renders nothing if no calls.
const PROVIDER_LABELS = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
};

function AiUsageCard({ usage }) {
  if (!usage || !usage.providers || usage.providers.length === 0) {
    return (
      <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="rounded-lg bg-bg-secondary p-2 text-content-muted">
            <Activity size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-content-primary">AI usage · last 7 days</div>
            <p className="mt-0.5 text-xs text-content-secondary">
              No AI calls recorded in the last 7 days. Triggers a row when an analyst runs document extraction or refresh.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { totals, providers } = usage;
  const failureTone = totals.failure_rate > 0.05 ? 'danger' : totals.failure_rate > 0.01 ? 'warn' : 'success';

  return (
    <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="rounded-lg bg-accent-soft p-2 text-accent">
          <Activity size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-content-primary">AI usage · last 7 days</div>
          <p className="mt-0.5 text-xs text-content-secondary">
            Per-provider rollup from <span className="font-mono">ai_call_logs</span>. Cost is provider-reported USD; latency is end-to-end including queueing.
          </p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-bg-secondary px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">Calls</div>
          <div className="mt-0.5 font-serif text-2xl tabular-nums text-content-primary">
            {totals.calls.toLocaleString('en-IN')}
          </div>
        </div>
        <div className="rounded-lg bg-bg-secondary px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">Cost</div>
          <div className="mt-0.5 font-serif text-2xl tabular-nums text-content-primary">
            ${totals.total_cost_usd.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-bg-secondary px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">Failure rate</div>
          <div className="mt-0.5 font-serif text-2xl tabular-nums text-content-primary inline-flex items-baseline gap-1.5">
            {(totals.failure_rate * 100).toFixed(1)}%
            <Badge tone={failureTone} className="text-[9px]">
              {totals.failures}/{totals.calls}
            </Badge>
          </div>
        </div>
      </div>

      <div className="divide-y divide-hairline">
        {providers.map((p) => (
          <div key={p.provider} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="text-sm font-medium text-content-primary">
                {PROVIDER_LABELS[p.provider] || p.provider}
              </div>
              <div className="text-[11px] text-content-muted tabular-nums">
                {p.calls.toLocaleString('en-IN')} calls · {p.total_tokens.toLocaleString('en-IN')} tokens
              </div>
            </div>
            <div className="flex items-baseline gap-4 shrink-0 text-[11px] tabular-nums">
              <span title="Median (p50) latency" className="text-content-secondary">
                p50 <span className="font-medium text-content-primary">{p.p50_latency_ms ?? '—'}</span>ms
              </span>
              <span title="95th percentile latency" className="text-content-secondary">
                p95 <span className="font-medium text-content-primary">{p.p95_latency_ms ?? '—'}</span>ms
              </span>
              <span className="text-content-secondary">
                <span className="font-medium text-content-primary">${p.total_cost_usd.toFixed(2)}</span>
              </span>
              {p.failures > 0 && (
                <Badge tone={p.failure_rate > 0.05 ? 'danger' : 'warn'} className="text-[9px]">
                  {(p.failure_rate * 100).toFixed(1)}% fail
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function payloadSummary(payload = {}) {
  const keys = [
    'source_title',
    'city',
    'locality',
    'road_name',
    'sro_name',
    'value_inr_per_sqft',
    'zone_code',
    'planning_zone',
    'base_far',
    'max_far',
    'effective_from',
    'plan_version',
  ];
  return keys
    .filter((key) => payload[key] !== null && payload[key] !== undefined && payload[key] !== '')
    .map((key) => `${key.replace(/_/g, ' ')}: ${payload[key]}`)
    .slice(0, 4)
    .join(' | ');
}

function formatFactValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.map((item) => formatFactValue(item)).join(', ');
  if (typeof value === 'number') return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function promotionReason(promotion) {
  if (!promotion?.supported) return null;
  if (promotion.reason === 'approval_required') return 'Approve before promoting';
  if (promotion.reason === 'already_populated') return `Already set: ${formatFactValue(promotion.current_value)}`;
  if (promotion.reason === 'no_linked_property') return 'No linked property';
  return null;
}

const rowKey = (item) => `${item.type}:${item.id}`;

const PROPERTY_FACT_OPTIONS = [
  ['road_width_mtrs', 'Road width (m)'],
  ['land_area_sqft', 'Land area (sqft)'],
  ['land_area_acres', 'Land area (acres)'],
  ['survey_number', 'Survey number'],
  ['pid', 'PID'],
  ['khata_no', 'Khata no.'],
  ['owner_name', 'Owner name'],
];

const REVIEW_INPUT_OPTIONS = [
  ['approved', 'Approved'],
  ['needs_review', 'Needs Review'],
  ['pending', 'Pending'],
];

function compactPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== '' && value !== null && value !== undefined)
  );
}

function AuthorityInputPanel({ dealId, onClose }) {
  const mutation = useCreateAuthorityInput();
  const [kind, setKind] = useState('property_fact');
  const [sourceTitle, setSourceTitle] = useState('');
  const [authorityName, setAuthorityName] = useState('');
  const [reviewStatus, setReviewStatus] = useState('approved');
  const [notes, setNotes] = useState('');
  const [autoPromote, setAutoPromote] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [propertyFact, setPropertyFact] = useState({ fact_key: 'road_width_mtrs', value: '' });
  const [guidance, setGuidance] = useState({
    locality: '',
    road_name: '',
    sro_name: '',
    land_use_type: 'residential',
    value_inr_per_sqft: '',
    source_section: '',
    source_page: '',
  });
  const [farRule, setFarRule] = useState({
    zone_code: '',
    planning_zone: '',
    land_use_family: 'residential',
    plot_area_min_sqm: '0',
    plot_area_max_sqm: '',
    road_width_min_m: '0',
    road_width_max_m: '',
    base_far: '',
    additional_far: '',
    max_far: '',
    ground_coverage_pct: '',
    front_setback_m: '',
    source_section: '',
    source_page: '',
  });

  const updateObject = (setter, key, value) => setter((current) => ({ ...current, [key]: value }));

  const payload = () => {
    if (kind === 'property_fact') return compactPayload(propertyFact);
    if (kind === 'guidance_value') return compactPayload(guidance);
    return compactPayload(farRule);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!dealId) return;
    mutation.mutate(
      {
        deal_id: dealId,
        kind,
        source_title: sourceTitle,
        authority_name: authorityName || undefined,
        review_status: reviewStatus,
        notes: notes || undefined,
        auto_promote: kind === 'property_fact' ? autoPromote : undefined,
        overwrite: kind === 'property_fact' ? overwrite : undefined,
        payload: payload(),
      },
      {
        onSuccess: () => {
          setSourceTitle('');
          setNotes('');
          if (kind === 'property_fact') setPropertyFact((current) => ({ ...current, value: '' }));
        },
      }
    );
  };

  return (
    <div className="rounded-xl border border-hairline bg-accent-soft p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-content-primary">Authority Input</h3>
          <p className="mt-1 text-xs text-content-secondary">Create a reviewed source row for the scoped deal.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 self-start rounded-lg border border-hairline-strong bg-bg-elevated px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:bg-bg-secondary"
        >
          <XCircle size={13} />
          Close
        </button>
      </div>

      {!dealId ? (
        <ErrorState tone="warn">
          Open this page from a deal's Parcel Intelligence panel before adding authority inputs.
        </ErrorState>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <label className="text-xs font-medium text-content-secondary">
              Input type
              <select className="input mt-1" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="property_fact">Property input</option>
                <option value="guidance_value">Guidance value</option>
                <option value="far_rule">FAR rule</option>
              </select>
            </label>
            <label className="text-xs font-medium text-content-secondary lg:col-span-2">
              Source title
              <input
                className="input mt-1"
                value={sourceTitle}
                onChange={(event) => setSourceTitle(event.target.value)}
                placeholder="e.g. IGR guidance extract, Kaveri note"
                required
              />
            </label>
            <label className="text-xs font-medium text-content-secondary">
              Review status
              <select className="input mt-1" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
                {REVIEW_INPUT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <label className="text-xs font-medium text-content-secondary">
              Authority
              <input
                className="input mt-1"
                value={authorityName}
                onChange={(event) => setAuthorityName(event.target.value)}
                placeholder="Karnataka IGR, Kaveri, BBMP..."
              />
            </label>
            <label className="text-xs font-medium text-content-secondary lg:col-span-2">
              Notes
              <input
                className="input mt-1"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Source page, analyst note, or approval context"
              />
            </label>
          </div>

          {kind === 'property_fact' && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              <label className="text-xs font-medium text-content-secondary">
                Field
                <select
                  className="input mt-1"
                  value={propertyFact.fact_key}
                  onChange={(event) => updateObject(setPropertyFact, 'fact_key', event.target.value)}
                >
                  {PROPERTY_FACT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-content-secondary lg:col-span-2">
                Value
                <input
                  className="input mt-1"
                  value={propertyFact.value}
                  onChange={(event) => updateObject(setPropertyFact, 'value', event.target.value)}
                  required
                />
              </label>
              <div className="flex flex-col justify-end gap-2 text-xs text-content-secondary">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={autoPromote} onChange={(event) => setAutoPromote(event.target.checked)} />
                  Promote to property
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                  Overwrite existing
                </label>
              </div>
            </div>
          )}

          {kind === 'guidance_value' && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              {[
                ['locality', 'Locality', true],
                ['road_name', 'Road name', false],
                ['sro_name', 'SRO', false],
                ['land_use_type', 'Land use', false],
                ['value_inr_per_sqft', 'INR / sqft', true],
                ['source_section', 'Source section', false],
                ['source_page', 'Page', false],
              ].map(([key, label, required]) => (
                <label key={key} className="text-xs font-medium text-content-secondary">
                  {label}
                  <input
                    className="input mt-1"
                    value={guidance[key]}
                    onChange={(event) => updateObject(setGuidance, key, event.target.value)}
                    required={required}
                  />
                </label>
              ))}
            </div>
          )}

          {kind === 'far_rule' && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
              {[
                ['zone_code', 'Zone code', true],
                ['planning_zone', 'PZ', false],
                ['land_use_family', 'Land use', true],
                ['plot_area_min_sqm', 'Plot min sqm', false],
                ['plot_area_max_sqm', 'Plot max sqm', false],
                ['road_width_min_m', 'Road min m', false],
                ['road_width_max_m', 'Road max m', false],
                ['base_far', 'Base FAR', true],
                ['additional_far', 'Addl FAR', false],
                ['max_far', 'Max FAR', true],
                ['ground_coverage_pct', 'Coverage %', false],
                ['front_setback_m', 'Front setback', false],
                ['source_section', 'Source section', false],
                ['source_page', 'Page', false],
              ].map(([key, label, required]) => (
                <label key={key} className="text-xs font-medium text-content-secondary">
                  {label}
                  <input
                    className="input mt-1"
                    value={farRule[key]}
                    onChange={(event) => updateObject(setFarRule, key, event.target.value)}
                    required={required}
                  />
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              <PlusCircle size={14} />
              {mutation.isPending ? 'Saving...' : 'Save Authority Input'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ReviewQueueRow({ item, onReview, onPromote, pending, promotePending, selected, onSelect }) {
  const summary = payloadSummary(item.payload);
  const factValue = item.payload?.fact_value;
  const promotion = item.promotion;
  const reason = promotionReason(promotion);

  return (
    <tr className="border-b border-hairline align-top hover:bg-bg-secondary/70">
      <td className="px-3 py-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={pending}
          onChange={() => onSelect(item)}
          className="h-4 w-4 rounded border-hairline-strong text-accent focus:ring-accent"
          aria-label={`Select ${item.title || item.category || item.type}`}
        />
      </td>
      <td className="px-3 py-3">
        <div className="font-medium text-content-primary">{item.title || item.category || item.type}</div>
        <div className="mt-1 text-xs text-content-muted">{item.type.replace(/_/g, ' ')}</div>
      </td>
      <td className="px-3 py-3 text-xs text-content-secondary">
        <div>{item.category || '-'}</div>
        {factValue !== undefined && (
          <div className="mt-1 max-w-md font-medium text-content-primary">
            {formatFactValue(factValue)}
          </div>
        )}
        {summary && <div className="mt-1 max-w-md leading-relaxed">{summary}</div>}
        {promotion?.supported && (
          <div className="mt-2 max-w-md rounded bg-bg-secondary px-2 py-1 text-[11px] text-content-secondary">
            Property target: {promotion.label} = {formatFactValue(promotion.value)}
            {promotion.property_name ? ` on ${promotion.property_name}` : ''}
            {reason ? ` (${reason})` : ''}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={item.review_status} />
        {item.confidence_score !== null && item.confidence_score !== undefined && (
          <div className="mt-1 text-xs text-content-muted">{Math.round(Number(item.confidence_score) * 100)}% confidence</div>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-content-secondary">
        {item.source_page ? `p. ${item.source_page}` : '-'}
        {item.source_section && <div className="mt-1 max-w-[180px] truncate">{item.source_section}</div>}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            ['approved', 'Approve', 'bg-pos-soft text-data-positive hover:brightness-95'],
            ['needs_review', 'Needs Review', 'bg-premium-soft text-premium hover:brightness-95'],
            ['rejected', 'Reject', 'bg-neg-soft text-data-negative hover:brightness-95'],
          ].map(([status, label, klass]) => (
            <button
              key={status}
              type="button"
              disabled={pending || item.review_status === status}
              onClick={() => onReview({ type: item.type, id: item.id, status })}
              className={clsx('rounded px-2 py-1 text-xs font-medium disabled:opacity-45', klass)}
            >
              {label}
            </button>
          ))}
          {promotion?.supported && item.review_status === 'approved' && (
            <button
              type="button"
              disabled={pending || promotePending || !promotion.promotable}
              onClick={() => onPromote({ id: item.id })}
              className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-1 text-xs font-medium text-accent hover:brightness-95 disabled:opacity-45"
              title={reason || 'Promote reviewed fact to linked property'}
            >
              <ArrowRight size={12} />
              Promote
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function ParcelIntelligenceAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [type, setType] = useState(() => initialOption(searchParams, 'type', 'all', TYPE_VALUES));
  const [status, setStatus] = useState(() => initialOption(searchParams, 'status', 'pending', STATUS_VALUES));
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [dealId, setDealId] = useState(() => searchParams.get('deal_id') || '');
  const [showAuthorityInput, setShowAuthorityInput] = useState(() => searchParams.get('action') === 'authority_input');
  const [selectedKeys, setSelectedKeys] = useState([]);
  const trimmedSearch = search.trim();
  const params = useMemo(
    () => ({
      type,
      status,
      limit: 80,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      ...(dealId ? { deal_id: dealId } : {}),
    }),
    [type, status, trimmedSearch, dealId]
  );
  const { data: ops, isLoading: statusLoading } = useParcelIntelligenceStatus();
  const { data: queue = [], isLoading: queueLoading, refetch } = useParcelIntelligenceReviewQueue(params);
  const reviewMutation = useReviewParcelIntelligenceItem();
  const reviewBatchMutation = useReviewParcelIntelligenceItems();
  const promoteMutation = usePromoteEvidenceFactToProperty();
  const promoteBatchMutation = usePromoteEvidenceFactsToProperty();

  const pendingCount = ops?.review_queue?.pending_or_needs_review ?? '-';
  const guidanceApproved = ops?.review_queue?.guidance_values?.approved || 0;
  const farApproved = ops?.review_queue?.far_rules?.approved || 0;
  const visibleKeys = useMemo(() => queue.map(rowKey), [queue]);
  const selectedQueueItems = useMemo(
    () => queue.filter((item) => selectedKeys.includes(rowKey(item))),
    [queue, selectedKeys]
  );
  const selectedReviewItems = useMemo(
    () => selectedQueueItems.map((item) => ({ type: item.type, id: item.id })),
    [selectedQueueItems]
  );
  const eligiblePromotionIds = useMemo(
    () => queue
      .filter((item) => item.type === 'evidence_fact' && item.review_status === 'approved' && item.promotion?.promotable)
      .map((item) => item.id),
    [queue]
  );
  const selectedEligiblePromotionIds = useMemo(
    () => selectedQueueItems
      .filter((item) => item.type === 'evidence_fact' && item.review_status === 'approved' && item.promotion?.promotable)
      .map((item) => item.id),
    [selectedQueueItems]
  );
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.includes(key));
  const isDecisionPending = reviewMutation.isPending || reviewBatchMutation.isPending || promoteMutation.isPending || promoteBatchMutation.isPending;

  useEffect(() => {
    setSelectedKeys([]);
  }, [type, status, trimmedSearch, dealId]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (type !== 'all') next.set('type', type);
    if (status !== 'pending') next.set('status', status);
    if (trimmedSearch) next.set('search', trimmedSearch);
    if (dealId) next.set('deal_id', dealId);
    if (showAuthorityInput) next.set('action', 'authority_input');
    setSearchParams(next, { replace: true });
  }, [type, status, trimmedSearch, dealId, showAuthorityInput, setSearchParams]);

  const toggleRowSelection = (item) => {
    const key = rowKey(item);
    setSelectedKeys((current) => (
      current.includes(key) ? current.filter((selectedKey) => selectedKey !== key) : [...current, key]
    ));
  };

  const toggleVisibleSelection = () => {
    setSelectedKeys((current) => {
      if (allVisibleSelected) {
        return current.filter((key) => !visibleKeys.includes(key));
      }
      return [...new Set([...current, ...visibleKeys])];
    });
  };

  const reviewSelected = (nextStatus) => {
    if (!selectedReviewItems.length) return;
    reviewBatchMutation.mutate(
      { items: selectedReviewItems, status: nextStatus },
      { onSuccess: () => setSelectedKeys([]) }
    );
  };

  const promoteSelected = () => {
    if (!selectedEligiblePromotionIds.length) return;
    promoteBatchMutation.mutate(
      { ids: selectedEligiblePromotionIds },
      { onSuccess: () => setSelectedKeys([]) }
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parcel Intelligence Operations"
        description="Review evidence, monitor provider readiness, and keep regulatory intelligence honest before it appears as verified."
      />

      {statusLoading ? (
        <div className="py-2"><SkeletonList rows={5} columns={4} /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard label="Open Review" value={pendingCount} sub="Pending or needs review" icon={Clock} />
            <StatCard label="Guidance Rows" value={guidanceApproved} sub="Approved reference rows" icon={FileSearch} />
            <StatCard label="FAR Rules" value={farApproved} sub="Approved buildability rules" icon={Database} />
            <StatCard label="K-GIS Cache" value={ops?.cache?.kgis_fresh_rows || 0} sub={`${ops?.cache?.kgis_rows || 0} total rows`} icon={RefreshCw} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ProviderCard label="Landeed" provider={ops?.providers?.landeed} />
            <ProviderCard label="IGR PDF Parser" provider={ops?.providers?.igr_pdf} />
            <ProviderCard label="K-GIS" provider={ops?.providers?.kgis} />
          </div>

          <SchemaReadinessCard schema={ops?.schema} />
          <AiUsageCard usage={ops?.ai_usage} />
          {ops?.red_flag_rules?.length > 0 && <RedFlagRulesCard rules={ops.red_flag_rules} />}
        </>
      )}

      <div className="rounded-xl border border-hairline-strong bg-bg-elevated shadow-sm">
        <div className="flex flex-col gap-3 border-b border-hairline-strong p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-content-primary">Evidence Review Queue</h2>
            <p className="mt-1 text-xs text-content-secondary">
              Approval promotes extracted or curated facts into verified decision support. Rejected rows remain auditable but should not drive parcel outputs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={14} />
              <input
                className="input min-w-[240px] pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search deal, source, fact"
              />
            </div>
            {dealId && (
              <button
                type="button"
                onClick={() => setDealId('')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-bg-secondary px-3 py-2 text-sm font-medium text-content-secondary hover:bg-bg-elevated"
                title="Clear deal scope"
              >
                Deal scoped
                <XCircle size={14} />
              </button>
            )}
            <select className="input max-w-[180px]" value={type} onChange={(event) => setType(event.target.value)}>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="input max-w-[170px]" value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-bg-secondary"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowAuthorityInput((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-accent-soft px-3 py-2 text-sm font-medium text-accent hover:brightness-95"
            >
              <PlusCircle size={14} />
              Authority Input
            </button>
            <button
              type="button"
              disabled={eligiblePromotionIds.length === 0 || isDecisionPending}
              onClick={() => promoteBatchMutation.mutate({ ids: eligiblePromotionIds })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-accent-soft px-3 py-2 text-sm font-medium text-accent hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
              title={eligiblePromotionIds.length ? 'Promote approved visible facts into blank linked property inputs' : 'No eligible approved facts in this view'}
            >
              <ArrowRight size={14} />
              Promote Eligible
              {eligiblePromotionIds.length > 0 && (
                <span className="rounded bg-white/80 px-1.5 py-0.5 text-xs tabular-nums">{eligiblePromotionIds.length}</span>
              )}
            </button>
            <button
              type="button"
              disabled={selectedReviewItems.length === 0 || isDecisionPending}
              onClick={() => reviewSelected('approved')}
              className="rounded-lg bg-pos-soft px-3 py-2 text-sm font-medium text-data-positive hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Approve Selected
              {selectedReviewItems.length > 0 && (
                <span className="ml-1 rounded bg-white/80 px-1.5 py-0.5 text-xs tabular-nums">{selectedReviewItems.length}</span>
              )}
            </button>
            <button
              type="button"
              disabled={selectedReviewItems.length === 0 || isDecisionPending}
              onClick={() => reviewSelected('needs_review')}
              className="rounded-lg bg-premium-soft px-3 py-2 text-sm font-medium text-premium hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Needs Review
            </button>
            <button
              type="button"
              disabled={selectedReviewItems.length === 0 || isDecisionPending}
              onClick={() => reviewSelected('rejected')}
              className="rounded-lg bg-neg-soft px-3 py-2 text-sm font-medium text-data-negative hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Reject Selected
            </button>
            <button
              type="button"
              disabled={selectedEligiblePromotionIds.length === 0 || isDecisionPending}
              onClick={promoteSelected}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-accent-soft px-3 py-2 text-sm font-medium text-accent hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ArrowRight size={14} />
              Promote Selected
              {selectedEligiblePromotionIds.length > 0 && (
                <span className="rounded bg-white/80 px-1.5 py-0.5 text-xs tabular-nums">{selectedEligiblePromotionIds.length}</span>
              )}
            </button>
          </div>
        </div>

        {showAuthorityInput && (
          <div className="border-b border-hairline-strong p-4">
            <AuthorityInputPanel dealId={dealId} onClose={() => setShowAuthorityInput(false)} />
          </div>
        )}

        {ops?.degraded && (
          <div className="border-b border-hairline-strong p-4">
            <ErrorState tone="danger">
              Parcel intelligence review is paused because required database schema objects are missing or could not be verified.
            </ErrorState>
          </div>
        )}

        {queueLoading ? (
          <div className="py-2"><SkeletonList rows={6} columns={4} /></div>
        ) : queue.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={AlertTriangle}
              title="No review items found"
              description="Change filters or ingest reviewed source material. REDIP will not create placeholder regulatory facts."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-hairline-strong bg-bg-secondary text-xs uppercase tracking-[0.08em] text-content-muted">
                  <th className="px-3 py-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      disabled={queue.length === 0 || isDecisionPending}
                      onChange={toggleVisibleSelection}
                      className="h-4 w-4 rounded border-hairline-strong text-accent focus:ring-accent"
                      aria-label="Select visible review items"
                    />
                  </th>
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 font-semibold">Extract</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Decision</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <ReviewQueueRow
                    key={`${item.type}-${item.id}`}
                    item={item}
                    selected={selectedKeys.includes(rowKey(item))}
                    onSelect={toggleRowSelection}
                    pending={isDecisionPending}
                    promotePending={isDecisionPending}
                    onReview={reviewMutation.mutate}
                    onPromote={promoteMutation.mutate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
