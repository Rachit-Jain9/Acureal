import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, User, Building, FileText, Monitor, Download,
  MessageSquare, Loader2, ExternalLink, Lock, CheckCircle,
  AlertTriangle, ArrowRight,
} from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import { toast } from '../components/common/Toast';
import { ErrorState } from '../design-system';
import CloseAccountCard from '../components/common/CloseAccountCard';
import { consentAPI, privacyAPI } from '../services/api';
import { downloadBlob } from '../utils/download';
import useAuthStore from '../store/authStore';

// ── Static copy ──────────────────────────────────────────────────────────────
// Plain-English label + description for each consent purpose. Keys mirror the
// backend CONSENT_PURPOSES set; the page renders whatever order the API sends.
const CONSENT_COPY = {
  product_improvement: {
    label: 'Product improvement',
    description:
      'Let REDIP analyse how the platform is used — anonymised diagnostics and usage patterns — to improve the product.',
  },
  anonymized_benchmarking: {
    label: 'Anonymised benchmarking',
    description:
      'Contribute your deal data, fully de-identified and aggregated, to market benchmarks. Your individual deals are never shown to anyone else.',
  },
  marketing: {
    label: 'Product updates & marketing',
    description:
      'Receive occasional emails about new REDIP features. REDIP sends no marketing email today — this is consent for if that changes.',
  },
  ai_processing: {
    label: 'Optional AI features',
    description:
      'Enable optional AI-assisted features beyond core document extraction. Core extraction is part of the service and is unaffected by this choice.',
  },
};

const LEGAL_DOC_LABELS = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
  cookie_policy: 'Cookie Policy',
  data_processing_addendum: 'Data Processing Addendum',
  acceptable_use: 'Acceptable Use Policy',
};

const LEGAL_DOC_LINKS = {
  terms_of_service: '/terms',
  privacy_policy: '/privacy',
  cookie_policy: '/cookies',
};

// ── Formatting helpers ───────────────────────────────────────────────────────
const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const titleCase = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// ── Toggle switch ────────────────────────────────────────────────────────────
function Toggle({ checked, disabled, busy, onChange, labelledById }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledById}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-accent border-accent' : 'bg-bg-secondary border-hairline-strong'
      }`}
    >
      <span
        className={`inline-flex h-4 w-4 items-center justify-center transform rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      >
        {busy && <Loader2 size={10} className="animate-spin text-accent" />}
      </span>
    </button>
  );
}

// ── Profile field row ────────────────────────────────────────────────────────
function InfoRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-hairline last:border-0">
      <span className="text-sm text-content-secondary shrink-0">{label}</span>
      <span className="text-sm text-content-primary text-right break-words min-w-0">{children}</span>
    </div>
  );
}

// ── Reusable card shell — matches SettingsPage chrome ────────────────────────
function Card({ icon: Icon, title, children, tone = 'default' }) {
  const border = tone === 'danger' ? 'border-hairline' : 'border-hairline-strong';
  return (
    <div className={`bg-bg-elevated rounded-xl shadow-sm border ${border} p-6`}>
      <h3 className="text-base font-semibold text-content-primary mb-4 flex items-center gap-2">
        {Icon && <Icon size={18} />}
        {title}
      </h3>
      {children}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
      <div className="redip-skeleton h-5 w-40 rounded-md mb-4" />
      <div className="space-y-2.5">
        <div className="redip-skeleton h-3.5 w-full rounded-sm" />
        <div className="redip-skeleton h-3.5 w-5/6 rounded-sm" />
        <div className="redip-skeleton h-3.5 w-2/3 rounded-sm" />
      </div>
    </div>
  );
}

