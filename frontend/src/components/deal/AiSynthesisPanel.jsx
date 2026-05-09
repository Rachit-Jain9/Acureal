import { useState } from 'react';
import { clsx } from 'clsx';
import { Sparkles } from 'lucide-react';
import DealAnalysisPanel from './DealAnalysisPanel';
import IcMemoPanel from './IcMemoPanel';

/**
 * Combined AI synthesis surface — wraps the streamed Quick Analysis and
 * the long-form IC Memo in one bordered card with a tab strip on top.
 *
 * Why combine them: pre-merge they read as two independent AI sections
 * stacked vertically, which (a) doubled the visual chrome and (b) made
 * the page longer than it needed to be. They're conceptually the same
 * artifact at different lengths — a Quick Analysis is a 3-paragraph
 * "should we look at this?" pass; the IC Memo is the 8-section signoff
 * version. Tabs let an analyst switch between depths without leaving
 * the deal Overview.
 *
 * Both child panels keep their own state — switching tabs preserves
 * per-tab cache + streaming state because they remain mounted (the
 * inactive tab is just hidden, not unmounted). That means no
 * re-fetching when the user toggles back.
 */
export default function AiSynthesisPanel({ dealId, dealName }) {
  const [tab, setTab] = useState('analysis'); // 'analysis' | 'memo'

  return (
    <div className="card-editorial">
      {/* Tab strip — semantic ARIA tablist so screen readers announce
          properly. The tabs sit above each panel's own SectionHeader; we
          deliberately don't repeat a wrapping title here so the page
          density stays tight. */}
      <div role="tablist" aria-label="AI synthesis depth" className="flex items-center gap-1 mb-4 -mt-1 -ml-1">
        <Tab
          id="tab-analysis"
          active={tab === 'analysis'}
          onClick={() => setTab('analysis')}
          panelId="panel-analysis"
        >
          <Sparkles size={12} className="mr-1.5" />
          Quick Analysis
        </Tab>
        <Tab
          id="tab-memo"
          active={tab === 'memo'}
          onClick={() => setTab('memo')}
          panelId="panel-memo"
        >
          <Sparkles size={12} className="mr-1.5" />
          Full IC Memo
        </Tab>
      </div>

      {/* Both panels remain mounted; we just toggle visibility. Keeps
          streaming state + cached content in memory across tab switches. */}
      <div role="tabpanel" id="panel-analysis" aria-labelledby="tab-analysis" hidden={tab !== 'analysis'}>
        <DealAnalysisPanel dealId={dealId} />
      </div>
      <div role="tabpanel" id="panel-memo" aria-labelledby="tab-memo" hidden={tab !== 'memo'}>
        <IcMemoPanel dealId={dealId} dealName={dealName} />
      </div>
    </div>
  );
}

function Tab({ id, active, onClick, panelId, children }) {
  return (
    <button
      id={id}
      role="tab"
      type="button"
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'bg-accent/10 text-accent'
          : 'text-content-secondary hover:text-content-primary hover:bg-bg-secondary',
      )}
    >
      {children}
    </button>
  );
}
