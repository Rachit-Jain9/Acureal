import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Windowing wrapper for long lists. Below `threshold` rows, falls back to
 * a plain rendering — the cost of virtualization is keeping a stable ref
 * plus measurement loops, which only pays off once row count clears ~100.
 *
 * The hook is always invoked (rules-of-hooks); we just don't read its
 * virtual items when the threshold isn't met.
 *
 * Usage:
 *   <VirtualizedList items={comps} estimateSize={48}>
 *     {(comp) => <CompRow comp={comp} />}
 *   </VirtualizedList>
 */
export default function VirtualizedList({
  items = [],
  children,
  estimateSize = 48,
  threshold = 100,
  maxHeight = 480,
  overscan = 8,
  containerClassName = '',
  containerStyle,
  emptyState,
  ariaLabel = 'List',
}) {
  const parentRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  if (!items.length && emptyState) return emptyState;

  const shouldVirtualize = items.length >= threshold;

  if (!shouldVirtualize) {
    return (
      <div className={containerClassName} style={containerStyle} aria-label={ariaLabel}>
        {items.map((item, index) => children(item, index))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={containerClassName}
      style={{ ...(containerStyle || {}), maxHeight, overflowY: 'auto', position: 'relative' }}
      aria-label={ariaLabel}
      role="list"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            role="listitem"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {children(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
