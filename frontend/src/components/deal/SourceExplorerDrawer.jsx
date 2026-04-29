import { useEffect } from 'react';
import { ExternalLink, FileText, X, Hash, Calendar, ShieldCheck, AlertCircle } from 'lucide-react';
import Badge from '../common/Badge';

/**
 * T2 Lite — Source Explorer drawer.
 *
 * A right-side drawer that opens when an analyst clicks any citation chip on
 * the Parcel Intelligence panel. Renders the full citation metadata —
 * authority, page, section, confidence, status, source URL — so the analyst
 * doesn't have to hunt for it elsewhere.
 *
 * NOT shipping inline PDF rendering yet. The full T2 design called for an
 * embedded PDF page with bounding-box highlight, but Gemini extraction does
 * not return bounding-box coordinates today and react-pdf adds ~250KB to the
 * bundle. Once Gemini is upgraded to return spatial metadata, this drawer
 * extends to a two-pane layout with the PDF preview on the right.
 *
 * Hard rule respected: every fact carries source + page + confidence + status.
 * No fabrication — empty fields render as em-dash, never a guess.
 */

const STATUS_TONE = {
  matched: 'success',
  approved: 'success',
  reference_only: 'info',
  global_reference: 'info',
  org_override: 'success',
  draft_reference: 'warn',
  needs_verification: 'warn',
  pending: 'neutral',
  rejected: 'danger',
};

const formatStatus = (status) => {
  if (!status) return null;
  return String(status).replace(/_/g, ' ');
};

const formatConfidence = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${Math.round(numeric * 100)}%`;
};

const Field = ({ label, children, mono = false }) => (
  <div className="flex flex-col gap-1 py-3 border-b border-hairline-soft last:border-0">
    <dt className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
      {label}
    </dt>
    <dd className={`text-sm text-content-primary leading-relaxed ${mono ? 'font-mono tabular-nums break-all' : ''}`}>
      {children || <span className="text-content-muted">—</span>}
    </dd>
  </div>
);

export default function SourceExplorerDrawer({ citation, onClose }) {
  useEffect(() => {
    if (!citation) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [citation, onClose]);

  if (!citation) return null;

  const confidencePct = formatConfidence(citation.confidence_score ?? citation.confidence);
  const statusTone = STATUS_TONE[citation.status] || 'neutral';
  const statusLabel = formatStatus(citation.status);

  return (
    <>
      {/* Overlay — opaque enough to focus the drawer, not so dark we lose context */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity duration-150"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-explorer-title"
        className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] bg-bg-primary border-l border-hairline-strong shadow-2xl flex flex-col"
        style={{
          // Slide-in animation matches FRONTEND_GUIDELINES section 8 (drawer 280ms decelerate)
          animation: 'slideInRight 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-hairline-soft">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
              <FileText size={12} />
              Source detail
            </div>
            <h2
              id="source-explorer-title"
              className="mt-1 text-sm font-semibold text-content-primary truncate"
              title={citation.label || citation.source_title}
            >
              {citation.label || citation.source_title || 'Source'}
            </h2>
            {statusLabel && (
              <div className="mt-2">
                <Badge tone={statusTone} className="text-[10px]">
                  {statusLabel}
                </Badge>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            aria-label="Close source detail"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          <dl>
            <Field label="Source title">
              {citation.source_title}
            </Field>
            <Field label="Authority">
              {citation.authority}
            </Field>
            <Field label="Section">
              {citation.section || citation.label}
            </Field>
            <Field label="Page" mono>
              {citation.page ? `p. ${citation.page}` : null}
            </Field>
            <Field label="Confidence">
              {confidencePct ? (
                <span className="inline-flex items-center gap-2 tabular-nums">
                  {confidencePct}
                  {citation.confidence < 0.5 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                      <AlertCircle size={11} />
                      verify before reliance
                    </span>
                  )}
                </span>
              ) : null}
            </Field>
            <Field label="Citation kind" mono>
              {citation.kind}
            </Field>
            <Field label="Citation ID" mono>
              {citation.id}
            </Field>
            {citation.effective_from && (
              <Field label="Effective from">
                {new Date(citation.effective_from).toLocaleDateString('en-IN', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </Field>
            )}
            {citation.notes && (
              <Field label="Notes">
                {citation.notes}
              </Field>
            )}
          </dl>

          {/* Trust note — hard rule reminder */}
          <div className="mt-5 rounded-editorial border border-hairline bg-bg-secondary px-3 py-2.5 text-[11px] leading-relaxed text-content-secondary">
            <div className="flex items-start gap-2">
              <ShieldCheck size={12} className="mt-0.5 shrink-0 text-content-muted" />
              <div>
                Every parcel intelligence claim cites a reviewed source. AI-extracted
                facts require admin approval before they appear here. Inline PDF
                preview with bounding-box highlight will arrive with the next
                Gemini extraction upgrade.
              </div>
            </div>
          </div>
        </div>

        {/* Footer — primary action: open the source */}
        {citation.source_url ? (
          <div className="px-5 py-3 border-t border-hairline-soft bg-bg-secondary">
            <a
              href={citation.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-editorial bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 transition-colors"
            >
              Open source
              <ExternalLink size={12} />
            </a>
          </div>
        ) : (
          <div className="px-5 py-3 border-t border-hairline-soft bg-bg-secondary">
            <div className="inline-flex w-full items-center justify-center gap-2 rounded-editorial border border-hairline bg-bg-primary px-3 py-2 text-xs text-content-muted">
              <Hash size={12} />
              No source URL recorded for this citation.
            </div>
          </div>
        )}
      </aside>

      {/* Inline keyframes — drawer slide-in. Honors prefers-reduced-motion via
          the global media query in index.css. */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
