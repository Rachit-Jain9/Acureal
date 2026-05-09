import { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  Send,
  Loader2,
  AlertTriangle,
  Trash2,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  Database,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, SectionHeader } from '../../design-system';
import {
  useDealQaHistory,
  useStreamDealQa,
  useDeleteDealQaRow,
} from '../../hooks/useDealQa';

/**
 * Tier-2 #11 — Deal Q&A box.
 *
 * Single-shot synchronous Q&A: type a question → Claude reads relevant
 * deal context (financials, risk flags, top comps) + the top-K
 * pgvector-retrieved document chunks → returns a 3-6 sentence answer
 * with mandatory inline citations. Every citation links to the
 * specific document/chunk that grounded the claim.
 *
 * Per CLAUDE.md hard rule: every AI-synthesized narrative carries the
 * "AI-assisted — requires human review" disclaimer.
 *
 * UI principles (per FRONTEND_GUIDELINES.md):
 *   • Skeletons not spinners for the in-flight state
 *   • Tabular numerals on similarity / page numbers
 *   • Semantic tokens only — no raw colors
 *   • Focus-visible rings on every interactive element
 *   • Collapsible history so the deal page doesn't get unwieldy
 */

const SUGGESTED_QUESTIONS = [
  'What are the open title risks?',
  'Is this deal IC-ready? What\'s missing?',
  'How does the asking price compare to comps?',
  'Summarize the regulatory / RERA status.',
];

function CitationChip({ citation }) {
  const [open, setOpen] = useState(false);
  // Synthetic citations are non-document — they reference deal_snapshot,
  // risk_flags, comps, or financials (the structured fields the prompt
  // already supplies as context). We swap the icon and tone so the
  // analyst can tell at a glance "this came from a doc" vs "this came
  // from the deal model".
  const isSynthetic = citation.kind === 'synthetic';
  const label = citation.document_name || citation.embedding_id?.slice(0, 8) || 'source';
  const pageBit = citation.page_number != null ? ` · p.${citation.page_number}` : '';
  const Icon = isSynthetic ? Database : FileText;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums',
          'border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          isSynthetic
            ? 'bg-accent-soft/40 border-accent/30 text-accent hover:border-accent/50'
            : 'bg-bg-secondary border-hairline text-content-secondary hover:border-accent/50 hover:text-content-primary',
        )}
        title={isSynthetic ? 'Source: structured deal data (not a document)' : 'Click to see the cited excerpt'}
        aria-expanded={open}
      >
        <Icon size={9} />
        <span className="truncate max-w-[160px]">{label}</span>
        <span className="text-content-muted">{pageBit}</span>
      </button>
      {open && citation.excerpt && (
        <div className="absolute z-20 left-0 mt-1 w-80 max-w-[80vw] p-3 rounded-md border border-hairline bg-bg-elevated shadow-editorial text-xs text-content-secondary">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="font-medium text-content-primary">{label}</span>
            {isSynthetic ? (
              <span className="text-content-muted text-[10px] uppercase tracking-wider">
                Deal data
              </span>
            ) : typeof citation.similarity === 'number' ? (
              <span className="text-content-muted tabular-nums">
                {Math.round(citation.similarity * 100)}% match
              </span>
            ) : null}
          </div>
          <p className="italic leading-relaxed">"{citation.excerpt}"</p>
          {citation.why_relevant && (
            <p className="mt-2 text-[11px] text-content-muted">
              Why relevant: {citation.why_relevant}
            </p>
          )}
          {isSynthetic && (
            <p className="mt-2 text-[10px] text-content-muted">
              This claim comes from the deal's structured fields, not an uploaded document. Upload source documents (sale deed, EC, sanctioned plan) to ground future answers in primary evidence.
            </p>
          )}
        </div>
      )}
    </span>
  );
}

