/**
 * PageHeader — editorial page banner (Precision Analysis).
 *
 * Small uppercase eyebrow above a tight display title, then a supporting
 * caption. All ink routes through CSS variables so the banner repaints
 * on a single `data-theme` attribute flip.
 */
export default function PageHeader({
  title,
  description,
  // `sub` is the design-system SectionHeader's caption prop name; several
  // admin pages (Audit Trail, Learning Signals, A/B Eval, Admin Home) were
  // copy-pasted with `sub=` and `right=` and silently dropped their subtitle
  // + header control because this component only read `description`/`actions`.
  // Accept all the aliases so those captions + buttons render.
  sub,
  actions,
  action,
  right,
  eyebrow,
}) {
  const caption = description ?? sub;
  const trailing = actions ?? action ?? right;
  return (
    <div
      className="mb-8 flex flex-col gap-4 pb-5 md:flex-row md:items-end md:justify-between"
      style={{ borderBottom: '1px solid var(--color-border-primary)' }}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p
            className="mb-1.5"
            style={{
              fontSize: '0.6875rem',
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              color: 'var(--color-text-muted)',
              fontWeight: 500,
            }}
          >
            {eyebrow}
          </p>
        )}
        <h1
          className="font-display tracking-tight"
          style={{
            fontSize: '1.75rem',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
          }}
        >
          {title}
        </h1>
        {caption && (
          <p
            className="mt-1.5 max-w-2xl leading-relaxed"
            style={{
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)',
            }}
          >
            {caption}
          </p>
        )}
      </div>
      {trailing && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{trailing}</div>
      )}
    </div>
  );
}
