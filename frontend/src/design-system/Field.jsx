// Form primitives — Field (label + control + helper/error layout) and the
// styled Input / Select / Textarea controls.
//
// Field auto-wires accessibility: it generates an id, points the <label> at
// the control, marks the control invalid when an `error` is present, and links
// helper/error text via aria-describedby. The `.input` CSS class in index.css
// stays for back-compat; new and changed forms use these components.
//
//   <Field label="Deal name" required error={errors.name}>
//     <Input value={name} onChange={...} />
//   </Field>

import { forwardRef, useId, cloneElement, isValidElement } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';

const CONTROL_BASE =
  'w-full bg-bg-elevated text-content-primary border rounded-md text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-content-muted ' +
  'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const borderClass = (invalid) => (invalid ? 'border-data-negative' : 'border-hairline');

export const Input = forwardRef(function Input(
  { invalid = false, trailing, className, ...rest },
  ref,
) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(CONTROL_BASE, borderClass(invalid), 'px-3 py-2', trailing && 'pr-9', className)}
      {...rest}
    />
  );
  if (!trailing) return control;
  // `trailing` hosts an in-field affordance (password show/hide, clear, etc.).
  return (
    <div className="relative">
      {control}
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
        {trailing}
      </span>
    </div>
  );
});

export const Textarea = forwardRef(function Textarea(
  { invalid = false, rows = 3, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={clsx(CONTROL_BASE, borderClass(invalid), 'px-3 py-2 resize-y', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef(function Select(
  { invalid = false, className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={clsx(
          CONTROL_BASE,
          borderClass(invalid),
          'px-3 py-2 pr-9 appearance-none cursor-pointer',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted"
      />
    </div>
  );
});

export function Field({ label, required = false, helper, error, children, className }) {
  const generatedId = useId();
  const descId = `${generatedId}-desc`;
  const controlId = (isValidElement(children) && children.props.id) || generatedId;
  const hasMessage = Boolean(error || helper);

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        invalid: children.props.invalid ?? Boolean(error),
        'aria-describedby':
          clsx(children.props['aria-describedby'], hasMessage && descId) || undefined,
      })
    : children;

  return (
    <div className={clsx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={controlId} className="block text-sm font-medium text-content-secondary">
          {label}
          {required && (
            <span className="text-data-negative ml-0.5" aria-hidden="true">*</span>
          )}
        </label>
      )}
      {control}
      {error ? (
        <p id={descId} role="alert" className="text-xs text-data-negative">{error}</p>
      ) : helper ? (
        <p id={descId} className="text-xs text-content-muted">{helper}</p>
      ) : null}
    </div>
  );
}

export default Field;
