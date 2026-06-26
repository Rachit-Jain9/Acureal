import Badge from './Badge';
import { deriveCompProvenance } from '../../utils/compProvenance';

// Per-row comp provenance (CLAUDE.md hard rule: source + freshness + confidence,
// or "No verified feed available"). One honest micro-stack:
//   row 1 — source-TYPE chip (neutral chrome + 1px accent dot, reusing the Type-pill
//           pattern) + a VERIFIED status pill (Badge: success only when verified).
//   row 2 — freshness line ("as of <date>"), muted + tabular-nums.
//
// Restraint by design (FRONTEND_GUIDELINES §0, no vibe-code): no gradients, no
// glow, no pulsing dot, no saturated whole-chip tint. Trust comes from a calm,
// legible hierarchy — never decoration. Confidence is the (verified × source-type)
// pair, never a fabricated %. Semantic tokens only (raw Tailwind palette is
// CI-banned). `compact` drops the chip's uppercase tracking for dense tables.
export default function ProvenanceCell({ comp, compact = false, className = '' }) {
  const p = deriveCompProvenance(comp);
  const isNone = p.sourceType === 'none';

  const chip = (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-secondary px-2 py-0.5 ' +
        'text-[11px] font-medium transition-colors duration-150 ease-out ' +
        (compact ? '' : 'uppercase tracking-wide ') +
        (isNone ? 'text-content-muted' : 'text-content-secondary')
      }
    >
      {!isNone && <span className="w-1 h-1 rounded-full bg-accent" aria-hidden="true" />}
      {p.sourceTypeLabel}
    </span>
  );

  return (
    <div className={'flex flex-col gap-1 ' + className}>
      <div className="flex flex-wrap items-center gap-1.5">
        {p.sourceUrl ? (
          <a
            href={p.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={p.sourceText || 'Open source'}
            className="rounded-full transition-opacity duration-150 ease-out hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
          >
            {chip}
          </a>
        ) : (
          <span title={p.sourceText || undefined}>{chip}</span>
        )}
        {/* Status pill — success ONLY when explicitly verified; never green for an
            unverified row (honest trust signal, not decoration). */}
        <Badge tone={p.verified ? 'success' : 'neutral'}>{p.verifiedLabel}</Badge>
      </div>
      {p.freshnessLabel && (
        <span className="text-[10px] text-content-muted tabular-nums">{p.freshnessLabel}</span>
      )}
    </div>
  );
}
