import { AlertTriangle } from 'lucide-react';

// Single source of truth for how REDIP frames the legal status of the
// Bengaluru master plan across every deal-facing surface.
//
// RMP 2031 was exhibited for public objection (Nov 2017 – Jan 2018) but was
// never notified — the State elected to skip it. The last *notified* statutory
// master plan remains RMP 2015 (notified 2007); RMP 2041 is in preparation
// (BDA global tender 2025, draft expected ~2026). REDIP surfaces RMP 2031 as
// reference/screening context only and never asserts statutory status — this
// banner makes that explicit wherever RMP-derived figures appear.
export default function RmpStatusBanner({ className = '' }) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-md border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-900 ${className}`}
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
      <span>
        <span className="font-semibold">RMP 2031 is a draft — never legally notified.</span>{' '}
        It was placed for public objection in 2017 and not adopted. The last notified master plan is{' '}
        <span className="font-medium">RMP&nbsp;2015</span>; <span className="font-medium">RMP&nbsp;2041</span> is being
        prepared (BDA, ~2026). Treat these figures as screening reference and confirm with BDA/BBMP before underwriting.
      </span>
    </div>
  );
}
