import { useState } from 'react';
import { Building2, Edit2, Loader2, Check, X, Link2, Unlink, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import {
  usePromoterProfile,
  useUpsertPromoterProfile,
  useLinkReraPromoter,
  useUnlinkReraPromoter,
} from '../../hooks/usePromoterProfile';
import { GuideHelp } from '../../design-system';

/**
 * Promoter & Execution card — Workstream B (B4).
 *
 * Promoter execution risk is one of the catastrophic Indian-RE failure modes.
 * This card is where the analyst records the verified promoter / builder
 * track record; the deterministic posture it shows (and feeds into the Risk
 * Radar) is computed server-side. View + edit, on the Risk tab.
 */

const POSTURE = {
  cleared: { label: 'Cleared', chip: 'bg-pos-soft text-data-positive border-hairline' },
  unverified: { label: 'Not verified', chip: 'bg-premium-soft text-premium border-hairline' },
  flagged: { label: 'Flagged', chip: 'bg-neg-soft text-data-negative border-hairline' },
};

const SIGNAL_TONE = {
  negative: 'text-data-negative',
  warn: 'text-premium',
  positive: 'text-data-positive',
  neutral: 'text-content-muted',
};

const ENTITY_OPTIONS = [
  { value: '', label: 'Unknown / not recorded' },
  { value: 'individual', label: 'Individual' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'llp', label: 'LLP' },
  { value: 'private_limited', label: 'Private Limited' },
  { value: 'public_limited', label: 'Public Limited' },
  { value: 'trust', label: 'Trust' },
  { value: 'other', label: 'Other' },
];

const ENTITY_LABEL = Object.fromEntries(ENTITY_OPTIONS.map((o) => [o.value, o.label]));

// A profile row → the editable form shape (nulls become '' for controlled inputs).
const toForm = (p) => ({
  promoter_name: p?.promoter_name || '',
  entity_type: p?.entity_type || '',
  years_active: p?.years_active ?? '',
  total_projects: p?.total_projects ?? '',
  delivered_on_time: p?.delivered_on_time ?? '',
  delivered_delayed: p?.delivered_delayed ?? '',
  ongoing_projects: p?.ongoing_projects ?? '',
  rera_registered:
    p?.rera_registered === true ? 'true' : p?.rera_registered === false ? 'false' : '',
  rera_complaints: p?.rera_complaints ?? '',
  notes: p?.notes || '',
});

// The form → the API payload ('' becomes null; numbers coerced).
const toPayload = (f) => {
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  return {
    promoter_name: f.promoter_name.trim() || null,
    entity_type: f.entity_type || null,
    years_active: num(f.years_active),
    total_projects: num(f.total_projects),
    delivered_on_time: num(f.delivered_on_time),
    delivered_delayed: num(f.delivered_delayed),
    ongoing_projects: num(f.ongoing_projects),
    rera_registered: f.rera_registered === 'true' ? true : f.rera_registered === 'false' ? false : null,
    rera_complaints: num(f.rera_complaints),
    notes: f.notes.trim() || null,
  };
};

const fmt = (v) => (v === null || v === undefined ? '—' : v);

// Render the trigram-similarity score as a confidence band. Above ~0.8 we
// treat as a near-certain match; 0.5-0.8 is a clear lead worth confirming;
// below 0.5 the operator should treat as a weak suggestion only.
const simBand = (score) => {
  const n = Number(score);
  if (!Number.isFinite(n)) return { label: '—', tone: 'text-content-muted' };
  if (n >= 0.85) return { label: `${Math.round(n * 100)}% match`, tone: 'text-data-positive' };
  if (n >= 0.6) return { label: `${Math.round(n * 100)}% match`, tone: 'text-premium' };
  return { label: `${Math.round(n * 100)}% match`, tone: 'text-content-muted' };
};

// Format average delivery delay months as a readable lag. Negative = early.
const fmtDelayMonths = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 10) / 10;
  if (rounded === 0) return 'on time on average';
  if (rounded > 0) return `${rounded} month${rounded === 1 ? '' : 's'} late on average`;
  return `${Math.abs(rounded)} month${Math.abs(rounded) === 1 ? '' : 's'} early on average`;
};

/**
 * K-RERA cross-check section — Phase 1 / Pillar 6.
 *
 * The analyst's manual profile is sovereign. This section adds "what the
 * public K-RERA index shows" alongside it. Three states:
 *   • Linked → show K-RERA aggregate stats + unlink affordance.
 *   • Unlinked, candidates exist → show top-3 fuzzy matches + confirm buttons.
 *   • Unlinked, no candidates → render nothing (K-RERA index is empty for
 *     this name, or the K-RERA tables aren't populated yet).
 */
