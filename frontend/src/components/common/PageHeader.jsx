/**
 * PageHeader — editorial page banner.
 *
 * Pattern: small uppercase eyebrow above a tight display title, then a
 * supporting caption. Mirrors the FT / Bloomberg / Linear doc-header feel.
 * Actions sit on the right, separated by a hairline on large screens so
 * the title stays the visual anchor.
 *
 * API unchanged: `{ title, description, actions }`. New optional prop
 * `eyebrow` for the tiny uppercase context line above the title.
 */
export default function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="eyebrow mb-1.5 dark:text-slate-400">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 dark:text-white">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
