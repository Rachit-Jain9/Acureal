import { create } from 'zustand';
import { authAPI } from '../services/api';
import { clearQueryCache } from '../lib/queryClient';

const getRequestErrorMessage = (err, fallbackMessage) => {
  if (err.response?.data?.message) {
    return err.response.data.message;
  }

  if (err.request) {
    return 'Cannot reach the API server. Check that the backend is running and CORS is configured for the current frontend port.';
  }

  return fallbackMessage;
};

// The session itself lives entirely in httpOnly cookies the browser
// manages — the access token is NEVER written to JS-readable storage, so
// no XSS payload can read it. We cache only the non-secret `user` profile
// so the UI can render the signed-in state without a round-trip. Storage
// tier mirrors "Remember me": localStorage survives a browser restart,
// sessionStorage clears on close.
const USER_KEY = 'user';

const getStoredUser = () => {
  const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const clearSession = () => {
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(USER_KEY);
  // Sweep the legacy access token from any pre-cookie session so a stale
  // copy can never linger in JS-readable storage.
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
};

const saveSession = (user, rememberMe) => {
  clearSession();
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem(USER_KEY, JSON.stringify(user));
  // Auth boundary: whoever signs in must start from an empty react-query
  // cache — cached rows are tenant data, and a previous account's deals /
  // financials must never be served as "fresh" to the next one. (All four
  // sign-in paths — password, MFA completion, register, Google — funnel
  // through here.)
  clearQueryCache();
};

const persistUser = (user) => {
  if (localStorage.getItem(USER_KEY)) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return;
  }
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
};

const getSessionPersistence = () => (localStorage.getItem(USER_KEY) ? 'persistent' : 'session');

