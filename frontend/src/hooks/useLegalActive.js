import { useEffect, useState } from 'react';
import { legalAPI } from '../services/api';

// Public hook — fetches the current published legal documents for the
// signup form and the Terms / Privacy / Cookie pages. No auth required.
// Cached on the API server (5 min); we additionally cache the resolved
// promise per browser-tab via module scope to avoid redundant network on
// page transitions.

let inFlight = null;
let cached = null;

export function useLegalActive() {
  const [data, setData] = useState(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    if (cached) {
      setData(cached);
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    if (!inFlight) {
      inFlight = legalAPI
        .getActive()
        .then((res) => res.data?.data || {})
        .then((docs) => {
          cached = docs;
          return docs;
        })
        .catch((err) => {
          inFlight = null;
          throw err;
        });
    }

    inFlight
      .then((docs) => {
        if (!mounted) return;
        setData(docs);
        setLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err);
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { data, loading, error };
}

// Test/utility — allows tests to reset the module-scoped cache between cases.
export function _resetLegalActiveCache() {
  inFlight = null;
  cached = null;
}
