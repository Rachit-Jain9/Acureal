// Editorial checkbox primitive — accessible, themeable, animation-respectful.
// Replaces hand-rolled <input type="checkbox" className="..." /> uses across
// the app. Match the FRONTEND_GUIDELINES.md interaction-state matrix:
// default → hover → focus-visible → active.

import { forwardRef } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';

const TONE_RING = {
  default: 'focus-visible:ring-accent/40 group-hover:border-content-muted',
  error: 'focus-visible:ring-rose-400/50 border-rose-400 group-hover:border-rose-500',
};

// Keep the visual checkbox + label tappable as one unit. The native <input>
// stays in the DOM for accessibility and form semantics; we render a styled
// box on top via peer-checked.
const Checkbox = forwardRef(function Checkbox(
  { id, checked, onChange, disabled = false, tone = 'default', className, label, children, ...rest },
  ref,
) {
  return (
    <span className={clsx('inline-flex items-start gap-2 group', className)}>
      <span className="relative shrink-0 mt-0.5">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={tone === 'error' || undefined}
          className={clsx(
            'peer absolute inset-0 w-4 h-4 opacity-0 cursor-pointer disabled:cursor-not-allowed',
            'focus-visible:outline-none',
          )}
          {...rest}
        />
        <span
          aria-hidden="true"
          className={clsx(
            'flex items-center justify-center w-4 h-4 rounded-sm border bg-bg-elevated',
            'transition-colors duration-150 ease-out',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-bg-secondary',
            'peer-checked:bg-accent peer-checked:border-accent peer-disabled:opacity-50',
            TONE_RING[tone] || TONE_RING.default,
            tone === 'error' ? 'border-rose-400' : 'border-hairline-strong',
          )}
        >
          <Check
            size={12}
            strokeWidth={3}
            className={clsx(
              'text-white transition-opacity duration-100 ease-out',
              checked ? 'opacity-100' : 'opacity-0',
            )}
          />
        </span>
      </span>
      {(label || children) && (
        <label
          htmlFor={id}
          className={clsx(
            'text-sm leading-snug select-none cursor-pointer',
            'text-content-primary',
            disabled && 'opacity-60 cursor-not-allowed',
          )}
        >
          {label || children}
        </label>
      )}
    </span>
  );
});

export default Checkbox;
