import { useState } from 'react';
import { Trash2, FileText, ExternalLink, CheckCircle2, Sparkles, Link as LinkIcon, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Modal } from '../../design-system';
import {
  useEvidenceLinks,
  useAttachEvidenceLink,
  useDetachEvidenceLink,
} from '../../hooks/useEvidenceLinks';
import { useDocuments } from '../../hooks/useDocuments';

/**
 * ManageEvidenceModal — the attach / detach surface for the Provenance Spine.
 *
 * Opened from the "Manage" footer of an `EvidenceBadge` pop-over. Lets the
 * operator:
 *   1. See every currently-linked piece of evidence and remove ones that no
 *      longer belong.
 *   2. Attach a new piece of evidence in one of three shapes:
 *        • "Document"            — pick from the deal's uploaded documents
 *                                  (requires `dealId`; otherwise the tab is
 *                                  disabled with a hint to upload first).
 *        • "Manual verification" — free-text notes + confidence; useful for
 *                                  EC scans, registry visits, phone calls.
 *        • "External URL"        — paste a link to a Bhoomi page, RERA
 *                                  listing, news article, etc.
 *
 * The modal owns no source-of-truth state of its own — it reads through
 * `useEvidenceLinks(ownerKind, ownerId)` and writes through `useAttach…` /
 * `useDetach…`. React Query handles cache invalidation, so the caller's
 * chip refreshes the moment a link is added or removed.
 */

const LINK_KIND_OPTIONS = [
  { value: 'document', label: 'Document', icon: FileText, desc: 'Pick from this deal\'s uploaded documents.' },
  { value: 'manual_verification', label: 'Manual verification', icon: CheckCircle2, desc: 'Logged an EC scan, registry visit, or phone confirmation.' },
  { value: 'external_url', label: 'External URL', icon: ExternalLink, desc: 'Link to Bhoomi, RERA, a news article, etc.' },
];

const formatRelativeTime = (iso) => {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN');
};

const formatConfidence = (score) => {
  if (score == null || Number.isNaN(Number(score))) return null;
  return `${Math.round(Math.max(0, Math.min(1, Number(score))) * 100)}%`;
};

const LINK_TITLE = (link) => {
  if (link.evidence_source_title) return link.evidence_source_title;
  if (link.document_name) return link.document_name;
  if (link.evidence_fact_key) return link.evidence_fact_key;
  if (link.external_url) {
    try { return new URL(link.external_url).hostname; } catch { return link.external_url.slice(0, 50); }
  }
  if (link.link_kind === 'manual_verification') return 'Manual verification';
  return 'Linked evidence';
};

const FIELD_LABEL = 'block text-[11px] font-medium text-content-secondary mb-1';
const INPUT_CLS  = 'w-full text-sm px-2.5 py-1.5 rounded-md border border-hairline bg-bg-elevated text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30';

