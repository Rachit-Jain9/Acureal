import { FileScan, UserCheck2 } from 'lucide-react';
import { clsx } from 'clsx';

// Tiny inline "from document" badge shown next to parcel/buildability inputs
// when the value (or a compatible value) was extracted from an uploaded deal
// document. Confidence drives colour so analysts can spot low-confidence
// reads at a glance.
export default function ExtractionBadge({ source, align = 'start', compact = false }) {
  if (!source) return null;
  const { confidence = 0, document_name, doc_type, from_corrections } = source;
  const tier = tierFor(confidence);

  const tone = tier === 'high'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : tier === 'mid'
    ? 'bg-amber-50 text-amber-800 border-amber-100'
    : 'bg-bg-secondary text-content-secondary border-hairline';

  const Icon = from_corrections ? UserCheck2 : FileScan;
  const label = from_corrections
    ? 'Human-verified'
    : `Extracted · ${(confidence * 100).toFixed(0)}%`;

  const tooltip = [
    document_name ? `From: ${document_name}` : null,
    doc_type ? `Type: ${doc_type.replace(/_/g, ' ')}` : null,
    from_corrections ? 'Reviewed by analyst' : `Model confidence ${(confidence * 100).toFixed(0)}%`,
  ].filter(Boolean).join('\n');

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium',
        compact ? 'text-[9px]' : 'text-[10px]',
        tone,
        align === 'end' ? 'ml-auto' : '',
      )}
      title={tooltip}
    >
      <Icon size={compact ? 9 : 10} />
      {label}
    </span>
  );
}

function tierFor(c) {
  if (c >= 0.85) return 'high';
  if (c >= 0.6) return 'mid';
  return 'low';
}
