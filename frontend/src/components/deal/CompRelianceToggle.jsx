import { Star, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Comp-reliance toggle — Workstream C1 (the data-network seed).
 *
 * A per-comp star the analyst flips to record "I relied on this comparable
 * when underwriting this deal". The toggle drives durable state and a
 * values-free learning signal server-side; this component is pure UI.
 */
export default function CompRelianceToggle({ relied, onToggle, isPending = false }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isPending}
      aria-pressed={!!relied}
      title={
        relied
          ? 'Relied on for this deal — click to unmark'
          : 'Mark this comparable as one you relied on for this deal'
      }
      className={clsx(
        'inline-flex items-center justify-center w-7 h-7 rounded-full border',
        'transition-all duration-150 ease-out active:scale-[0.95]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
        'disabled:opacity-60 disabled:cursor-default',
        relied
          ? 'border-amber-300 bg-amber-50 text-amber-600'
          : 'border-hairline-strong text-content-muted hover:border-amber-300 hover:text-amber-600',
      )}
    >
      {isPending ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <Star size={13} className={relied ? 'fill-amber-400' : ''} />
      )}
    </button>
  );
}
