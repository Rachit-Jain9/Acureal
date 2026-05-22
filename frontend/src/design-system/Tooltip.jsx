// Tooltip — lightweight accessible tooltip.
//
// Shows on hover AND keyboard focus (group-hover / group-focus-within), so it
// is not mouse-only. CSS-only visibility — no JS state, no re-renders, no
// positioning library — which keeps it cheap and in line with the
// "lighter, less cluttered" standing rule. The trigger is linked to the
// bubble via aria-describedby. Pick a `placement` the trigger has room for;
// there is no collision detection.
//
//   <Tooltip content="Cleared inputs feed the sensitivity run" placement="top">
//     <button aria-label="About sensitivity">?</button>
//   </Tooltip>

import { useId, cloneElement, isValidElement } from 'react';
import clsx from 'clsx';

const PLACEMENT = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

export function Tooltip({ content, placement = 'top', children, className }) {
  const id = useId();
  if (content == null || content === '') return children;

  const trigger = isValidElement(children)
    ? cloneElement(children, { 'aria-describedby': id })
    : children;

  return (
    <span className="group relative inline-flex">
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={clsx(
          'pointer-events-none absolute z-50 max-w-xs whitespace-normal text-left',
          'rounded-md px-2 py-1 text-xs leading-snug',
          'bg-surface-2 text-content-primary border border-hairline shadow-editorial',
          'opacity-0 invisible transition-[opacity,visibility] duration-150 ease-out',
          'group-hover:opacity-100 group-hover:visible',
          'group-focus-within:opacity-100 group-focus-within:visible',
          PLACEMENT[placement] || PLACEMENT.top,
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}

export default Tooltip;