export default function PrivacyCentrePage() {
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [overview, setOverview] = useState(null);

  // Consent: purposes catalogue + current { purpose: bool } state.
  const [consentPurposes, setConsentPurposes] = useState([]);
  const [consentState, setConsentState] = useState({});
  const [consentAvailable, setConsentAvailable] = useState(true);
  const [savingPurpose, setSavingPurpose] = useState(null);

  // Data export flow.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [overviewRes, consentRes] = await Promise.all([
        privacyAPI.overview(),
        consentAPI.get(),
      ]);
      setOverview(overviewRes.data?.data || null);
      const consent = consentRes.data?.data || {};
      setConsentPurposes(Array.isArray(consent.purposes) ? consent.purposes : []);
      setConsentState(consent.state || {});
      setConsentAvailable(consent.available !== false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleConsentToggle = async (purpose, next) => {
    if (savingPurpose) return;
    const previous = consentState[purpose] === true;
    setSavingPurpose(purpose);
    setConsentState((s) => ({ ...s, [purpose]: next })); // optimistic
    try {
      const res = await consentAPI.update({ [purpose]: next });
      const fresh = res.data?.data?.state;
      if (fresh) setConsentState(fresh);
      toast.success(next ? 'Consent granted' : 'Consent withdrawn');
    } catch (err) {
      setConsentState((s) => ({ ...s, [purpose]: previous })); // revert
      toast.error(err.response?.data?.message || 'Could not save that choice. Please try again.');
    } finally {
      setSavingPurpose(null);
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await privacyAPI.exportData(exportPassword || undefined);
      const payload = res.data?.data;
      if (!payload) throw new Error('Empty export');
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(
        JSON.stringify(payload, null, 2),
        `redip-my-data-${stamp}.json`,
        'application/json',
      );
      toast.success('Your data export has downloaded.');
      setExportOpen(false);
      setExportPassword('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const profile = overview?.profile || null;
  const passwordNeeded = profile ? profile.password_set !== false : (user?.password_set !== false);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Privacy & your data"
        description="See what personal data REDIP holds about you, manage your consent, download a copy, and exercise your data-protection rights."
      />

      {loading && (
        <div className="space-y-6">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {!loading && loadError && (
        <ErrorState
          tone="danger"
          title="Could not load your privacy information"
          action={
            <button
              type="button"
              onClick={load}
              className="text-sm font-medium text-data-negative hover:underline transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40 rounded px-1"
            >
              Try again
            </button>
          }
        >
          Something went wrong fetching your data. Your information is safe — this is a
          display issue. Please try again.
        </ErrorState>
      )}

      {!loading && !loadError && (
        <>
          {/* ── Your information ─────────────────────────────────────────── */}
          <Card icon={User} title="Your information">
            <p className="text-xs text-content-secondary mb-4 max-w-2xl">
              The personal account data REDIP holds about you. To correct your name or
              phone number, use{' '}
              <Link
                to="/dashboard/settings"
                className="text-accent hover:text-accent-hover underline underline-offset-2"
              >
                Settings
              </Link>
              .
            </p>
            {profile ? (
              <div>
                <InfoRow label="Name">{profile.name || '—'}</InfoRow>
                <InfoRow label="Email">{profile.email || '—'}</InfoRow>
                <InfoRow label="Phone">{profile.phone || '—'}</InfoRow>
                <InfoRow label="Role">{titleCase(profile.role)}</InfoRow>
                <InfoRow label="Sign-in method">{titleCase(profile.sign_in_method)}</InfoRow>
                <InfoRow label="Email verified">
                  {profile.email_verified ? (
                    <span className="inline-flex items-center gap-1 text-data-positive">
                      <CheckCircle size={14} /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-premium">
                      <AlertTriangle size={14} /> Not verified
                    </span>
                  )}
                </InfoRow>
                <InfoRow label="Account created">{fmtDate(profile.account_created_at)}</InfoRow>
                <InfoRow label="Last sign-in">{fmtDateTime(profile.last_login_at)}</InfoRow>
              </div>
            ) : (
              <p className="text-sm text-content-secondary">No profile data available.</p>
            )}

            {overview?.organisation_memberships?.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-medium text-content-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Building size={13} /> Workspaces
                </p>
                <div className="rounded-lg border border-hairline divide-y divide-hairline">
                  {overview.organisation_memberships.map((org) => (
                    <div
                      key={org.organization_id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <span className="text-sm text-content-primary truncate">
                        {org.organization_name}
                      </span>
                      <span className="text-xs text-content-secondary shrink-0">
                        {titleCase(org.role)} · joined {fmtDate(org.joined_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* ── Consent choices ─────────────────────────────────────────── */}
          <Card icon={Shield} title="Your consent choices">
            <p className="text-xs text-content-secondary mb-4 max-w-2xl">
              These choices are yours to make and change at any time, for each purpose
              separately, under §6 of the Digital Personal Data Protection Act, 2023.
              Core REDIP features needed to run the service are always on and are not
              listed here.
            </p>
            {!consentAvailable ? (
              <ErrorState tone="info" title="Consent management is being set up">
                This feature will be available shortly. No action is needed from you.
              </ErrorState>
            ) : consentPurposes.length === 0 ? (
              <p className="text-sm text-content-secondary">No consent options available.</p>
            ) : (
              <div className="divide-y divide-hairline">
                {consentPurposes.map((purpose) => {
                  const copy = CONSENT_COPY[purpose] || { label: titleCase(purpose), description: '' };
                  const checked = consentState[purpose] === true;
                  const labelId = `consent-label-${purpose}`;
                  return (
                    <div key={purpose} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p id={labelId} className="text-sm font-medium text-content-primary">
                          {copy.label}
                        </p>
                        {copy.description && (
                          <p className="text-xs text-content-secondary mt-0.5 leading-relaxed">
                            {copy.description}
                          </p>
                        )}
                      </div>
                      <Toggle
                        checked={checked}
                        busy={savingPurpose === purpose}
                        disabled={savingPurpose !== null && savingPurpose !== purpose}
                        onChange={(next) => handleConsentToggle(purpose, next)}
                        labelledById={labelId}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ── Legal agreements ────────────────────────────────────────── */}
          <Card icon={FileText} title="Legal agreements you have accepted">
            {overview?.legal_acceptances?.length > 0 ? (
              <div className="divide-y divide-hairline">
                {overview.legal_acceptances.map((doc, i) => {
                  const link = LEGAL_DOC_LINKS[doc.document_kind];
                  return (
                    <div key={`${doc.document_kind}-${doc.version}-${i}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm text-content-primary">
                          {LEGAL_DOC_LABELS[doc.document_kind] || titleCase(doc.document_kind)}
                          <span className="text-content-muted"> · {doc.version}</span>
                        </p>
                        <p className="text-xs text-content-secondary">
                          Accepted {fmtDate(doc.accepted_at)}
                        </p>
                      </div>
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 py-0.5 shrink-0"
                        >
                          View <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-content-secondary">No recorded acceptances.</p>
            )}
          </Card>

          {/* ── Active sign-ins ─────────────────────────────────────────── */}
          <Card icon={Monitor} title="Active sign-ins">
            <p className="text-xs text-content-secondary mb-4 max-w-2xl">
              Devices with a current REDIP session. To end every session everywhere,
              change your password in Settings.
            </p>
            {overview?.active_sessions?.length > 0 ? (
              <div className="divide-y divide-hairline">
                {overview.active_sessions.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm text-content-primary">{s.device}</p>
                      <p className="text-xs text-content-secondary">
                        Started {fmtDateTime(s.started_at)}
                        {s.ip_address ? ` · ${s.ip_address}` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-content-muted shrink-0 tabular-nums">
                      expires {fmtDate(s.expires_at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-content-secondary">No active sessions found.</p>
            )}
          </Card>

          {/* ── Download your data ──────────────────────────────────────── */}
          <Card icon={Download} title="Download your data">
            <p className="text-xs text-content-secondary mb-4 max-w-2xl">
              Download a machine-readable copy of the personal data REDIP holds about
              you — your profile, workspaces, consent history, and legal acceptances —
              under §11 of the Digital Personal Data Protection Act, 2023. Deal and
              document content lives in your workspace and is available inside the app.
            </p>
            {!exportOpen ? (
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
              >
                <Download size={14} />
                Download my data
              </button>
            ) : (
              <div className="rounded-lg border border-hairline bg-bg-secondary p-4">
                {passwordNeeded ? (
                  <>
                    <label
                      htmlFor="export-password"
                      className="block text-sm font-medium text-content-secondary mb-1 flex items-center gap-1.5"
                    >
                      <Lock size={13} /> Confirm your password to continue
                    </label>
                    <input
                      id="export-password"
                      type="password"
                      autoComplete="current-password"
                      value={exportPassword}
                      onChange={(e) => setExportPassword(e.target.value)}
                      placeholder="Your account password"
                      disabled={exporting}
                      className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent mb-3"
                    />
                  </>
                ) : (
                  <p className="text-sm text-content-secondary mb-3">
                    Your signed-in session confirms your identity — no password is needed.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting || (passwordNeeded && !exportPassword)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {exporting ? 'Preparing…' : 'Confirm & download'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setExportOpen(false); setExportPassword(''); }}
                    disabled={exporting}
                    className="px-3 py-2 text-sm font-medium text-content-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-lg disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Card>

          {/* ── Raise a concern ─────────────────────────────────────────── */}
          <Card icon={MessageSquare} title="Raise a privacy concern">
            <p className="text-xs text-content-secondary mb-4 max-w-2xl">
              For data-correction requests, complaints, or any privacy concern, contact
              REDIP's Grievance Officer. Acknowledged within 24 hours.
            </p>
            <a
              href="/grievance"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 border border-hairline-strong hover:border-accent hover:bg-bg-secondary text-content-primary rounded-lg text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
            >
              <MessageSquare size={14} />
              Contact the Grievance Officer
              <ArrowRight size={14} />
            </a>
          </Card>

          {/* ── Close account (DPDP §8(7) erasure) — reused component ────── */}
          <CloseAccountCard />
        </>
      )}
    </div>
  );
}