function HistoryRow({ row, dealId, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const isFailed = row.status === 'failed';
  const citations = Array.isArray(row.citations) ? row.citations : [];
  const drifts = Array.isArray(row.numerical_drifts) ? row.numerical_drifts : [];
  const askedAt = row.created_at ? new Date(row.created_at) : null;

  return (
    <div className="border-t border-hairline pt-3 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
        aria-expanded={expanded}
      >
        <MessageSquare size={13} className="shrink-0 mt-0.5 text-content-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-content-primary font-medium">
            {row.question}
          </div>
          {!expanded && row.answer && (
            <p className="mt-1 text-xs text-content-secondary line-clamp-2">
              {row.answer}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-content-muted tabular-nums">
          {askedAt ? askedAt.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
        {expanded ? (
          <ChevronUp size={13} className="shrink-0 text-content-muted" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-content-muted" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 ml-5 space-y-2">
          {isFailed ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <div>
                {row.failure_reason || 'Q&A failed.'} Try rephrasing.
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-content-primary leading-relaxed whitespace-pre-line">
                {row.answer}
              </p>
              {citations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-content-muted">
                    Sources:
                  </span>
                  {citations.map((c, i) => (
                    <CitationChip key={c.embedding_id || i} citation={c} />
                  ))}
                </div>
              )}
              {drifts.length > 0 && (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <AlertTriangle size={10} className="inline -mt-0.5 mr-1" />
                  {drifts.length} numerical claim{drifts.length === 1 ? '' : 's'} flagged for review.
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[10px] text-content-muted">
              AI-assisted — requires human review
            </span>
            <button
              type="button"
              onClick={() => onDelete({ dealId, rowId: row.id })}
              className="inline-flex items-center gap-1 text-[10px] text-content-muted hover:text-data-negative transition-colors focus-visible:outline-none focus-visible:underline"
              title="Delete this Q&A entry"
            >
              <Trash2 size={10} />
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DealQaBox({ dealId }) {
  const [question, setQuestion] = useState('');
  const [showHistory, setShowHistory] = useState(true);
  const [activeQuestion, setActiveQuestion] = useState('');
  const inputRef = useRef(null);

  // Streaming Q&A — token-by-token answer rendering. Falls back to the
  // persisted history row once the stream completes.
  const { ask, streamingText, isStreaming, abort } = useStreamDealQa();
  const deleteRow = useDeleteDealQaRow();
  const { data: history = [], isLoading: historyLoading } = useDealQaHistory(dealId);

  const submit = (e) => {
    e?.preventDefault?.();
    const trimmed = question.trim();
    if (!trimmed || isStreaming) return;
    setActiveQuestion(trimmed);
    ask({ dealId, question: trimmed });
    setQuestion('');
  };

  const onKeyDown = (e) => {
    // Cmd/Ctrl-Enter to submit — power-user shortcut.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const onSuggested = (q) => {
    setQuestion(q);
    inputRef.current?.focus();
  };

  // Auto-focus the input on mount so analysts can type immediately.
  useEffect(() => {
    // Defer to next tick so this doesn't fight the page's initial scroll.
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // When a fresh history row lands matching the active question, clear
  // the in-flight panel — the persisted row takes over rendering.
  useEffect(() => {
    if (!activeQuestion) return;
    const fresh = history.find((r) => r.question === activeQuestion);
    if (fresh) setActiveQuestion('');
  }, [history, activeQuestion]);

  return (
    <Card className="p-5">
      <SectionHeader
        size="sm"
        icon={Sparkles}
        eyebrow="AI · Tier-2"
        title="Ask anything about this deal"
        sub="Type a question. The AI reads the deal's documents, financials, comps, and risks — and answers with citations to the source. Every claim links back to the document it came from."
      />

      <form onSubmit={submit} className="mt-3">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={2000}
            placeholder="e.g. What are the open title risks? Is the IRR above the bench?"
            disabled={isStreaming}
            className={clsx(
              'w-full px-3 py-2 pr-12 text-sm border border-hairline rounded-md',
              'bg-bg-elevated text-content-primary placeholder:text-content-muted',
              'focus-visible:outline-none focus-visible:border-accent',
              'disabled:opacity-50',
            )}
          />
          <button
            type="submit"
            disabled={isStreaming || !question.trim()}
            className={clsx(
              'absolute right-2 bottom-2 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded',
              'bg-accent text-white hover:bg-accent/90 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              'disabled:bg-bg-secondary disabled:text-content-muted disabled:cursor-not-allowed',
            )}
            title="Submit (⌘/Ctrl + Enter)"
          >
            {isStreaming ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Send size={11} />
            )}
            {isStreaming ? 'Streaming…' : 'Ask'}
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-content-muted flex items-center gap-2">
          <span>{question.length} / 2000</span>
          <span className="text-content-muted">·</span>
          <span>⌘/Ctrl + Enter to submit</span>
          {isStreaming && (
            <>
              <span className="text-content-muted">·</span>
              <button
                type="button"
                onClick={abort}
                className="inline-flex items-center gap-1 text-content-muted hover:text-data-negative transition-colors focus-visible:outline-none focus-visible:underline"
              >
                <X size={9} /> Cancel
              </button>
            </>
          )}
        </div>
      </form>

      {/* Suggested questions — only render when history is empty so the
          deal page doesn't get cluttered with prompts after first use. */}
      {history.length === 0 && !historyLoading && !isStreaming && !activeQuestion && (
        <div className="mt-4">
          <div className="text-eyebrow uppercase text-content-muted mb-2 font-medium">
            Try one of these
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSuggested(q)}
                className="px-2.5 py-1 text-xs rounded-full border border-hairline bg-bg-elevated text-content-secondary hover:border-accent/40 hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Streaming answer — paints token-by-token from the SSE stream.
          Renders the live question + the answer-field text as the
          model writes it. Disclaimer + citations only land when the
          stream finishes (citations require post-validation). */}
      {(isStreaming || (activeQuestion && streamingText)) && (
        <div className="mt-4 space-y-2 border-t border-hairline pt-4">
          <div className="flex items-start gap-2">
            <MessageSquare size={13} className="shrink-0 mt-0.5 text-content-muted" />
            <div className="text-sm font-medium text-content-primary">
              {activeQuestion}
            </div>
          </div>
          {streamingText ? (
            <p className="text-sm text-content-primary leading-relaxed whitespace-pre-line ml-5">
              {streamingText}
              {isStreaming && <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 animate-pulse align-baseline" aria-hidden />}
            </p>
          ) : (
            // Pre-first-token skeleton — model is thinking, no text yet.
            <div className="ml-5 space-y-2 animate-pulse" aria-busy="true">
              <div className="h-3 w-11/12 rounded bg-bg-secondary" />
              <div className="h-3 w-9/12 rounded bg-bg-secondary" />
              <div className="h-3 w-10/12 rounded bg-bg-secondary" />
            </div>
          )}
          <div className="ml-5 text-[10px] text-content-muted">
            AI-assisted — citations + drift checks land when the stream finishes.
          </div>
        </div>
      )}

      {/* History — collapsible. */}
      {history.length > 0 && (
        <div className="mt-5 border-t border-hairline pt-4">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-xs font-medium text-content-secondary hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:underline"
            aria-expanded={showHistory}
          >
            <span className="text-eyebrow uppercase tracking-wider">
              Recent questions ({history.length})
            </span>
            {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showHistory && (
            <div className="mt-3 space-y-3">
              {history.map((row) => (
                <HistoryRow
                  key={row.id}
                  row={row}
                  dealId={dealId}
                  onDelete={(args) => deleteRow.mutate(args)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