const useAuthStore = create((set, get) => ({
  user: getStoredUser(),
  isAuthenticated: !!getStoredUser(),
  // Whether the boot-time session check has settled. With a cached profile it
  // is true immediately (the UI renders signed-in with zero flash, exactly as
  // before); without one it stays false until bootstrap() has asked the
  // server whether an httpOnly refresh cookie is still alive. Route guards
  // must not redirect to /login before this is true — doing so was the bug
  // that forced a manual sign-in whenever web storage was lost even though a
  // valid 30-day session cookie sat in the jar the whole time.
  authReady: !!getStoredUser(),
  loading: false,
  error: null,
  sessionPersistence: getSessionPersistence(),

  // One-time cold-boot session resolution. The cached profile in web storage
  // is a RENDERING convenience; the session's source of truth is the httpOnly
  // refresh cookie, which only the server can read. Reconcile the two:
  //   cached profile present → session assumed live (the 401 interceptor
  //     handles renewal), just re-sync the canonical user so server-added
  //     fields (role changes, is_platform_admin, MFA state) catch up.
  //   no cached profile → probe /auth/refresh through the interceptor-free
  //     client. 200 resurrects the session (the endpoint returns the full
  //     user); any failure settles the app as signed-out WITHOUT a redirect —
  //     the visitor may be on a public page.
  // Storage tier on resurrection is localStorage deliberately: a refresh
  // cookie that outlived the storage was a persistent ("Remember me") one —
  // session-tier cookies die with the browser that lost the storage.
  bootstrap: async () => {
    if (get().isAuthenticated) {
      get().refreshUser();
      return true;
    }
    try {
      const { data } = await authAPI.bootstrapRefresh();
      const user = data?.data?.user;
      if (!user) throw new Error('no user in refresh response');
      saveSession(user, true);
      set({ user, isAuthenticated: true, sessionPersistence: 'persistent', authReady: true });
      return true;
    } catch {
      set({ authReady: true });
      return false;
    }
  },

  // rememberMe rides in EVERY sign-in request body — the backend uses it to
  // choose between a 30-day persistent refresh cookie and a browser-session
  // one. Until 2026-07-17 it was stripped here on all four paths, which made
  // the checkbox a pure frontend illusion (it only picked localStorage vs
  // sessionStorage for the cached profile while a 30-day cookie was issued
  // regardless).
  login: async (email, password, rememberMe = false) => {
    set({ loading: true, error: null });
    try {
      const { data } = await authAPI.login({ email, password, rememberMe });

      // MFA branch — backend returned a challenge, not a session. The login
      // form intercepts this shape and shows the 6-digit code prompt.
      if (data?.mfaRequired) {
        set({ loading: false });
        return { mfaRequired: true, challenge: data.data?.challenge, expiresAt: data.data?.expiresAt, rememberMe };
      }

      const { user } = data.data;
      saveSession(user, rememberMe);
      set({
        user,
        isAuthenticated: true,
        loading: false,
        sessionPersistence: rememberMe ? 'persistent' : 'session',
      });
      return true;
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Login failed');
      set({ error: message, loading: false });
      return false;
    }
  },

  completeMfaLogin: async (challenge, code, rememberMe = false) => {
    set({ loading: true, error: null });
    try {
      const { data } = await authAPI.mfaVerify(challenge, code, rememberMe);
      const { user } = data.data;
      saveSession(user, rememberMe);
      set({
        user,
        isAuthenticated: true,
        loading: false,
        sessionPersistence: rememberMe ? 'persistent' : 'session',
      });
      return true;
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Code did not match. Try again.');
      set({ error: message, loading: false });
      return false;
    }
  },

  register: async (formData, rememberMe = false) => {
    set({ loading: true, error: null });
    try {
      const { data } = await authAPI.register({ ...formData, rememberMe });
      const { user } = data.data;
      saveSession(user, rememberMe);
      set({
        user,
        isAuthenticated: true,
        loading: false,
        sessionPersistence: rememberMe ? 'persistent' : 'session',
      });
      return true;
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Registration failed');
      set({ error: message, loading: false });
      return false;
    }
  },

  // Federated sign-in / sign-up via Google ID token. The backend resolves
  // (login vs bind vs register) based on the (provider, subject) and email
  // claims; the frontend only forwards the token + (on first-time signup)
  // the accepted T&C / Privacy versions.
  googleSignIn: async ({ idToken, acceptedTermsVersion, acceptedPrivacyVersion, invitationToken }, rememberMe = false) => {
    set({ loading: true, error: null });
    try {
      const { data } = await authAPI.googleSignIn({
        idToken,
        acceptedTermsVersion,
        acceptedPrivacyVersion,
        invitationToken,
        rememberMe,
      });
      const { user } = data.data;
      saveSession(user, rememberMe);
      set({
        user,
        isAuthenticated: true,
        loading: false,
        sessionPersistence: rememberMe ? 'persistent' : 'session',
      });
      return true;
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Google sign-in failed');
      set({ error: message, loading: false });
      return false;
    }
  },

  logout: async () => {
    // Best-effort server-side revoke. Failure is logged but never blocks
    // the local sign-out — the user expects the UI to log them out
    // immediately, and the cookies will expire on their own anyway.
    try {
      await authAPI.logout();
    } catch {
      // ignored
    }
    clearSession();
    // Auth boundary: drop every cached row on the way out, so nothing survives
    // in memory for whoever signs in next on this tab.
    clearQueryCache();
    set({ user: null, isAuthenticated: false, sessionPersistence: 'session' });
  },

  updateProfile: async (data) => {
    try {
      const { data: res } = await authAPI.updateMe(data);
      const updatedUser = res.data;
      persistUser(updatedUser);
      set({ user: updatedUser });
      return true;
    } catch {
      return false;
    }
  },

  // Re-fetch the canonical user from /auth/me. Used after MFA enrollment /
  // disable so the Settings UI reflects the new mfa_enrolled flag without
  // a hard reload.
  refreshUser: async () => {
    try {
      const { data: res } = await authAPI.getMe();
      const updatedUser = res.data;
      persistUser(updatedUser);
      set({ user: updatedUser });
      return updatedUser;
    } catch {
      return null;
    }
  },

  // Switch the active workspace. Mutates the cached active org so the api.js
  // request interceptor sends the new X-Organization-Id on every subsequent
  // call; the caller then refreshUser() + invalidates queries to re-scope the
  // UI (role/name differ per workspace). Persists to the same storage tier the
  // session already uses, so a reload keeps the chosen workspace.
  setActiveOrganization: (orgId) => {
    set((state) => {
      if (!state.user) return state;
      const next = { ...state.user, organization_id: orgId };
      if (localStorage.getItem(USER_KEY)) localStorage.setItem(USER_KEY, JSON.stringify(next));
      else sessionStorage.setItem(USER_KEY, JSON.stringify(next));
      return { user: next };
    });
  },

  clearError: () => set({ error: null }),
}));

export default useAuthStore;
