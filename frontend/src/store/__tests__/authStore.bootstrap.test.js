/**
 * Cold-boot session resolution (regression suite, 2026-08-01).
 *
 * The bug: `isAuthenticated` was defined as "a cached profile exists in web
 * storage", and ProtectedRoute redirected to /login the moment it was false.
 * The actual session — a 30-day httpOnly refresh cookie — was never consulted
 * at boot. Any storage loss (browser cleanup, Safari's 7-day script-storage
 * cap, cleared site data) therefore forced a manual sign-in while a perfectly
 * valid session sat in the cookie jar. Production evidence: 15 fresh login
 * families in 14 days for one remember-me user, zero server-side revocations.
 *
 * bootstrap() reconciles the two: no cached profile → probe /auth/refresh
 * through the interceptor-free client and resurrect the session from its
 * response; cached profile → re-sync the canonical user exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api', () => ({
  authAPI: {
    bootstrapRefresh: vi.fn(),
    getMe: vi.fn(),
    logout: vi.fn(),
  },
}));
vi.mock('../../lib/queryClient', () => ({ clearQueryCache: vi.fn() }));

import { authAPI } from '../../services/api';
import useAuthStore from '../authStore';

const USER = { id: 'u-1', email: 'analyst@acureal.in', organization_id: 'org-1', role: 'owner' };

const resetStore = ({ authenticated = false } = {}) => {
  localStorage.clear();
  sessionStorage.clear();
  if (authenticated) {
    localStorage.setItem('user', JSON.stringify(USER));
  }
  useAuthStore.setState({
    user: authenticated ? USER : null,
    isAuthenticated: authenticated,
    authReady: authenticated,
    loading: false,
    error: null,
    sessionPersistence: authenticated ? 'persistent' : 'session',
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('bootstrap() — no cached profile', () => {
  it('resurrects the session from a live refresh cookie', async () => {
    authAPI.bootstrapRefresh.mockResolvedValue({ data: { data: { user: USER } } });

    const ok = await useAuthStore.getState().bootstrap();

    expect(ok).toBe(true);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.authReady).toBe(true);
    expect(state.user).toEqual(USER);
    // A cookie that outlived the storage was a persistent one — the profile
    // re-caches to localStorage so the next reload is instant again.
    expect(JSON.parse(localStorage.getItem('user'))).toEqual(USER);
    expect(state.sessionPersistence).toBe('persistent');
  });

  it('settles as signed-out on 401 — ready, no redirect side-effects here', async () => {
    authAPI.bootstrapRefresh.mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));

    const ok = await useAuthStore.getState().bootstrap();

    expect(ok).toBe(false);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    // THE point of the fix: the app knows the check happened. Route guards
    // may now redirect; before this flag they redirected pre-emptively.
    expect(state.authReady).toBe(true);
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('treats a malformed refresh response as signed-out, never half-authenticated', async () => {
    authAPI.bootstrapRefresh.mockResolvedValue({ data: { data: {} } });

    const ok = await useAuthStore.getState().bootstrap();

    expect(ok).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().authReady).toBe(true);
  });
});

describe('bootstrap() — cached profile present', () => {
  it('never probes the refresh endpoint; re-syncs the canonical user instead', async () => {
    resetStore({ authenticated: true });
    authAPI.getMe.mockResolvedValue({ data: { data: { ...USER, is_platform_admin: true } } });

    const ok = await useAuthStore.getState().bootstrap();

    expect(ok).toBe(true);
    expect(authAPI.bootstrapRefresh).not.toHaveBeenCalled();
    expect(authAPI.getMe).toHaveBeenCalledTimes(1);
  });
});

describe('logout()', () => {
  it('stays authReady — signing out must not re-block the UI behind the boot gate', async () => {
    resetStore({ authenticated: true });
    authAPI.logout.mockResolvedValue({});

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.authReady).toBe(true);
  });
});
