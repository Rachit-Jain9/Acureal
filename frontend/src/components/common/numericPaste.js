// onPaste handler for money / area number inputs.
//
// A native <input type="number"> silently CLEARS itself when you paste a
// grouped figure like "₹5,35,67,890" (commas make it an invalid number), so
// copy-pasting a price from a broker's message or an Excel cell fails. This
// intercepts that paste, normalizes it deterministically, and writes the clean
// value via the field's own setter. A genuinely clean number is left to paste
// natively; a ₹ Cr field that receives a full-rupee figure is interpreted as
// crore, with a transparent toast; unreadable text raises a clear toast and the
// input is left unchanged.

import { normalizeNumericPaste, groupIndian } from '../../utils/format';
import { toast } from './Toast';

/**
 * @param {ClipboardEvent} event  the React onPaste event
 * @param {'rupeeCrore'|'rupeePlain'|'count'|'none'} kind
 * @param {(value: string) => void} setValue  writes the normalized value back
 *        (e.g. `(v) => handleChange({ target: { name, value: v } })`)
 */
export function handleNumericPaste(event, kind, setValue) {
  if (!kind || kind === 'none') return; // not a money/area field — leave it alone
  const text = event.clipboardData?.getData('text') ?? '';
  if (!text) return;
  // A clean, ungrouped number pastes fine natively — don't interfere. (Crore
  // fields still run through so a full-rupee paste can be read as crore.)
  if (kind !== 'rupeeCrore' && /^\s*\d*\.?\d+\s*$/.test(text)) return;

  const res = normalizeNumericPaste(text, kind);
  event.preventDefault();
  if (!res.ok) {
    toast.error(`Couldn't paste that — ${res.reason}. Paste a number.`);
    return;
  }
  setValue(String(res.value));
  if (res.asCrore) {
    toast.success(`Read ₹${groupIndian(res.interpretedFrom)} as ₹${Number(res.value).toFixed(2)} Cr`);
  }
}

export default handleNumericPaste;
