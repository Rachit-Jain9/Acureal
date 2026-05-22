// ExportMenu — the deal workspace's single export control.
//
// Collapses what used to be three separate header buttons (tear-sheet PDF,
// PPTX deck, DOCX underwriting report) into one "Export" button with a
// dropdown. Self-contained: it owns the export calls, the per-format busy
// state, and the success/error toasts, so DealDetailPage no longer carries
// any export plumbing.

import { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, FileDown, Presentation, BookText, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../../design-system';
import { exportsAPI } from '../../services/api';
import { downloadAxiosResponse } from '../../utils/download';
import { toast } from '../common/Toast';

const FORMATS = [
  { key: 'pdf',  label: 'Investor tear-sheet', hint: '2-page landscape PDF',         icon: FileDown },
  { key: 'pptx', label: 'Investor deck',       hint: 'Full PPTX presentation',        icon: Presentation },
  { key: 'docx', label: 'Underwriting report', hint: '22-section institutional DOCX', icon: BookText },
];

export default function ExportMenu({ dealId, dealName }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const runExport = async (key) => {
    const safeName = (dealName || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
    const today = new Date().toISOString().slice(0, 10);
    const config = {
      pdf: {
        call: () => exportsAPI.dealPdf(dealId),
        filename: `redip-${safeName}-tear-sheet-${today}.pdf`,
        ok: 'Tear-sheet PDF downloaded',
        err: 'Tear-sheet export failed',
      },
      pptx: {
        call: () => exportsAPI.dealPptx(dealId),
        filename: `redip-${safeName}.pptx`,
        ok: 'PPTX deck downloaded',
        err: 'PPTX export failed',
      },
      docx: {
        call: () => exportsAPI.dealDocx(dealId),
        filename: `redip-${safeName}-underwriting-${today}.docx`,
        ok: 'Underwriting report downloaded',
        err: 'Underwriting report download failed',
      },
    }[key];

    setBusy(key);
    try {
      const response = await config.call();
      downloadAxiosResponse(response, config.filename);
      toast.success(config.ok);
      setOpen(false);
    } catch (error) {
      // The server message is kept verbatim where present — e.g. the DOCX
      // route returns an operator-actionable message when the feature flag
      // is off for non-admins.
      toast.error(error?.response?.data?.message || config.err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <Button
        ref={triggerRef}
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        leftIcon={<Download size={14} />}
        rightIcon={
          <ChevronDown
            size={14}
            className={clsx('transition-transform duration-150', open && 'rotate-180')}
          />
        }
        aria-haspopup="true"
        aria-expanded={open}
      >
        Export
      </Button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-72 z-20 rounded-editorial border border-hairline bg-bg-elevated shadow-editorial-lg overflow-hidden py-1">
          {FORMATS.map((format) => {
            const Icon = format.icon;
            const isBusy = busy === format.key;
            return (
              <button
                key={format.key}
                type="button"
                disabled={busy != null}
                onClick={() => runExport(format.key)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors duration-150 ease-out
                  hover:bg-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed
                  focus-visible:outline-none focus-visible:bg-bg-secondary"
              >
                <span className="shrink-0 text-content-muted" aria-hidden="true">
                  {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-content-primary">{format.label}</span>
                  <span className="block text-xs text-content-muted">{format.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
