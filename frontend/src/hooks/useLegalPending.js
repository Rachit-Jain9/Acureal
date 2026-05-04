import { useCallback, useEffect, useState } from 'react';
import { legalAPI } from '../services/api';
import useAuthStore from '../store/authStore';

/**
 * Authenticated hook — reports which currently-published legal documents the
 * signed-in user has *not* yet accepted, so the app can gate access behind a
 * re-acceptance modal when Terms or Privacy version-bumps.
 *
 * Returns:
 *   - pending: array of { id, kind, version, effective_at, content_sha256 }
 *   - loading: true while the first fetch is in flight
 *   - error:   axios error, if the fetch failed
 *   - refresh: re-runs the fetch (call after a successful accept)
 *
 * Skips the fetch entirely when the user is unauthenticated (e.g. on
 * /login, /, /terms). Re-fires whenever the auth state flips.
 */
export default function useLegalPending() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      setPending([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    legalAPI
      .myAcceptances()
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.data?.data?.pending) ? res.data.data.pending : [];
        // Only Terms + Privacy gate the app — Cookie Policy is informational
        // (essentials-only, no banner UI is collecting separate consent), and
        // DPA / AUP only attach to enterprise tier which doesn't exist yet.
        // Filter so the modal never demands acceptance of something the user
        // never signed up for.
        const gating = list.filter(
          (doc) => doc.kind === 'terms_of_service' || doc.kind === 'privacy_policy',
        );
        setPending(gating);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
        // Fail-open: if /api/legal/me errors, do NOT block the user. The
        // UI degrades to "no modal" rather than locking everyone out on a
        // backend hiccup.
        setPending([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId, tick]);

  return { pending, loading, error, refresh };
}
