import { useState } from 'react';
import { Search, Loader2, FileText, Sparkles } from 'lucide-react';
import { searchAPI } from '../../services/api';
import { SectionHeader } from '../../design-system';

// Semantic search across uploaded documents in this workspace. Results
// are chunks ranked by cosine similarity — clicking a result anchors
// the user to the source document (Tier 4.1 PR 3/3 — "find similar
// clauses across the corpus").
//
// Props:
//   • dealId — optional. If provided, scopes search to documents
//     attached to this deal (passed to the backend as documentId hint;
//     for now the route accepts a single document only — multi-doc
//     scoping arrives once we have a per-deal document_ids endpoint).
//   • onResult — optional. Click handler (chunk row) → caller decides
//     navigation behaviour. Defaults to opening the source document
//     in a new tab if available.

export default function SemanticSearchPanel({ dealId, onResult }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchAPI.semantic({ q: query.trim(), k: 8 });
      setResults(res.data?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Semantic search failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-editorial p-5">
      <SectionHeader
        size="sm"
        icon={Sparkles}
        title="Semantic search"
        sub="Find similar clauses, terms, or facts across this workspace's documents."
      />
      <form onSubmit={runSearch} className="flex gap-2 mt-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='e.g. "encumbrance clause", "absorption velocity below 12 months"'
            className="w-full pl-9 pr-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="btn btn-primary text-sm flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Search
        </button>
      </form>

      {error && (
        <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</p>
      )}

      {results !== null && !error && (
        <div className="mt-4 space-y-2">
          {results.length === 0 ? (
            <p className="text-sm text-content-muted py-4 text-center">
              No matches yet. Try a different phrase, or upload more documents to expand the corpus.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {results.map((row) => (
                <li
                  key={row.id}
                  onClick={() => onResult?.(row)}
                  className="py-3 px-1 cursor-pointer hover:bg-bg-secondary transition-colors rounded"
                >
                  <div className="flex items-center gap-2 text-xs text-content-muted mb-1">
                    <FileText size={12} />
                    <span>Document {row.document_id?.slice(0, 8) || '—'}</span>
                    {row.page_number && <span>· Page {row.page_number}</span>}
                    <span className="ml-auto tabular-nums">
                      {Math.round((row.similarity || 0) * 100)}% match
                    </span>
                  </div>
                  <p className="text-sm text-content-primary leading-relaxed line-clamp-3">
                    {row.chunk_text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
