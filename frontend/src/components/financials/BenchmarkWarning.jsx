import { AlertTriangle, AlertOctagon } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * BenchmarkWarning (PR-NX52 — 2026-05-19)
 *
 * Inline market-benchmark warning chip rendered BELOW a financial input
 * when the typed value triggers a threshold from the XLSX-export
 * market-benchmark validators (PR-NX28/NX33) — but at INPUT TIME, not
 * 5 hours later at export time.
 *
 * Renders nothing when `warning` is null (input is within band).
 *
 * Severity tones:
 *   - 'warn'     amber background + amber triangle icon
 *   - 'critical' red background + octagon icon (RBI floor violations etc.)
 */
export default function BenchmarkWarning({ warning }) {
  if (!warning) return null;
  const isCritical = warning.severity === 'critical';
  const Icon = isCritical ? AlertOctagon : AlertTriangle;
  return (
    <div
      role="alert"
      className={clsx(
        'mt-1 px-2 py-1 rounded-md border text-[11px] leading-snug flex items-start gap-1.5',
        isCritical
          ? 'bg-data-negative/10 border-data-negative/30 text-data-negative'
          : 'bg-amber-50 border-amber-200 text-amber-900',
      )}
    >
      <Icon size={12} className={clsx('flex-shrink-0 mt-0.5', isCritical ? 'text-data-negative' : 'text-amber-700')} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{warning.label}</div>
        {warning.detail && (
          <div className="text-[10.5px] mt-0.5 leading-snug opacity-90">{warning.detail}</div>
        )}
      </div>
    </div>
  );
}
