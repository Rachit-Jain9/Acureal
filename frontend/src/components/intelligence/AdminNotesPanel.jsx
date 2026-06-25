import { useState } from 'react';
import {
  ChevronDown,
  Lock,
  PlusCircle,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useMarketNotes, useSaveMarketNotes } from '../../hooks/useIntelligence';

/**
 * Admin Market Notes editor — admin/operator-only surface that feeds the
 * "Micro-Market Intelligence" bullets of the daily AI brief. Extracted from
 * IntelligencePage.jsx in the 2026-05-25 god-file decomposition (Task #6)
 * with no behaviour change.
 *
 * Section types in this editor were retired in PR #530 — `slowdown` and
 * `strategic` produced generic copy that didn't earn their place. Only
 * `micro_market` remains; SECTION_META is a one-key map kept open as a
 * pattern so future note types can plug in without a structural rewrite.
 */

const SECTION_META = {
  micro_market: {
    label: 'Micro-Market Intelligence',
    placeholder:
      'e.g. Whitefield absorption strong; 15,000–16,000/sqft bracket holding up.',
  },
};

function NotesEditor({ section, initialItems, onSave, saving }) {
  const [items, setItems] = useState(initialItems || []);
  const [newItem, setNewItem] = useState('');

  const add = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    setItems((prev) => [...prev, trimmed]);
    setNewItem('');
  };

  const remove = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 rounded-lg bg-bg-secondary px-3 py-2 text-sm text-content-primary"
          >
            <span className="flex-1">{item}</span>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="text-content-muted hover:text-data-negative flex-shrink-0 mt-0.5"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-xs text-content-muted italic">
            No items yet. Add your first observation below.
          </li>
        )}
      </ul>
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={SECTION_META[section]?.placeholder}
          className="flex-1 rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-accent outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!newItem.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-bg-secondary px-3 py-2 text-sm font-medium text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
        >
          <PlusCircle size={14} />
          Add
        </button>
      </div>
      <button
        type="button"
        onClick={() => onSave(items)}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-bg-primary disabled:opacity-50"
      >
        {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
        Save section
      </button>
    </div>
  );
}

export default function AdminNotesPanel() {
  const { data: marketNotes, isLoading } = useMarketNotes();
  const saveNotes = useSaveMarketNotes();
  const [openSection, setOpenSection] = useState(null);
  const [savingSection, setSavingSection] = useState(null);

  const handleSave = async (section, items) => {
    setSavingSection(section);
    try {
      await saveNotes.mutateAsync({ section, items });
    } finally {
      setSavingSection(null);
    }
  };

  if (isLoading) return <p className="text-sm text-content-secondary">Loading notes...</p>;

  return (
    <div className="rounded-xl border border-hairline bg-accent-soft p-5">
      <div className="flex items-center gap-2 mb-4">
        <Lock size={15} className="text-accent" />
        <p className="text-sm font-semibold text-accent">Admin — Market Notes Editor</p>
        <span className="ml-auto text-xs text-accent">Only admins can edit</span>
      </div>
      <p className="text-xs text-accent mb-4">
        Notes entered here appear in the intelligence brief and are stored in the database.
        No external data is fabricated — only what you enter here is surfaced.
      </p>
      <div className="space-y-3">
        {Object.entries(SECTION_META).map(([sectionKey, meta]) => (
          <div key={sectionKey} className="rounded-lg bg-bg-elevated border border-hairline">
            <button
              type="button"
              onClick={() =>
                setOpenSection(openSection === sectionKey ? null : sectionKey)
              }
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-content-primary hover:bg-bg-secondary rounded-lg"
            >
              {meta.label}
              <ChevronDown
                size={14}
                className={`text-content-muted transition-transform ${
                  openSection === sectionKey ? 'rotate-180' : ''
                }`}
              />
            </button>
            {openSection === sectionKey && (
              <div className="px-4 pb-4">
                <NotesEditor
                  section={sectionKey}
                  initialItems={marketNotes?.[sectionKey] || []}
                  onSave={(items) => handleSave(sectionKey, items)}
                  saving={savingSection === sectionKey}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
