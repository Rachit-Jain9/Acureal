import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles, FileText, Image as ImageIcon, AlertTriangle, CheckCircle2,
  Loader2, ArrowLeft, ShieldAlert,
} from 'lucide-react';
import {
  Modal, Button, Badge, EmptyState, ErrorState, Tooltip,
} from '../../design-system';
import { rentRollAPI, documentsAPI } from '../../services/api';
import { useCommitExtract } from '../../hooks/useRentRoll';
import { toast } from '../common/Toast';

// Register AI-EXTRACT — read an already-uploaded rent-roll document (PDF / scan)
// with AI into a STAGED preview (no writes), review every row, then add them.
//
// Deliberately additive and self-contained (does not touch ImportRegisterModal).
// Lease-income registers only — the backend gates the rest. What the model
// proposes is re-validated field-by-field against the column catalog server-
// side; the commit RE-READS the persisted extraction (never trusts these
// preview rows), so what lands is exactly what the server mapped. Rows arrive
// UNVERIFIED and provenance-tagged — the copy says so plainly.

// A glance of key lease columns (the full set is added; this is a preview).
const PREVIEW_COLS = [
  ['record_label', 'Unit'], ['tenant_name', 'Tenant'], ['status', 'Status'],
  ['chargeable_area_sqft', 'Area'], ['base_rent_rate', 'Rate'],
];

// AI reads PDFs and images inline. Other file types (spreadsheets, docs) are
// better handled by the template import, so we steer the user there.
const READABLE_RE = /(pdf|image\/(png|jpe?g|tiff?|webp))/i;
const READABLE_EXT = /\.(pdf|png|jpe?g|tiff?|webp)$/i;
const isReadable = (d) =>
  READABLE_RE.test(d?.mime_type || d?.file_type || '') || READABLE_EXT.test(d?.name || '');

const dash = <span className="text-content-muted">—</span>;
const cell = (v) => (v === null || v === undefined || v === '' ? dash : String(v));
const docIcon = (d) => (/(image|\.(png|jpe?g|tiff?|webp)$)/i.test(d?.mime_type || d?.name || '')
  ? <ImageIcon size={15} className="text-content-muted shrink-0" />
  : <FileText size={15} className="text-content-muted shrink-0" />);

