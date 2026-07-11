// Public sub-processor disclosure page. Lists the third-party services REDIP
// relies on to deliver the platform, the data each handles, and where it runs.
// A standard enterprise-diligence + DPDP-transparency artifact. Uses raw
// light-theme classes (independent of the app theme switch), mirroring the
// other public legal pages.

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Server } from 'lucide-react';
import usePublicLightTheme from '../../hooks/usePublicLightTheme';
import PublicFooter from '../../components/common/PublicFooter';

// When this list changes materially, bump the date and announce the change to
// customers per the Privacy Policy. Kept in code (not the DB) so every change
// is a reviewed commit.
const LAST_UPDATED = '20 May 2026';

const SUBPROCESSORS = [
  {
    name: 'Supabase',
    purpose: 'Managed PostgreSQL database and uploaded-document storage.',
    data: 'All account, deal, and uploaded-document data.',
    location: 'India — Mumbai (ap-south-1)',
  },
  {
    name: 'Vercel',
    purpose: 'Application hosting, serverless compute, and content delivery.',
    data: 'Request traffic and application logs.',
    location: 'Global edge network; United States',
  },
  {
    name: 'Anthropic',
    purpose: 'AI — narrative synthesis and document-extraction fallback.',
    data: 'Only the document text or prompt needed for a specific request.',
    location: 'United States',
  },
  {
    name: 'OpenAI',
    purpose: 'AI — reasoning, market synthesis, and text embeddings.',
    data: 'Only the document text or prompt needed for a specific request.',
    location: 'United States',
  },
  {
    name: 'Google',
    purpose: 'Gemini AI (document extraction), Google sign-in, and Maps geocoding.',
    data: 'Document content for extraction; sign-in identity claims; addresses and coordinates for geocoding.',
    location: 'Global; United States',
  },
  {
    name: 'Resend',
    purpose: 'Transactional email — address verification and workspace invitations.',
    data: 'Recipient email address and message content.',
    location: 'United States',
  },
];

const Field = ({ label, children }) => (
  <div>
    <dt className="text-[11px] uppercase tracking-[0.14em] text-content-muted font-medium mb-1">
      {label}
    </dt>
    <dd className="text-content-secondary leading-relaxed">{children}</dd>
  </div>
);

export default function SubprocessorsPage() {
  usePublicLightTheme();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-bg-secondary flex flex-col">
      <header className="border-b border-hairline bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="inline-flex items-center gap-1.5 text-sm text-content-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded px-2 py-1"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <span className="font-serif text-lg font-semibold text-content-primary">
            REDIP<span className="text-[#c2410c]">.</span>
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex-1 w-full">
        <div className="text-[11px] uppercase tracking-[0.14em] text-content-muted mb-2 font-medium">
          REDIP · Legal
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-content-primary tracking-tight flex items-center gap-3">
          <Server size={26} className="text-[#c2410c] shrink-0" aria-hidden="true" />
          Sub-processors
        </h1>
        <p className="text-sm text-content-secondary mt-3 leading-relaxed max-w-2xl">
          A sub-processor is a third-party service REDIP uses to deliver the platform. We
          keep this list current so customers and their reviewers can see exactly who
          processes data on REDIP's behalf, what each one handles, and where it runs.
          Each sub-processor is bound by its own data-protection terms, and REDIP
          transmits only the minimum data each needs to perform its function. For the
          full picture, see the{' '}
          <a
            href="/privacy"
            className="text-[#c2410c] underline underline-offset-2 hover:text-[#9a3412]"
          >
            Privacy Policy
          </a>
          .
        </p>

        <div className="space-y-3 mt-8">
          {SUBPROCESSORS.map((s) => (
            <section
              key={s.name}
              className="bg-white rounded-sm border border-hairline shadow-sm p-5"
            >
              <h2 className="font-serif text-base font-semibold text-content-primary tracking-tight">
                {s.name}
              </h2>
              <dl className="mt-3 grid sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <Field label="Purpose">{s.purpose}</Field>
                <Field label="Data handled">{s.data}</Field>
                <Field label="Location">{s.location}</Field>
              </dl>
            </section>
          ))}
        </div>

        <section className="bg-white rounded-sm border border-hairline shadow-sm p-5 mt-6">
          <div className="text-[11px] uppercase tracking-[0.14em] text-content-muted font-medium mb-1.5">
            Note on data residency
          </div>
          <p className="text-sm text-content-secondary leading-relaxed">
            Account, deal, and document data is stored in India (Mumbai). AI processing
            is performed by US-based providers; only the specific text or document
            content required for a feature is transmitted, over an encrypted connection,
            for that single request. Map-tile providers receive geographic
            coordinates only — never personal or deal data. Enterprise customers
            requiring India-only AI processing should raise this during contracting.
          </p>
        </section>

        <p className="text-xs text-content-muted mt-6 leading-relaxed">
          Last updated: {LAST_UPDATED}. Material changes to this list are announced to
          customers in line with the Privacy Policy.
        </p>

        <footer className="mt-12 pt-6 border-t border-hairline text-xs text-content-muted">
          See also{' '}
          <a href="/terms" className="text-[#c2410c] underline underline-offset-2">
            Terms of Service
          </a>{' '}
          ·{' '}
          <a href="/privacy" className="text-[#c2410c] underline underline-offset-2">
            Privacy Policy
          </a>{' '}
          ·{' '}
          <a href="/grievance" className="text-[#c2410c] underline underline-offset-2">
            Grievance Officer
          </a>
          .
        </footer>
      </main>

      <PublicFooter />
    </div>
  );
}
