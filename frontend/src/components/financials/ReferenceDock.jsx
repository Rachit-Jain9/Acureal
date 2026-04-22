import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Database, Sparkles } from 'lucide-react';
import DefaultsInspector from './DefaultsInspector';
import MethodologyExplorer from './MethodologyExplorer';

// Single editorial entry point for the three reference surfaces: kernel
// defaults (sources live inside each default row), methodology, and the
// asset-class playbook. Replaces the two loud gradient pills that used to
// sit in the Financials page header.
export default function ReferenceDock({ assetClass }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:border-stone-900 hover:text-stone-900"
      >
        <BookOpen size={13} className="text-[#c2410c]" />
        <span className="uppercase tracking-[0.12em]">Reference</span>
        <ChevronDown size={12} className="text-stone-500" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-sm border border-stone-300 bg-white shadow-editorial-lg z-50">
          <div className="px-3 py-2 border-b border-stone-200 text-[10px] uppercase tracking-[0.18em] text-stone-500">
            Deal reference · {assetClass.replace(/_/g, ' ')}
          </div>
          <ul className="py-1">
            <li>
              <button
                type="button"
                onClick={() => { setActive('methodology'); setOpen(false); }}
                className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-stone-50"
              >
                <Sparkles size={14} className="mt-0.5 text-[#c2410c]" />
                <div>
                  <div className="text-sm font-medium text-stone-900">Methodology</div>
                  <div className="text-[11px] text-stone-500 leading-snug">
                    Formulas, KPI definitions, asset-class playbook
                  </div>
                </div>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => { setActive('defaults'); setOpen(false); }}
                className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-stone-50"
              >
                <Database size={14} className="mt-0.5 text-stone-700" />
                <div>
                  <div className="text-sm font-medium text-stone-900">Defaults &amp; sources</div>
                  <div className="text-[11px] text-stone-500 leading-snug">
                    Every kernel default with its source and unit
                  </div>
                </div>
              </button>
            </li>
          </ul>
        </div>
      )}

      {/* Hidden triggers — programmatically opened via mounted-with-auto-open wrappers */}
      {active === 'methodology' && (
        <AutoOpen onClose={() => setActive(null)}>
          <MethodologyExplorer assetClass={assetClass} />
        </AutoOpen>
      )}
      {active === 'defaults' && (
        <AutoOpen onClose={() => setActive(null)}>
          <DefaultsInspector assetClass={assetClass} />
        </AutoOpen>
      )}
    </div>
  );
}

// Wrapper that clicks the child's internal trigger button on mount so the
// existing modal-based components open without a refactor. When the modal is
// closed (trigger button re-appears in DOM), the wrapper unmounts.
function AutoOpen({ children, onClose }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const btn = host.querySelector('button');
    if (btn) btn.click();
    const io = new MutationObserver(() => {
      const stillHasModalOpenFlag = document.body.style.overflow === 'hidden';
      if (!stillHasModalOpenFlag) onClose();
    });
    io.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    return () => io.disconnect();
  }, [onClose]);
  return (
    <div ref={hostRef} className="sr-only">
      {children}
    </div>
  );
}
