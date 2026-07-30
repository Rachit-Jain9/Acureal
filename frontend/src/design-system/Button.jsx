// Button — the canonical interactive control for Acureal.
//
// Replaces the scatter of `.btn` CSS classes, inline-styled buttons, and raw
// Tailwind buttons with one primitive that enforces the
// docs/FRONTEND_GUIDELINES.md §3 interaction-state matrix
// (default -> hover -> focus-visible -> active) and carries loading + icon
// affordances. The `.btn*` CSS classes in index.css stay for back-compat with
// existing call sites; new and changed code uses <Button>.
//
//   <Button variant="primary" size="md" onClick={...}>Save</Button>
//   <Button variant="danger" loading={saving}>Delete</Button>
//   <Button as={Link} to="/x" variant="ghost" leftIcon={<ArrowLeft size={14}/>}>Back</Button>

import { forwardRef } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

const BASE =
  'inline-flex items-center justify-center font-medium whitespace-nowrap rounded-md ' +
  'select-none transition duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 ' +
  'active:scale-[0.98] disabled:active:scale-100 ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'aria-disabled:opacity-50 aria-disabled:pointer-events-none';

const VARIANTS = {
  primary:
    'bg-accent text-white hover:bg-accent-hover focus-visible:ring-accent/60',
  secondary:
    'bg-bg-elevated text-content-primary border border-hairline ' +
    'hover:bg-bg-secondary hover:border-hairline-strong focus-visible:ring-accent/40',
  ghost:
    'bg-transparent text-content-secondary ' +
    'hover:bg-bg-secondary hover:text-content-primary focus-visible:ring-accent/40',
  danger:
    'bg-data-negative text-white hover:brightness-110 focus-visible:ring-data-negative/50',
};

const SIZES = {
  sm: 'text-xs px-2.5 py-1.5 gap-1.5',
  md: 'text-sm px-3.5 py-2 gap-1.5',
  lg: 'text-sm px-5 py-2.5 gap-2',
};

const SPINNER_SIZE = { sm: 13, md: 14, lg: 15 };

const Button = forwardRef(function Button(
  {
    as: Component = 'button',
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    fullWidth = false,
    leftIcon = null,
    rightIcon = null,
    type,
    className,
    children,
    ...rest
  },
  ref,
) {
  const isNativeButton = Component === 'button';
  const isDisabled = disabled || loading;

  return (
    <Component
      ref={ref}
      type={isNativeButton ? type || 'button' : type}
      disabled={isNativeButton ? isDisabled : undefined}
      aria-disabled={!isNativeButton && isDisabled ? true : undefined}
      aria-busy={loading || undefined}
      className={clsx(
        BASE,
        VARIANTS[variant] || VARIANTS.secondary,
        SIZES[size] || SIZES.md,
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && (
        <Loader2
          size={SPINNER_SIZE[size] || 14}
          className="animate-spin shrink-0"
          aria-hidden="true"
        />
      )}
      {!loading && leftIcon}
      {children != null && children !== '' && <span className="truncate">{children}</span>}
      {!loading && rightIcon}
    </Component>
  );
});

export default Button;
