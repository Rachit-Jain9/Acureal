import { AlertTriangle, CheckCircle2 } from 'lucide-react';

// Single source of truth for how REDIP frames the legal status of the governing
// master plan across every deal-facing surface — now PLAN-AWARE.
//
// Two operative statutory plans exist in REDIP: the BDA's RMP 2015 (notified
// 2007) and the Anekal LPA Master Plan 2031 (BMRDA, notified 2014). For a parcel
// governed by either, this renders a calm "operative plan" note.
//
// The Bengaluru RMP 2031 was exhibited for public objection (Nov 2017–Jan 2018)
// but was never notified — the State elected to skip it. When a surface shows
// RMP-2031-derived figures (or no plan is identified), this renders the amber
// "draft — not legally notified" caveat so REDIP never asserts statutory status
// for a draft. The default (no `planVersion`) keeps that caveat.
export default function RmpStatusBanner({ className = '', planVersion = null, planName = null }) {
  const v = String(planVersion || '').toLowerCase();
  const isAnekal = v.includes('anekal');
  const isRmp2015 = v.includes('2015');

  // Operative, notified plan → calm note (never the "draft" warning).
  if (isAnekal || isRmp2015) {
    const label = planName || planVersion;
    const detail = isAnekal
      ? 'Operative master plan for the Anekal Local Planning Area (BMRDA), notified 2014. Figures are screening reference — confirm with the Anekal Planning Authority before underwriting.'
      : 'Operative statutory master plan for the BDA Local Planning Area (notified 2007). Figures are screening reference — confirm with BDA/BBMP before underwriting.';
    return (
      <div
        role="note"
        className={`flex items-start gap-2 rounded-md border border-emerald-500/30 border-l-4 border-l-emerald-500 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-content-secondary ${className}`}
      >
        <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
        <span>
          <span className="font-semibold text-content-primary">Operative plan{label ? `: ${label}` : ''}.</span>{' '}
          {detail}
        </span>
      </div>
    );
  }

  // Default / Bengaluru RMP 2031 → withdrawn-draft caveat (theme-correct tints).
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-md border border-amber-500/30 border-l-4 border-l-amber-500 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-content-secondary ${className}`}
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
      <span>
        <span className="font-semibold text-content-primary">RMP 2031 is a draft — never legally notified.</span>{' '}
        It was placed for public objection in 2017 and not adopted. The last notified master plan is{' '}
        <span className="font-medium">RMP&nbsp;2015</span>; <span className="font-medium">RMP&nbsp;2041</span> is being
        prepared (BDA, ~2026). Treat these figures as screening reference and confirm with BDA/BBMP before underwriting.
      </span>
    </div>
  );
}
