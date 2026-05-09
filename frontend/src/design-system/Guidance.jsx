import clsx from 'clsx';
import { BookOpen, CheckCircle2, HelpCircle, Info, X } from 'lucide-react';

export function HelpTip({ label, children, className }) {
  return (
    <span className={clsx('group relative inline-flex', className)}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-bg-elevated text-content-muted transition-colors hover:border-hairline-soft hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 active:scale-[0.98]"
      >
        <HelpCircle size={13} aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-6 z-30 hidden w-64 rounded-lg border border-hairline bg-bg-elevated p-3 text-xs leading-relaxed text-content-secondary shadow-editorial group-hover:block group-focus-within:block"
      >
        {children}
      </span>
    </span>
  );
}

export function HelpDrawer({ open, title, eyebrow = 'Guidance', sections = [], onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[1px]">
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-hairline bg-bg-elevated shadow-editorial">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-hairline bg-bg-elevated px-5 py-4">
          <div className="min-w-0">
            <p className="text-eyebrow uppercase text-content-muted">{eyebrow}</p>
            <h2 className="mt-1 text-lg font-semibold text-content-primary">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-bg-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 active:scale-[0.98]"
            aria-label="Close help drawer"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-5 px-5 py-5">
          {sections.map((section) => (
            <section key={section.title} className="rounded-lg border border-hairline bg-bg-secondary p-4">
              <div className="flex items-start gap-3">
                <BookOpen size={16} className="mt-0.5 shrink-0 text-content-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-content-primary">{section.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-content-secondary">{section.body}</p>
                </div>
              </div>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function SmartEmptyState({ title, body, action, className }) {
  return (
    <div className={clsx('rounded-editorial border border-hairline bg-bg-elevated p-5', className)}>
      <div className="flex items-start gap-3">
        <Info size={17} className="mt-0.5 shrink-0 text-content-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-content-primary">{title}</h3>
          {body && <p className="mt-1 text-sm leading-relaxed text-content-secondary">{body}</p>}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

export function EvidenceChip({
  label,
  source = 'No verified feed available',
  freshness = 'Not refreshed',
  confidence = 'Pending',
  reviewer = 'Human review required',
  onClick,
  className,
}) {
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'inline-flex max-w-full items-center gap-2 rounded-full border border-hairline bg-bg-secondary px-3 py-1.5 text-xs text-content-secondary transition-colors',
        onClick && 'hover:border-hairline-soft hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 active:scale-[0.99]',
        className,
      )}
      title={`${source} | ${freshness} | ${confidence} | ${reviewer}`}
    >
      <CheckCircle2 size={13} className="shrink-0 text-content-muted" aria-hidden="true" />
      <span className="truncate font-medium text-content-primary">{label}</span>
      <span className="hidden text-content-muted sm:inline">|</span>
      <span className="hidden truncate sm:inline">{confidence}</span>
    </Comp>
  );
}
