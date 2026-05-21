import { useState, useEffect, useCallback } from 'react';
import { Card, SectionHeader, ErrorState, SkeletonList } from '../../design-system';
import { adminAPI } from '../../services/api';

/**
 * Extraction-accuracy widget — the standing extraction-quality system
 * (Workstream C).
 *
 * Reads /api/admin/extraction-quality, which aggregates the
 * `extraction_field_verdicts` ledger into a per-(doc_type, canonical field)
 * acceptance rate. It answers "which document fields does the AI get wrong",
 * measured from the real accept/override verdicts operators make when they
 * apply AI-extracted fields to a deal — the prompt-tuning shortlist.
 *
 * Operator-only (rendered on the admin AI-usage page). Own fetch, so it
 * renders independently of the cost dashboard it sits beneath.
 */

const fmtPct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
const fmtNum = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

// Accuracy → tone. High = trustworthy; low = a prompt-tuning target.
const accuracyTone = (pct) => {
  if (pct == null) return 'text-content-muted';
  if (pct >= 90) return 'text-data-positive';
  if (pct < 70) return 'text-data-negative';
  return 'text-content-primary';
};

export default function ExtractionQualityWidget({ days = 90 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await adminAPI.getExtractionQuality(days);
      setData(res.data?.data || null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const overall = data?.overall;
  const byField = data?.by_field || [];
  const hasData = Boolean(data?.available && overall && overall.reviewed > 0);

  return (
    <div>
      <SectionHeader
        size="sm"
        eyebrow="Learning loop"
        title="Extraction accuracy"
        sub="How often operators keep the AI's extracted value unchanged when they apply it, by document field — measured from real accept/override decisions. The lowest-accuracy fields are the prompt-tuning targets."
      />
      <Card className="p-0 mt-3 overflow-hidden">
        {loading && (
          <div className="p-4">
            <SkeletonList rows={4} columns={4} />
          </div>
        )}

        {!loading && error && (
          <div className="p-4">
            <ErrorState
              tone="warn"
              title="Couldn't load extraction accuracy"
              action={
                <button
                  type="button"
                  onClick={load}
                  className="text-sm text-accent hover:underline focus-visible:outline-none focus-visible:underline"
                >
                  Try again
                </button>
              }
            >
              This is a display issue — the metric is non-critical.
            </ErrorState>
          </div>
        )}

        {!loading && !error && data && !data.available && (
          <p className="text-sm text-content-muted p-6 text-center">
            Extraction-accuracy tracking is being set up. As operators review and
            apply AI-extracted fields, accuracy will appear here.
          </p>
        )}

        {!loading && !error && data && data.available && !hasData && (
          <p className="text-sm text-content-muted p-6 text-center">
            No AI-extracted fields applied in the last {data.window_days} days yet.
            Accuracy is measured each time an operator applies a field — recording
            whether the AI's value was kept or corrected.
          </p>
        )}

        {!loading && !error && hasData && (
          <div>
            <div className="px-4 py-3 border-b border-hairline flex items-baseline justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-bold tabular-nums ${accuracyTone(overall.accuracy_pct)}`}
                >
                  {fmtPct(overall.accuracy_pct)}
                </span>
                <span className="text-xs text-content-muted">overall accuracy</span>
              </div>
              <span className="text-xs text-content-muted tabular-nums">
                {fmtNum(overall.reviewed - overall.corrected)} of {fmtNum(overall.reviewed)} fields
                accepted unchanged · last {data.window_days} days
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-hairline text-content-muted uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium">Document type</th>
                    <th className="text-left py-2 px-3 font-medium">Field</th>
                    <th className="text-right py-2 px-3 font-medium">Applied</th>
                    <th className="text-right py-2 px-3 font-medium">Overridden</th>
                    <th className="text-right py-2 px-3 font-medium">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {byField.map((f, i) => (
                    <tr
                      key={`${f.doc_type}-${f.field_key}-${i}`}
                      className="border-b border-hairline last:border-b-0 hover:bg-bg-secondary/40"
                    >
                      <td className="py-2 px-3 text-content-secondary font-mono text-[10px]">
                        {f.doc_type}
                      </td>
                      <td className="py-2 px-3 text-content-primary font-mono text-[10px]">
                        {f.field_key}
                      </td>
                      <td className="py-2 px-3 text-right text-content-muted tabular-nums">
                        {fmtNum(f.reviewed)}
                      </td>
                      <td className="py-2 px-3 text-right text-content-muted tabular-nums">
                        {fmtNum(f.corrected)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right tabular-nums font-medium ${accuracyTone(f.accuracy_pct)}`}
                      >
                        {fmtPct(f.accuracy_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
