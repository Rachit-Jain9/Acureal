import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Database, Sparkles } from 'lucide-react';
import DefaultsInspector from './DefaultsInspector';
import MethodologyExplorer from './MethodologyExplorer';

export default function ReferenceMenu({ assetClass }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const pick = (id) => {
    setMenuOpen(false);
    setActive(id);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-sm border border-hairline-strong bg-bg-elevated px-3 py-1.5 text-xs font-medium text-content-secondary hover:border-content-primary hover:text-content-primary"
      >
        <BookOpen size={13} className="text-orange-700" />
        <span className="uppercase tracking-[0.12em]">Reference</span>
        <ChevronDown size={12} className="text-content-secondary" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-sm border border-hairline-strong bg-bg-elevated shadow-editorial-lg z-50">
          <div className="px-3 py-2 border-b border-hairline text-[10px] uppercase tracking-[0.18em] text-content-secondary">
            Deal reference · {assetClass.replace(/_/g, ' ')}
          </div>
          <ul className="py-1">
            <li>
              <button
                type="button"
                onClick={() => pick('methodology')}
                className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-bg-secondary"
              >
                <Sparkles size={14} className="mt-0.5 text-orange-700" />
                <div>
                  <div className="text-sm font-medium text-content-primary">Methodology</div>
                  <div className="text-[11px] text-content-secondary leading-snug">
                    Formulas, KPI definitions, asset-class playbook
                  </div>
                </div>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => pick('defaults')}
                className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-bg-secondary"
              >
                <Database size={14} className="mt-0.5 text-content-secondary" />
                <div>
                  <div className="text-sm font-medium text-content-primary">Defaults &amp; sources</div>
                  <div className="text-[11px] text-content-secondary leading-snug">
                    Every kernel default with its source and unit
                  </div>
                </div>
              </button>
            </li>
          </ul>
        </div>
      )}

      <MethodologyExplorer
        assetClass={assetClass}
        hideTrigger
        open={active === 'methodology'}
        onClose={() => setActive(null)}
      />
      <DefaultsInspector
        assetClass={assetClass}
        hideTrigger
        open={active === 'defaults'}
        onClose={() => setActive(null)}
      />
    </div>
  );
}
