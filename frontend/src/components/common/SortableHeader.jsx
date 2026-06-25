import clsx from 'clsx';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

/**
 * Clickable <th> with a sort indicator. Cycles asc → desc → null on click.
 *
 * Parent owns the sort state shape:
 *   const [sort, setSort] = useState({ key: 'rate', dir: 'desc' });
 *
 * Pass the same `sort` to every header; on click the parent updates it via
 * the `cycleSort(key, prev)` helper exported below.
 */
export function cycleSort(key, prev) {
  if (prev?.key !== key)         return { key, dir: 'asc' };
  if (prev.dir === 'asc')        return { key, dir: 'desc' };
  if (prev.dir === 'desc')       return { key: null, dir: null };
  return { key, dir: 'asc' };
}

/**
 * Useful generic sort function. Pass `sortKey` getter or a string (object
 * key). Returns a new sorted array. Stable for nullish values (always last).
 */
export function applySort(rows, sort, getters = {}) {
  if (!sort || !sort.key || !sort.dir) return rows;
  const get = getters[sort.key] || ((row) => row[sort.key]);
  const dir = sort.dir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

export default function SortableHeader({
  children,
  sortKey,
  sort,
  onSort,
  align = 'left',
  className,
}) {
  const active = sort?.key === sortKey;
  const dir = active ? sort.dir : null;

  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th
      className={clsx(
        'select-none',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      aria-sort={!active ? 'none' : dir === 'asc' ? 'ascending' : 'descending'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={clsx(
          'inline-flex items-center gap-1 font-semibold text-[11px] tracking-wide uppercase',
          'transition-colors duration-150 ease-out',
          'rounded px-1 -mx-1 py-1',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-content-primary' : 'text-content-secondary',
          'hover:text-content-primary hover:bg-bg-secondary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          'active:scale-[0.98]',
        )}
      >
        <span>{children}</span>
        <Icon
          size={11}
          className={clsx(
            'shrink-0 transition-opacity duration-150',
            active ? 'text-accent opacity-100' : 'text-content-muted opacity-60',
          )}
        />
      </button>
    </th>
  );
}
