import { useMemo } from 'react';

export const deriveParcelVerdict = (intelligence) => {
  if (!intelligence) {
    return null;
  }

  if (intelligence.verdict) {
    return intelligence.verdict;
  }

  const flags = intelligence.red_flags || [];
  const high = flags.filter((flag) => flag.severity === 'high').length;
  const medium = flags.filter((flag) => flag.severity === 'medium').length;
  const low = flags.filter((flag) => flag.severity === 'low').length;
  const confidencePct = Math.round(Number(intelligence.confidence?.overall || 0) * 100);

  return {
    label: high ? 'Do Not Rely Yet' : medium || confidencePct < 70 ? 'Proceed With Caution' : 'Screening Ready',
    tone: high ? 'danger' : medium || confidencePct < 70 ? 'warning' : 'success',
    confidence_pct: confidencePct,
    summary: `${high} high, ${medium} medium, ${low} low flags.`,
    counts: { high, medium, low, needs_verification: intelligence.buckets?.needs_verification?.length || 0 },
    next_actions: intelligence.buckets?.needs_verification || [],
  };
};

export const useParcelVerdict = (intelligence) =>
  useMemo(() => deriveParcelVerdict(intelligence), [intelligence]);