export default function ExtractRegisterButton({ dealId, variant = 'secondary', size = 'sm' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} leftIcon={<Sparkles size={14} />} onClick={() => setOpen(true)}>
        Read with AI
      </Button>
      {open && <ExtractModal dealId={dealId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExtractModal({ dealId, onClose }) {
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const commit = useCommitExtract();

  const docsQuery = useQuery({
    queryKey: ['rent-roll-extract-docs', dealId],
    queryFn: () => documentsAPI.list(dealId).then((r) => r.data.data),
    staleTime: 30 * 1000,
  });
  const documents = docsQuery.data?.documents || [];

  const runExtract = async (doc) => {
    setSelectedDoc(doc);
    setError(null);
    setPreview(null);
    setReading(true);
    try {
      const res = await rentRollAPI.previewExtract(dealId, doc.id);
      setPreview(res.data.data);
    } catch (err) {
      setError(err?.response?.data?.message
        || 'That document could not be read. Try another file, or fill the register from the template instead.');
    } finally {
      setReading(false);
    }
  };

  const reset = () => { setSelectedDoc(null); setPreview(null); setError(null); };

  const handleCommit = () => {
    commit.mutate({ dealId, extractionId: preview.extractionId }, {
      onSuccess: (res) => {
        const n = res?.data?.total ?? 0;
        toast.success(`Added ${n} lease${n === 1 ? '' : 's'}${selectedDoc?.name ? ` from ${selectedDoc.name}` : ''}. Review each before you rely on it.`);
        onClose();
      },
    });
  };

  const total = preview?.totalRows ?? 0;
  const rows = preview?.kinds?.lease?.rows || [];
  const warnings = preview?.warnings || [];
  const busy = reading || commit.isPending;
  const showBack = (preview || error) && !busy;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      closeOnOverlayClick={!busy}
      title="Read a rent roll with AI"
      description="Pick a document you’ve already uploaded. AI reads it into a draft you review before anything is added — nothing is saved until you confirm."
      size="lg"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-content-muted truncate max-w-[16rem]">
            {selectedDoc
              ? <span className="inline-flex items-center gap-1.5">{docIcon(selectedDoc)} {selectedDoc.name}</span>
              : 'No document selected'}
          </div>
          <div className="flex items-center gap-2">
            {showBack && (
              <Button variant="ghost" size="sm" leftIcon={<ArrowLeft size={14} />} onClick={reset}>
                Choose another
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            {preview && (
              <Button
                variant="primary"
                loading={commit.isPending}
                disabled={total === 0}
                onClick={handleCommit}
                leftIcon={<CheckCircle2 size={14} />}
              >
                {total > 0 ? `Add ${total} lease${total === 1 ? '' : 's'}` : 'Nothing to add'}
              </Button>
            )}
          </div>
        </div>
      )}
    >
      {/* Reading — honest, indeterminate wait (can take up to a minute) */}
      {reading && (
        <div className="py-10 text-center">
          <Loader2 size={26} className="mx-auto text-accent motion-safe:animate-spin" />
          <div className="text-sm font-medium text-content-primary mt-3">Reading {selectedDoc?.name || 'the document'}…</div>
          <div className="text-xs text-content-muted mt-1">This can take up to a minute for a multi-page rent roll.</div>
        </div>
      )}

      {/* Error */}
      {error && !reading && (
        <ErrorState tone="danger" title="That document couldn’t be read">{error}</ErrorState>
      )}

      {/* Document picker */}
      {!preview && !reading && !error && (
        <div className="space-y-3">
          {docsQuery.isLoading && (
            <div className="py-8 text-center text-sm text-content-muted">Loading your documents…</div>
          )}

          {!docsQuery.isLoading && documents.length === 0 && (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description="Upload a rent-roll PDF or scan in this deal’s Documents tab, then come back to read it here."
            />
          )}

          {!docsQuery.isLoading && documents.length > 0 && (
            <>
              <div className="text-xs text-content-muted">
                Choose the document to read. AI reads PDFs and image scans.
              </div>
              <ul className="space-y-1.5 max-h-[22rem] overflow-y-auto pr-1">
                {documents.map((doc) => {
                  const readable = isReadable(doc);
                  const row = (
                    <button
                      type="button"
                      disabled={!readable}
                      onClick={() => runExtract(doc)}
                      className={[
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-editorial border text-left',
                        'transition-colors duration-150 ease-out',
                        readable
                          ? 'border-hairline hover:border-accent/50 hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.995]'
                          : 'border-hairline-soft opacity-55 cursor-not-allowed',
                      ].join(' ')}
                    >
                      {docIcon(doc)}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-content-primary truncate">{doc.name}</span>
                        <span className="block text-xs text-content-muted truncate">
                          {(doc.category || doc.doc_category || 'document')}
                          {doc.doc_type ? ` · ${String(doc.doc_type).replace(/_/g, ' ')}` : ''}
                        </span>
                      </span>
                      {readable
                        ? <Sparkles size={14} className="text-accent shrink-0" />
                        : <Badge tone="neutral">Use import</Badge>}
                    </button>
                  );
                  return (
                    <li key={doc.id}>
                      {readable ? row : (
                        <Tooltip content="AI reads PDFs and image scans. For spreadsheets or docs, use the template import.">
                          {row}
                        </Tooltip>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Preview */}
      {preview && !reading && (
        <div className="space-y-4">
          {/* Honest, non-negotiable framing: AI-read, unverified, review first. */}
          <div className="flex items-start gap-2 rounded-editorial border border-hairline bg-bg-secondary px-3 py-2.5">
            <ShieldAlert size={15} className="text-data-warning shrink-0 mt-0.5" />
            <p className="text-xs text-content-secondary leading-relaxed">
              These rows were <span className="text-content-primary font-medium">read by AI and are not verified</span>.
              Check every unit, tenant, area, rent and date against the source document before you rely on them.
              They’re added as <span className="text-content-primary">unverified</span> and tagged to this document.
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm flex-wrap">
            {total > 0 ? (
              <>
                <CheckCircle2 size={16} className="text-data-positive" />
                <span className="text-content-primary font-medium">{total} lease{total === 1 ? '' : 's'} read</span>
                <span className="text-content-muted">from {selectedDoc?.name}</span>
              </>
            ) : (
              <>
                <AlertTriangle size={16} className="text-data-warning" />
                <span className="text-content-secondary">No leases could be read from this document.</span>
              </>
            )}
          </div>

          {preview.truncated && (
            <div className="text-xs text-data-warning">
              Only the first rows were kept — this document holds more than the per-read limit. Read it in parts, or use the template import.
            </div>
          )}

          {total > 0 && (
            <div className="border border-hairline rounded-editorial overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline-soft">
                      {PREVIEW_COLS.map(([, h]) => (
                        <th key={h} className="px-3 py-1.5 text-left text-eyebrow uppercase tracking-[0.06em] text-content-muted font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-b border-hairline-soft last:border-0">
                        {PREVIEW_COLS.map(([k]) => (
                          <td key={k} className="px-3 py-1.5 text-content-secondary tabular-nums">{cell(r[k])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {total > 8 && (
                  <div className="px-3 py-1.5 text-xs text-content-muted border-t border-hairline-soft">+{total - 8} more lease{total - 8 === 1 ? '' : 's'}</div>
                )}
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <details className="border border-hairline rounded-editorial">
              <summary className="cursor-pointer px-3 py-2 text-sm text-data-warning flex items-center gap-1.5 select-none">
                <AlertTriangle size={14} /> {warnings.length} value{warnings.length === 1 ? '' : 's'} left out — click to review
              </summary>
              <ul className="px-3 pb-3 pt-1 space-y-1 max-h-40 overflow-y-auto">
                {warnings.slice(0, 60).map((w, i) => (
                  <li key={i} className="text-xs text-content-muted">row {w.row}: {w.message}</li>
                ))}
                {warnings.length > 60 && <li className="text-xs text-content-muted">…and {warnings.length - 60} more.</li>}
              </ul>
            </details>
          )}

          {preview.parseError && (
            <p className="text-xs text-content-muted">Note: {preview.parseError}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
