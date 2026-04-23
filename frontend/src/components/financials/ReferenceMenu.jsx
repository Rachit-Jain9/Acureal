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
        className="inline-flex items-center gap-2 rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:border-stone-900 hover:text-stone-900"
      >
        <BookOpen size={13} className="text-[#c2410c]" />
        <span className="uppercase tracking-[0.12em]">Reference</span>
        <ChevronDown size={12} className="text-stone-500" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-sm border border-stone-300 bg-white shadow-editorial-lg z-50">
          <div className="px-3 py-2 border-b border-stone-200 text-[10px] uppercase tracking-[0.18em] text-stone-500">
            Deal reference · {assetClass.replace(/_/g, ' ')}
          </div>
          <ul className="py-1">
            <li>
              <button
                type="button"
                onClick={() => pick('methodology')}
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
                onClick={() => pick('defaults')}
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