function ReraCrossCheck({ dealId, rera }) {
  const link = useLinkReraPromoter();
  const unlink = useUnlinkReraPromoter();

  if (!rera) return null;
  const { candidates = [], linked = null, stats = null } = rera;
  if (!linked && candidates.length === 0) return null;

  if (linked) {
    return (
      <div className="mt-3 p-3 rounded-md border border-bg-tertiary bg-bg-secondary/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <Link2 size={12} className="text-content-muted shrink-0" />
              <span className="text-[11px] uppercase tracking-wider font-medium text-content-muted">
                K-RERA match
              </span>
            </div>
            <p className="text-sm font-medium text-content-primary truncate">
              {linked.promoter_name}
            </p>
            {stats ? (
              <p className="text-xs text-content-secondary mt-1 tabular-nums">
                {stats.total_projects} project{stats.total_projects === 1 ? '' : 's'} on K-RERA
                {' · '}
                {stats.completed_projects} completed
                {stats.ongoing_projects > 0 && ` · ${stats.ongoing_projects} ongoing`}
                {stats.lapsed_projects > 0 && ` · ${stats.lapsed_projects} lapsed`}
                {fmtDelayMonths(stats.avg_delivery_delay_months) &&
                  ` · ${fmtDelayMonths(stats.avg_delivery_delay_months)}`}
              </p>
            ) : (
              <p className="text-xs text-content-muted mt-1">
                No K-RERA aggregate stats published yet for this promoter.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => unlink.mutate({ dealId })}
            disabled={unlink.isPending}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-content-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1.5 py-1 shrink-0"
            title="Clear the K-RERA cross-link"
          >
            {unlink.isPending ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
            Unlink
          </button>
        </div>
      </div>
    );
  }

  // Unlinked → surface candidates for confirmation.
  return (
    <div className="mt-3 p-3 rounded-md border border-bg-tertiary bg-bg-secondary/60">
      <div className="flex items-center gap-1.5 mb-2">
        <ExternalLink size={12} className="text-content-muted" />
        <span className="text-[11px] uppercase tracking-wider font-medium text-content-muted">
          K-RERA candidates
        </span>
      </div>
      <p className="text-xs text-content-secondary mb-2">
        These promoter names from the K-RERA index look similar. Confirm the right one to surface
        their public track record alongside your findings.
      </p>
      <ul className="space-y-1.5">
        {candidates.slice(0, 5).map((c) => {
          const band = simBand(c.sim_score);
          return (
            <li
              key={c.promoter_name}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-content-primary truncate">{c.promoter_name}</p>
                <p className={clsx('text-[11px] tabular-nums', band.tone)}>{band.label}</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  link.mutate({
                    dealId,
                    reraPromoterName: c.promoter_name,
                    matchConfidence: c.sim_score,
                  })
                }
                disabled={link.isPending}
                className="btn btn-secondary text-xs shrink-0"
              >
                {link.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Confirm match'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <div className="bg-bg-secondary rounded-lg p-2.5">
      <p className="text-[11px] text-content-muted mb-0.5">{label}</p>
      <p className="text-sm font-medium text-content-primary tabular-nums">{children}</p>
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-content-secondary mb-1">{label}</label>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input text-sm"
      />
    </div>
  );
}

export default function PromoterProfileCard({ dealId }) {
  const { data, isLoading, isError, refetch } = usePromoterProfile(dealId);
  const upsert = useUpsertPromoterProfile();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(toForm(null));

  const profile = data?.profile || null;
  const assessment = data?.assessment || null;
  const rera = data?.rera || null;

  const startEdit = () => {
    setForm(toForm(profile));
    setEditing(true);
  };

  const handleSave = async () => {
    try {
      await upsert.mutateAsync({ dealId, data: toPayload(form) });
      setEditing(false);
    } catch {
      // toast handled in the hook
    }
  };

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  if (isLoading) {
    return (
      <div className="card-editorial">
        <div className="redip-skeleton h-5 w-48 rounded-md mb-3" />
        <div className="space-y-2">
          <div className="redip-skeleton h-3.5 w-full rounded-sm" />
          <div className="redip-skeleton h-3.5 w-2/3 rounded-sm" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="card-editorial">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <Building2 size={16} className="text-content-muted" />
            Promoter &amp; Execution
          </h3>
          <button type="button" onClick={() => refetch()} className="btn btn-secondary text-xs">
            Retry
          </button>
        </div>
        <p className="text-xs text-content-muted mt-2">
          Couldn&apos;t load the promoter track record — this is a display issue.
        </p>
      </div>
    );
  }

  const posture = POSTURE[assessment?.posture] || POSTURE.unverified;

  return (
    <div className="card-editorial">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <Building2 size={16} className="text-content-muted" />
          Promoter &amp; Execution
          <GuideHelp topic="deal.promoter" label="Promoter & Execution" />
          <span
            className={clsx(
              'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
              posture.chip,
            )}
          >
            {posture.label}
          </span>
        </h3>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-accent transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1.5 py-1"
          >
            <Edit2 size={13} />
            {profile ? 'Edit' : 'Record'}
          </button>
        )}
      </div>

      {/* Assessment signals — the deterministic verdict. */}
      {assessment?.signals?.length > 0 && (
        <ul className="space-y-0.5 mb-3">
          {assessment.signals.map((s, i) => (
            <li key={i} className={clsx('text-xs', SIGNAL_TONE[s.tone] || 'text-content-muted')}>
              {s.text}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">
              Promoter / builder name
            </label>
            <input
              type="text"
              value={form.promoter_name}
              onChange={(e) => set('promoter_name')(e.target.value)}
              placeholder="e.g. Prestige Group"
              className="input text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">
                Entity type
              </label>
              <select
                value={form.entity_type}
                onChange={(e) => set('entity_type')(e.target.value)}
                className="input text-sm"
              >
                {ENTITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <NumberField
              label="Years active"
              value={form.years_active}
              onChange={set('years_active')}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumberField
              label="Total projects"
              value={form.total_projects}
              onChange={set('total_projects')}
            />
            <NumberField
              label="Delivered on time"
              value={form.delivered_on_time}
              onChange={set('delivered_on_time')}
            />
            <NumberField
              label="Delivered late"
              value={form.delivered_delayed}
              onChange={set('delivered_delayed')}
            />
            <NumberField
              label="Ongoing"
              value={form.ongoing_projects}
              onChange={set('ongoing_projects')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">
                RERA-registered
              </label>
              <select
                value={form.rera_registered}
                onChange={(e) => set('rera_registered')(e.target.value)}
                className="input text-sm"
              >
                <option value="">Unknown</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
            <NumberField
              label="RERA complaints on record"
              value={form.rera_complaints}
              onChange={set('rera_complaints')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">
              Notes (litigation, reputation, source of verification)
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes')(e.target.value)}
              rows={2}
              className="input text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={upsert.isPending}
              className="btn btn-secondary text-sm flex items-center gap-1"
            >
              <X size={13} /> Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={upsert.isPending}
              className="btn btn-primary text-sm flex items-center gap-1.5"
            >
              {upsert.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              Save track record
            </button>
          </div>
        </div>
      ) : profile ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Fact label="Promoter">{fmt(profile.promoter_name)}</Fact>
          <Fact label="Entity">{ENTITY_LABEL[profile.entity_type || ''] || '—'}</Fact>
          <Fact label="Years active">{fmt(profile.years_active)}</Fact>
          <Fact label="Total projects">{fmt(profile.total_projects)}</Fact>
          <Fact label="On time">{fmt(profile.delivered_on_time)}</Fact>
          <Fact label="Delivered late">{fmt(profile.delivered_delayed)}</Fact>
          <Fact label="Ongoing">{fmt(profile.ongoing_projects)}</Fact>
          <Fact label="RERA-registered">
            {profile.rera_registered === true
              ? 'Yes'
              : profile.rera_registered === false
                ? 'No'
                : '—'}
          </Fact>
          {profile.notes && (
            <div className="col-span-2 sm:col-span-4 bg-bg-secondary rounded-lg p-2.5">
              <p className="text-[11px] text-content-muted mb-0.5">Notes</p>
              <p className="text-sm text-content-secondary whitespace-pre-line">{profile.notes}</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-content-muted">
          No promoter track record recorded yet. Promoter execution is a leading cause of
          deal loss in India — record the builder&apos;s delivery history and RERA standing
          so it is verified, not assumed.
        </p>
      )}

      {/* K-RERA cross-check — Phase 1 / Pillar 6. Renders nothing when there
          are no candidates and no link (e.g. before a promoter name is
          recorded, or when the K-RERA index is empty for this name). */}
      {!editing && <ReraCrossCheck dealId={dealId} rera={rera} />}
    </div>
  );
}
