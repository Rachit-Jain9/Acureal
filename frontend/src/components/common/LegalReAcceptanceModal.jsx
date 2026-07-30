// LegalReAcceptanceModal
// ------------------------------------------------------------------
// Blocking modal shown after sign-in when the current user has not yet
// accepted the latest published version of Terms of Service or Privacy
// Policy. Mirrors the signup-time acceptance card visually but lives
// inside the dashboard chrome rather than the public landing page.
//
// Behaviour:
//   - Cannot be dismissed by Escape or backdrop click — re-acceptance is
//     compliance-gated and must end in either Accept or Sign out.
//   - Renders a row per pending document with version, effective date,
//     and a link that opens the full body in a new tab (so the user can
//     keep the modal open while reading).
//   - On Accept: posts to /api/legal/me/accept with the documentIds of
//     every pending row, then triggers a refresh on the parent hook so
//     the gate falls away atomically.
//
// Accessibility:
//   - role="dialog", aria-modal="true", labelled by the headline.
//   - Focus trap via useFocusTrap; first focusable element gets focus.
//   - Sign out button is the focus-visible escape hatch (no Escape).

import { useState } from 'react';
import { ExternalLink, ShieldCheck, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import Checkbox from '../../design-system/Checkbox';
import { legalAPI } from '../../services/api';
import useAuthStore from '../../store/authStore';

const KIND_LABEL = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
};

const KIND_PATH = {
  terms_of_service: '/terms',
  privacy_policy: '/privacy',
};

const formatDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function LegalReAcceptanceModal({ pending, onAccepted }) {
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const logout = useAuthStore((s) => s.logout);

  // No onEscape — the modal is intentionally non-dismissible. The user must
  // Accept or Sign out.
  const trapRef = useFocusTrap(true);

  if (!Array.isArray(pending) || pending.length === 0) return null;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const documentIds = pending.map((doc) => doc.id);
      await legalAPI.recordAcceptance(documentIds);
      // Optimistic clear — parent will also refresh via onAccepted.
      onAccepted?.();
    } catch (err) {
      const message =
        err?.response?.data?.message
        || 'We could not record your acceptance. Please try again, or sign out and back in.';
      setError(message);
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (submitting) return;
    try {
      await logout();
    } catch {
      // logout is best-effort; the store clears local state regardless.
    }
  };

  // Compose a one-line headline that names exactly what changed.
  const kinds = pending.map((d) => KIND_LABEL[d.kind] || d.kind);
  const headline =
    kinds.length === 1
      ? `Updated ${kinds[0]}`
      : 'Updated Terms of Service & Privacy Policy';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-4 py-6 motion-safe:animate-[fadeIn_140ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-reaccept-title"
    >
      <div
        ref={trapRef}
        className="w-full max-w-lg rounded-editorial border border-hairline-strong bg-bg-elevated shadow-xl flex flex-col max-h-[calc(100vh-3rem)]"
      >
        <header className="flex items-start gap-3 border-b border-hairline px-6 py-5">
          <span
            aria-hidden="true"
            className="shrink-0 mt-0.5 flex items-center justify-center w-9 h-9 rounded-full bg-accent/10 text-accent"
          >
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0">
            <div className="text-eyebrow uppercase tracking-[0.12em] text-content-muted font-medium">
              Acureal · Compliance
            </div>
            <h2
              id="legal-reaccept-title"
              className="mt-1 font-display text-lg sm:text-xl font-semibold text-content-primary tracking-tight"
            >
              {headline}
            </h2>
            <p className="mt-1.5 text-sm text-content-secondary leading-relaxed">
              We&rsquo;ve updated the document
              {pending.length > 1 ? 's' : ''} below. Please review and accept to
              continue. Your acceptance is recorded with timestamp, IP, and
              browser for audit (DPDP Act 2023 §6).
            </p>
          </div>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col min-h-0">
          <div className="px-6 py-4 space-y-3 overflow-y-auto">
            {pending.map((doc) => {
              const label = KIND_LABEL[doc.kind] || doc.kind;
              const path = KIND_PATH[doc.kind] || '#';
              const effective = formatDate(doc.effective_at);
              return (
                <div
                  key={doc.id}
                  className="rounded-editorial border border-hairline bg-bg-secondary px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-content-primary">
                      {label}
                    </div>
                    <div className="mt-0.5 text-xs text-content-muted tabular-nums">
                      Version {doc.version}
                      {effective && ` · Effective ${effective}`}
                    </div>
                  </div>
                  <a
                    href={path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1.5 py-1"
                  >
                    Read full text
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              );
            })}

            <div className="rounded-editorial border border-hairline-strong bg-bg-secondary px-4 py-3">
              <Checkbox
                id="legal-reaccept-checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={submitting}
                tone={error && !accepted ? 'error' : 'default'}
                label={
                  <span className="text-sm text-content-primary leading-snug">
                    I have read and agree to the updated document
                    {pending.length > 1 ? 's' : ''} above.
                  </span>
                }
              />
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-editorial border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-data-negative"
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-hairline px-6 py-4">
            <button
              type="button"
              onClick={handleSignOut}
              disabled={submitting}
              className={clsx(
                'rounded-editorial border border-hairline bg-bg-elevated px-3 py-2 text-xs font-semibold text-content-secondary',
                'transition-colors duration-150 ease-out',
                'hover:border-hairline-strong hover:text-content-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                submitting && 'opacity-60 cursor-not-allowed',
              )}
            >
              Sign out instead
            </button>
            <button
              type="submit"
              disabled={!accepted || submitting}
              className={clsx(
                'rounded-editorial bg-accent px-4 py-2 text-xs font-semibold text-white',
                'transition-colors duration-150 ease-out',
                'hover:bg-accent-700',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                (!accepted || submitting) && 'opacity-60 cursor-not-allowed',
              )}
            >
              {submitting ? 'Recording…' : 'Accept and continue'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
