import { useEffect, useState } from 'react';

// Debounces a value by `delay` ms. Used for search inputs so we don't
// re-filter on every keystroke. 250ms is the standing default per
// FRONTEND_GUIDELINES.md §3 (filters and search inputs).
export default function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
