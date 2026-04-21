import { BookOpen, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

// Inline provenance badge shown next to financial input fields whose default
// was sourced from the single-source-of-truth registry at
// packages/financial-kernel/src/config/defaults.ts. Hover to see source
// citation (HVS, JLL, CBRE, USALI 11e, etc.), declared range and last
// reviewed date. Red tone flags a user-entered value that is outside the
// declared safe range.
//
// Usage:
//   <DefaultFieldBadge meta={defaultsMeta?.[fieldName]} currentValue={inputs[fieldName]} />
//
// `meta` is the envelope shape from `getDefaultMeta(assetClass, key)`:
//   { value, unit, range?: [lo, hi], source, lastReviewed?, description? }
//
// All props are optional — a missing meta renders nothing so the badge is
// safe to drop beside every field without conditional noise.
export default function DefaultFieldBadge({
  meta,
  currentValue,
  size = 'sm',
  className = '',
}) {
  if (!meta || typeof meta !== 'object') return null;

  const numeric = typeof currentValue === 'number' && Number.isFinite(currentValue)
    ? currentValue
    : Number.isFinite(Number(currentValue)) ? Number(currentValue) : null;

  const range = Array.isArray(meta.range) && meta.range.length === 2 ? meta.range : null;
  const outOfRange = numeric != null && range != null
    && (numeric < range[0] || numeric > range[1]);

  const isDefault = numeric != null && Math.abs(numeric - Number(meta.value)) < 1e-6;

  const tone = outOfRange
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : isDefault
    ? 'bg-sky-50 text-sky-700 border-sky-200'
    : 'bg-gray-50 text-gray-600 border-gray-200';

  const Icon = outOfRange ? AlertTriangle : BookOpen;

  const pill = outOfRange
    ? 'Out of range'
    : isDefault
    ? 'Default'
    : 'Guideline';

  const fmtValue = (v) => {
    if (v == null) return '—';
    if (typeof v !== 'number') return String(v);
    if (Math.abs(v) >= 1000) return v.toLocaleString('en-IN');
    return v.toString();
  };

  const unit = meta.unit && meta.unit !== 'ratio' ? ` ${meta.unit}` : '';
  const rangeText = range ? `${fmtValue(range[0])}–${fmtValue(range[1])}${unit}` : null;

  const tooltip = [
    meta.description || null,
    `Default: ${fmtValue(meta.value)}${unit}`,
    rangeText ? `Range: ${rangeText}` : null,
    meta.source ? `Source: ${meta.source}` : null,
    meta.lastReviewed ? `Last reviewed: ${meta.lastReviewed}` : null,
    outOfRange ? `Your value ${fmtValue(numeric)}${unit} is outside the typical range.` : null,
  ].filter(Boolean).join('\n');

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium',
        size === 'xs' ? 'text-[9px]' : 'text-[10px]',
        tone,
        className,
      )}
      title={tooltip}
    >
      <Icon size={size === 'xs' ? 9 : 10} />
      {pill}
    </span>
  );
}
