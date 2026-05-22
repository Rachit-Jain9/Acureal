// Modal — accessible dialog primitive (WAI-ARIA APG dialog pattern).
//
// Replaces hand-rolled `fixed inset-0` overlays. Renders through a portal to
// document.body so a transformed ancestor can never clip it. Focus is trapped
// while open (useFocusTrap), Escape and overlay-click close it, body scroll is
// locked, and enter/exit are animated per docs/FRONTEND_GUIDELINES.md §8 —
// collapsing to an instant flip under prefers-reduced-motion.
//
//   <Modal open={open} onClose={close} title="Edit deal" footer={<>...</>}>
//     ...form...
//   </Modal>

import { useEffect, useId, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import useFocusTrap from '../hooks/useFocusTrap';
import useReducedMotion from '../hooks/useReducedMotion';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const EXIT_MS = 180;

function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close dialog"
      className="shrink-0 p-1.5 rounded-md text-content-muted transition-colors duration-150 ease-out
        hover:text-content-primary hover:bg-bg-secondary
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <X size={16} />
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  ariaLabel,
  size = 'md',
  footer,
  closeOnOverlayClick = true,
  className,
  children,
}) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const titleId = useId();
  const descId = useId();

  // Stabilise onClose for useFocusTrap's dependency array — without this an
  // inline `() => setOpen(false)` would re-arm the trap (and re-autofocus)
  // on every parent render, yanking focus out of a form mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const handleEscape = useCallback(() => onCloseRef.current?.(), []);

  // Mount as soon as `open` flips true.
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Drive the enter/exit animation and the deferred unmount.
  useEffect(() => {
    if (!mounted) return undefined;
    if (open) {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), reduced ? 0 : EXIT_MS);
    return () => clearTimeout(t);
  }, [open, mounted, reduced]);

  // Lock body scroll while the dialog occupies the screen.
  useEffect(() => {
    if (!mounted) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mounted]);

  const trapRef = useFocusTrap(mounted && open, { onEscape: handleEscape });

  if (!mounted) return null;

  const animate = !reduced;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        aria-hidden="true"
        onClick={closeOnOverlayClick ? onClose : undefined}
        className={clsx(
          'absolute inset-0 bg-black/50',
          animate && 'transition-opacity ease-out duration-150',
          animate && !visible && 'opacity-0',
        )}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        aria-describedby={description ? descId : undefined}
        className={clsx(
          'relative w-full max-h-[90vh] flex flex-col',
          'bg-bg-elevated border border-hairline rounded-editorial shadow-editorial-lg',
          SIZES[size] || SIZES.md,
          animate && 'transition-[opacity,transform] will-change-transform',
          animate && (open
            ? 'duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]'
            : 'duration-[180ms] ease-[cubic-bezier(0.7,0,0.84,0)]'),
          animate && !visible && 'opacity-0 translate-y-2',
          className,
        )}
      >
        {title ? (
          <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 shrink-0">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="font-display text-base font-semibold text-content-primary leading-tight"
              >
                {title}
              </h2>
              {description && (
                <p id={descId} className="text-sm text-content-secondary mt-1">
                  {description}
                </p>
              )}
            </div>
            <CloseButton onClose={onClose} />
          </header>
        ) : (
          <div className="absolute right-3 top-3 z-10">
            <CloseButton onClose={onClose} />
          </div>
        )}
        <div className={clsx('overflow-y-auto px-5', title ? 'pb-5' : 'py-5')}>
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-3 px-5 py-4 border-t border-hairline shrink-0">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