export default function ManageEvidenceModal({
  open,
  onClose,
  ownerKind,
  ownerId,
  ownerLabel,
  dealId,
}) {
  const { data, isLoading } = useEvidenceLinks(ownerKind, ownerId, { enabled: open });
  const attach = useAttachEvidenceLink(ownerKind, ownerId);
  const detach = useDetachEvidenceLink(ownerKind, ownerId);

  // Documents for the deal — only loaded when a deal id is available and
  // the user opens the modal. Filters to the current deal so the dropdown
  // doesn't dump every workspace doc.
  const { data: docs } = useDocuments(dealId);

  const [linkKind, setLinkKind] = useState('document');
  const [docId, setDocId] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [confidence, setConfidence] = useState('');
  const [notes, setNotes] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const [sourceSection, setSourceSection] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const resetForm = () => {
    setDocId('');
    setExternalUrl('');
    setConfidence('');
    setNotes('');
    setPageNumber('');
    setSourceSection('');
    setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    // Validate per link kind.
    if (linkKind === 'document' && !docId) {
      setFormError('Pick a document.');
      return;
    }
    if (linkKind === 'external_url') {
      try {
        const url = new URL(externalUrl);
        if (!url.protocol.startsWith('http')) {
          setFormError('URL must start with http:// or https://');
          return;
        }
      } catch {
        setFormError('Enter a valid URL (e.g. https://bhoomi.karnataka.gov.in/...).');
        return;
      }
    }
    if (linkKind === 'manual_verification' && !notes.trim()) {
      setFormError('Add a short note describing what was verified.');
      return;
    }

    const conf = confidence === '' ? null : Number(confidence) / 100;
    if (conf != null && (Number.isNaN(conf) || conf < 0 || conf > 1)) {
      setFormError('Confidence must be between 0 and 100.');
      return;
    }
    const page = pageNumber === '' ? null : Number(pageNumber);
    if (page != null && (!Number.isInteger(page) || page < 1)) {
      setFormError('Page number must be a positive whole number.');
      return;
    }

    const body = {
      linkKind,
      documentId: linkKind === 'document' ? docId : null,
      externalUrl: linkKind === 'external_url' ? externalUrl.trim()
                 : linkKind === 'manual_verification' ? null
                 : null,
      confidenceScore: conf,
      notes: notes.trim() || null,
      pageNumber: page,
      sourceSection: sourceSection.trim() || null,
    };

    try {
      setSubmitting(true);
      await attach.mutateAsync(body);
      resetForm();
    } catch {
      // Toast handled by the hook; modal stays open with the inputs.
    } finally {
      setSubmitting(false);
    }
  };

  const handleDetach = (linkId) => {
    if (!window.confirm('Remove this evidence link? This cannot be undone.')) return;
    detach.mutate(linkId);
  };

  const links = data?.links || [];
  const noDocs = !docs || docs.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ownerLabel ? `Manage evidence — ${ownerLabel}` : 'Manage evidence'}
      description="Link the documents, registry entries, or manual checks that back this item."
      size="lg"
    >
      <div className="space-y-5">
        {/* Currently-linked list */}
        <div>
          <h3 className="text-xs font-semibold text-content-secondary uppercase tracking-wider mb-2">
            Currently linked
          </h3>
          {isLoading ? (
            <div className="text-xs text-content-tertiary flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          ) : links.length === 0 ? (
            <p className="text-xs text-content-tertiary italic">
              No evidence linked yet. Add the first piece below.
            </p>
          ) : (
            <ul className="divide-y divide-hairline-soft border border-hairline-soft rounded-md">
              {links.map((link) => (
                <li key={link.id} className="flex items-start gap-3 px-3 py-2">
                  <LinkIcon size={11} className="text-accent shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-content-primary truncate">
                      {LINK_TITLE(link)}
                    </div>
                    <div className="text-[10px] text-content-tertiary truncate">
                      {[
                        link.link_kind?.replace(/_/g, ' '),
                        link.page_number != null ? `p. ${link.page_number}` : null,
                        link.source_section,
                        formatConfidence(link.confidence_score) && `${formatConfidence(link.confidence_score)} confidence`,
                        link.created_by_name && `by ${link.created_by_name}`,
                        link.created_at && formatRelativeTime(link.created_at),
                      ].filter(Boolean).join(' · ')}
                    </div>
                    {link.notes && (
                      <p className="text-[11px] text-content-secondary mt-0.5 line-clamp-2">{link.notes}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDetach(link.id)}
                    disabled={detach.isPending}
                    className="p-1 text-content-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    aria-label="Remove this link"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Attach form */}
        <form onSubmit={handleSubmit} className="space-y-3 border-t border-hairline pt-4">
          <h3 className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
            Add evidence
          </h3>

          {/* Kind selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {LINK_KIND_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const disabled = opt.value === 'document' && (!dealId || noDocs);
              return (
                <label
                  key={opt.value}
                  className={clsx(
                    'flex items-start gap-2 p-2.5 rounded-md border cursor-pointer transition-colors',
                    linkKind === opt.value
                      ? 'border-accent bg-accent-soft'
                      : 'border-hairline bg-bg-elevated hover:bg-bg-secondary',
                    disabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <input
                    type="radio"
                    name="linkKind"
                    value={opt.value}
                    disabled={disabled}
                    checked={linkKind === opt.value}
                    onChange={() => { setLinkKind(opt.value); setFormError(''); }}
                    className="sr-only"
                  />
                  <Icon size={14} className="mt-0.5 text-accent shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-content-primary">{opt.label}</div>
                    <div className="text-[10px] text-content-tertiary leading-snug">
                      {disabled && opt.value === 'document'
                        ? 'Upload a document on the Documents tab first.'
                        : opt.desc}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Per-kind fields */}
          {linkKind === 'document' && (
            <div>
              <label className={FIELD_LABEL} htmlFor="ev-doc">Document</label>
              <select
                id="ev-doc"
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                disabled={noDocs}
                className={INPUT_CLS}
              >
                <option value="">{noDocs ? 'No documents on this deal yet' : 'Pick a document…'}</option>
                {(docs || []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name || d.original_filename || d.file_name || 'Document'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {linkKind === 'external_url' && (
            <div>
              <label className={FIELD_LABEL} htmlFor="ev-url">URL</label>
              <input
                id="ev-url"
                type="text"
                placeholder="https://bhoomi.karnataka.gov.in/..."
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          )}

          {/* Shared fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {linkKind === 'document' && (
              <div>
                <label className={FIELD_LABEL} htmlFor="ev-page">Page number</label>
                <input
                  id="ev-page"
                  type="number"
                  min="1"
                  placeholder="e.g. 3"
                  value={pageNumber}
                  onChange={(e) => setPageNumber(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            )}
            {linkKind === 'document' && (
              <div>
                <label className={FIELD_LABEL} htmlFor="ev-section">Source section</label>
                <input
                  id="ev-section"
                  type="text"
                  placeholder="e.g. Schedule A"
                  value={sourceSection}
                  onChange={(e) => setSourceSection(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            )}
            <div className={linkKind !== 'document' ? 'sm:col-span-1' : ''}>
              <label className={FIELD_LABEL} htmlFor="ev-conf">Confidence (%)</label>
              <input
                id="ev-conf"
                type="number"
                min="0"
                max="100"
                placeholder="0–100"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div>
            <label className={FIELD_LABEL} htmlFor="ev-notes">
              Notes {linkKind === 'manual_verification' && <span className="text-red-600">*</span>}
            </label>
            <textarea
              id="ev-notes"
              rows={2}
              placeholder={
                linkKind === 'manual_verification'
                  ? 'What did you check? e.g. "Visited the Sub-Registrar office on 14 May 2026 — title chain verified for 30 years."'
                  : 'Optional context for this link.'
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={INPUT_CLS}
            />
          </div>

          {formError && (
            <p className="text-[12px] text-red-600">{formError}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md text-content-secondary hover:bg-bg-secondary transition-colors"
            >
              Done
            </button>
            <button
              type="submit"
              disabled={submitting || (linkKind === 'document' && (noDocs || !docId))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Add evidence
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
