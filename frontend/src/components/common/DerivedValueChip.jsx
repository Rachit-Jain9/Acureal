import { useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Info } from 'lucide-react';

/**
 * DerivedValueChip — small inline pill showing the source + confidence
 * of an auto-derived value, with a hover/focus popover that reveals
 * the full provenance (source, confidence %, age, free-form extras).
 *
 * Built for the Phase C provenance polish (PR-C1): every auto-derived
 * field on AutoFillParcelContextCard (and downstream cards in follow-up
 * PRs) gets one of these chips so IC reviewers can trace any number
 * back to its source in one click.
 *
 * Accessibility:
 *   - Focusable <button> (Tab reaches it, Enter/Space toggles popover)
 *   - Escape dismisses
 *   - Popover is `role="tooltip"` + `aria-describedby` wiring
 *   - Hover also opens (mouse parity)
 *   - prefers-reduced-motion respected by Tailwind's `motion-safe:`
 *
 * Props:
 *   source        — string label (e.g. "google", "BBMP street index").
 *   confidence    — number 0-1 (null/undefined = hide the % pill).
 *   derivedAt     — ISO timestamp string (optional, drives "derived Xs ago" line).
 *   extras        — array of {label, value} pairs for additional context
 *                   shown in the popover (e.g. source_page, alternates count).
 *   tone          — 'info' (default) | 'success' | 'warn' | 'neutral'.
 *   compact       — when true, hides the confidence % from the inline chip
 *                   (still shown in popover). Useful for dense layouts.
 *   className     — pass-through.
 *   onClick       — optional extra handler (e.g. open a detail drawer).
 */

const TONE_CLASS = {
  info: 'bg-bg-secondary border-hairline text-content-secondary hover:bg-bg-elevated hover:border-hairline-strong',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100',
  warn: 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100',
  neutral: 'bg-bg-secondary border-hairline text-content-muted hover:bg-bg-elevated',
};

const formatAge = (iso) => {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
};

export default function DerivedValueChip({
  source,
  confidence = null,
  derivedAt = null,
  extras = null,
  tone = 'info',
  compact = false,
  className = '',
  onClick,
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const popoverId = useId();
  const confidencePct = typeof confidence === 'number' ? Math.round(confidence * 100) : null;
  const age = formatAge(derivedAt);

  // Close popover on Escape when focused.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Click-outside dismissal.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <span
      className={clsx('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          setOpen((prev) => !prev);
          onClick?.(e);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
        className={clsx(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border',
          'transition-colors duration-150 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
          'active:scale-[0.97]',
          TONE_CLASS[tone] || TONE_CLASS.info,
        )}
        data-testid="derived-value-chip"
      >
        <Info size={9} aria-hidden="true" />
        <span className="truncate max-w-[120px]">{source || 'derived'}</span>
        {!compact && confidencePct !== null && (
          <span className="tabular-nums opacity-75">{confidencePct}%</span>
        )}
      </button>
      {open && (
        <span
          id={popoverId}
          role="tooltip"
          className={clsx(
            'absolute left-0 top-full mt-1 z-30 min-w-[200px] max-w-[280px]',
            'rounded-md border border-hairline bg-bg-elevated shadow-lg',
            'px-3 py-2 text-[11px] text-content-primary normal-case tracking-normal font-normal',
            'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150',
          )}
          data-testid="derived-value-chip-popover"
        >
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-content-muted">Provenance</span>
            {age && <span className="text-[10px] text-content-muted">{age}</span>}
          </div>
          <dl className="space-y-1">
            <div className="flex items-baseline gap-2">
              <dt className="text-content-muted shrink-0 w-16">Source</dt>
              <dd className="font-medium break-words">{source || '—'}</dd>
            </div>
            {confidencePct !== null && (
              <div className="flex items-baseline gap-2">
                <dt className="text-content-muted shrink-0 w-16">Confidence</dt>
                <dd className="font-medium tabular-nums">{confidencePct}%</dd>
              </div>
            )}
            {Array.isArray(extras) &&
              extras
                .filter((e) => e && (e.value !== undefined && e.value !== null && e.value !== ''))
                .map((e) => (
                  <div key={e.label} className="flex items-baseline gap-2">
                    <dt className="text-content-muted shrink-0 w-16">{e.label}</dt>
                    <dd className="font-medium break-words">{String(e.value)}</dd>
                  </div>
                ))}
          </dl>
        </span>
      )}
    </span>
  );
}
