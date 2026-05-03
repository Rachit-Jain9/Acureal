// Shared shell for the Terms / Privacy / Cookie public pages. Each concrete
// page just specifies which `kind` it renders. Markdown body is fetched via
// the public /api/legal/active endpoint (no auth required).

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Info } from 'lucide-react';
import { useLegalActive } from '../../hooks/useLegalActive';
import usePublicLightTheme from '../../hooks/usePublicLightTheme';
import Markdown from '../../components/common/Markdown';

// Local light-theme error/info card primitive — sized for legal pages and
// independent of the dashboard's design-system tokens (which assume dark
// theme). Two tones: `danger` (rose) for fetch failure, `info` (sky) for
// not-yet-published.
function Notice({ tone = 'danger', title, children }) {
  const styles =
    tone === 'info'
      ? { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-900', icon: 'text-sky-600' }
      : {
          bg: 'bg-rose-50',
          border: 'border-rose-200',
          text: 'text-rose-900',
          icon: 'text-rose-600',
        };
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      role="status"
      className={`flex gap-3 items-start border rounded-sm p-4 ${styles.bg} ${styles.border} ${styles.text}`}
    >
      <Icon size={18} className={`shrink-0 mt-0.5 ${styles.icon}`} />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-sm mb-0.5">{title}</div>}
        {children && <div className="text-sm leading-relaxed opacity-90">{children}</div>}
      </div>
    </div>
  );
}

const KIND_TITLES = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
  cookie_policy: 'Cookie Policy',
  data_processing_addendum: 'Data Processing Addendum',
  acceptable_use: 'Acceptable Use Policy',
};

const formatDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function LegalDocPage({ kind }) {
  usePublicLightTheme();
  const navigate = useNavigate();
  const { data, loading, error } = useLegalActive();
  const doc = data?.[kind] || null;
  const title = KIND_TITLES[kind] || 'Legal';

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded px-2 py-1"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <span className="font-serif text-lg font-semibold text-stone-900">
            REDIP<span className="text-[#c2410c]">.</span>
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-2 font-medium">
          REDIP · Legal
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-stone-900 tracking-tight">
          {title}
        </h1>
        {doc && (
          <p className="text-sm text-stone-500 mt-2">
            Version {doc.version}
            {formatDate(doc.effective_at) && ` · Effective ${formatDate(doc.effective_at)}`}
          </p>
        )}

        <div className="mt-8">
          {loading && (
            <div role="status" aria-busy="true" className="space-y-3 animate-pulse">
              <div className="h-4 bg-stone-200 rounded w-3/4" />
              <div className="h-4 bg-stone-200 rounded w-5/6" />
              <div className="h-4 bg-stone-200 rounded w-2/3" />
              <div className="h-4 bg-stone-200 rounded w-3/4" />
              <div className="h-4 bg-stone-200 rounded w-4/6" />
            </div>
          )}

          {!loading && error && (
            <Notice tone="danger" title="Could not load this document">
              The document could not be retrieved. Please try again in a moment, or contact{' '}
              <a className="underline" href="mailto:grievance@redip.in">grievance@redip.in</a>.
            </Notice>
          )}

          {!loading && !error && !doc && (
            <Notice tone="info" title="Not yet published">
              This document has not been published yet. Please check back shortly.
            </Notice>
          )}

          {!loading && !error && doc && <Markdown>{doc.body_md}</Markdown>}
        </div>

        <footer className="mt-12 pt-6 border-t border-stone-200 text-xs text-stone-500">
          Questions about this document? Email{' '}
          <a href="mailto:grievance@redip.in" className="text-[#c2410c] underline underline-offset-2">
            grievance@redip.in
          </a>
          .
        </footer>
      </main>
    </div>
  );
}
