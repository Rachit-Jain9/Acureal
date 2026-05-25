// ConfirmDialog — promise-based replacement for native `window.confirm()`.
//
// Why this exists:
//   `window.confirm()` blocks the JavaScript event loop, mounts an OS-themed
//   dialog that ignores the design system, and looks unprofessional in a
//   Bloomberg / Stripe / Linear-tier product. Replacing it with a real Modal
//   keeps the editorial chrome, gets us focus-trap + ESC + animation +
//   prefers-reduced-motion handling for free, and lets us colour-code by
//   destructiveness (danger / warn / info).
//
// API mirrors the Toast singleton (zustand store + `confirm()` function) so
// call sites that previously did `if (!window.confirm("...")) return;` need
// only a single-line change:
//
//   import { confirm } from '../design-system';
//   if (!(await confirm({ title: 'Delete?', tone: 'danger' }))) return;
//
// The container component (`ConfirmDialogContainer`) is mounted once at the
// app root next to `<ToastContainer />`. Multiple sequential confirms queue
// implicitly through the resolved promise — the next `confirm()` call just
// replaces the current state once the previous one resolves.

import { useRef } from 'react';
import { create } from 'zustand';
import Modal from './Modal';
import Button from './Button';

/**
 * @typedef {Object} ConfirmOptions
 * @property {string} title                  Headline question (required).
 * @property {string=} message               Optional supporting copy.
 * @property {'danger'|'warn'|'info'=} tone  Visual tone. Default 'warn'.
 *                                           'danger' → red Confirm button (destructive ops).
 *                                           'warn'   → primary Confirm button (default).
 *                                           'info'   → primary Confirm button, no warning chrome.
 * @property {string=} confirmLabel          Label on the affirmative button. Default 'Confirm'.
 * @property {string=} cancelLabel           Label on the cancel button. Default 'Cancel'.
 */

export const useConfirmStore = create((set) => ({
  /** @type {(ConfirmOptions & { id: number, resolve: (v: boolean) => void }) | null} */
  pending: null,

  open: (opts) => new Promise((resolve) => {
    set({
      pending: {
        id: Date.now(),
        title: opts.title,
        message: opts.message,
        tone: opts.tone || 'warn',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        resolve,
      },
    });
  }),

  resolveCurrent: (value) => {
    const { pending } = useConfirmStore.getState();
    if (pending) {
      pending.resolve(value);
      // Mark as resolved so the Modal's exit animation can play before the
      // payload disappears. `cachedPending` in the container holds the props.
      set({ pending: null });
    }
  },
}));

/**
 * Singleton confirm() — call from anywhere in the app. Returns a promise that
 * resolves to `true` on confirm / `false` on cancel/dismiss.
 *
 * @param {ConfirmOptions} opts
 * @returns {Promise<boolean>}
 *
 * @example
 *   if (!(await confirm({ title: 'Delete this comp?', tone: 'danger' }))) return;
 *   await deleteComp(id);
 */
export function confirm(opts) {
  return useConfirmStore.getState().open(opts);
}

/**
 * Container component — mount once at the app root (next to <ToastContainer />).
 * Listens to the store and renders a single Modal that any caller can drive
 * via `confirm({...})`. Holds the last-shown props in a ref so the Modal's
 * exit animation can finish rendering them after the store clears.
 */
export function ConfirmDialogContainer() {
  const pending = useConfirmStore((s) => s.pending);
  const resolveCurrent = useConfirmStore((s) => s.resolveCurrent);

  // The Modal primitive plays a 180ms exit animation when `open` flips false.
  // During that window we still need to render the title / footer, but our
  // store-backed `pending` has already cleared. Cache the last non-null props
  // in a ref so the exit frames see real data.
  const lastRef = useRef(null);
  if (pending) lastRef.current = pending;
  const display = pending || lastRef.current;

  if (!display) return null;

  const handleCancel = () => resolveCurrent(false);
  const handleConfirm = () => resolveCurrent(true);

  return (
    <Modal
      open={Boolean(pending)}
      onClose={handleCancel}
      title={display.title}
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={handleCancel}>
            {display.cancelLabel}
          </Button>
          <Button
            variant={display.tone === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            autoFocus
          >
            {display.confirmLabel}
          </Button>
        </>
      )}
    >
      {display.message && (
        <p className="text-sm text-content-secondary whitespace-pre-line">
          {display.message}
        </p>
      )}
    </Modal>
  );
}

export default ConfirmDialogContainer;
