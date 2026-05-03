// Static grievance officer page. Required by IT Rules 2021 Rule 3(11) and
// DPDP Act 2023 §8(9). Uses raw light-theme classes so the rendering is
// independent of the app theme switch.

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MapPin } from 'lucide-react';
import usePublicLightTheme from '../../hooks/usePublicLightTheme';

const Card = ({ className = '', children, eyebrow, title, ...rest }) => (
  <section
    className={`bg-white rounded-sm border border-stone-200 shadow-sm p-5 ${className}`.trim()}
    {...rest}
  >
    {(eyebrow || title) && (
      <header className="mb-3">
        {eyebrow && (
          <div className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-1.5">
            {eyebrow}
          </div>
        )}
        {title && (
          <h2 className="font-serif text-base font-semibold text-stone-900 tracking-tight">
            {title}
          </h2>
        )}
      </header>
    )}
    {children}
  </section>
);

export default function GrievancePage() {
  usePublicLightTheme();
  const navigate = useNavigate();

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
          Grievance Officer
        </h1>
        <p className="text-sm text-stone-700 mt-3 leading-relaxed max-w-2xl">
          In compliance with Rule 3(11) of the Information Technology (Intermediary Guidelines and
          Digital Media Ethics Code) Rules, 2021, and §8(9) of the Digital Personal Data Protection
          Act, 2023, the following officer is appointed to receive and address user grievances.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 mt-8">
          <Card eyebrow="Officer" title="Privacy Contact (Acting)">
            <div className="space-y-3 text-sm text-stone-700">
              <div className="flex items-start gap-2">
                <Mail size={14} className="text-stone-500 mt-0.5 shrink-0" />
                <a
                  href="mailto:grievance@redip.in"
                  className="text-[#c2410c] underline underline-offset-2 break-all hover:text-[#9a3412]"
                >
                  grievance@redip.in
                </a>
              </div>
              <div className="flex items-start gap-2">
                <MapPin size={14} className="text-stone-500 mt-0.5 shrink-0" />
                <span>Bengaluru, Karnataka, India</span>
              </div>
              <div className="flex items-start gap-2">
                <Phone size={14} className="text-stone-500 mt-0.5 shrink-0" />
                <span className="text-stone-500">Phone available on request</span>
              </div>
            </div>
            <p className="text-xs text-stone-500 mt-4 leading-relaxed">
              Working hours: Mon–Fri, 10:00–18:00 IST (excluding Indian public holidays).
            </p>
          </Card>

          <Card eyebrow="Service-level commitment" title="Acknowledgement & resolution">
            <ul className="space-y-2 text-sm text-stone-700 list-disc pl-5 leading-relaxed">
              <li>
                Acknowledgement within <strong className="text-stone-900">24 hours</strong> of
                receipt.
              </li>
              <li>
                Resolution within <strong className="text-stone-900">15 days</strong> of receipt
                for routine grievances.
              </li>
              <li>
                For DPDP Act data-principal-rights requests, response within statutory timelines.
              </li>
              <li>
                Cyber-incident reports are escalated to CERT-In within 6 hours per CERT-In
                Directions, April 2022.
              </li>
            </ul>
          </Card>
        </div>

        <Card className="mt-6" eyebrow="What you can raise" title="Eligible grievances">
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-stone-700 list-disc pl-5 leading-relaxed">
            <li>Account access / suspected unauthorized access</li>
            <li>Personal data corrections, deletion, or access (DPDP rights)</li>
            <li>Concerns about content posted by you or affecting you</li>
            <li>Concerns about AI-extracted output accuracy</li>
            <li>Cyber-incident or breach concerns</li>
            <li>Any other privacy or terms-related grievance</li>
          </ul>
        </Card>

        <Card className="mt-6" eyebrow="Escalation" title="If unsatisfied">
          <p className="text-sm text-stone-700 leading-relaxed">
            You may approach the Data Protection Board of India (once constituted under the DPDP
            Act, 2023) or the courts at Bengaluru, Karnataka. REDIP cooperates with lawful requests
            from competent Indian authorities.
          </p>
        </Card>

        <footer className="mt-12 pt-6 border-t border-stone-200 text-xs text-stone-500">
          See also{' '}
          <a href="/terms" className="text-[#c2410c] underline underline-offset-2">
            Terms of Service
          </a>{' '}
          ·{' '}
          <a href="/privacy" className="text-[#c2410c] underline underline-offset-2">
            Privacy Policy
          </a>{' '}
          ·{' '}
          <a href="/cookies" className="text-[#c2410c] underline underline-offset-2">
            Cookie Policy
          </a>
          .
        </footer>
      </main>
    </div>
  );
}
