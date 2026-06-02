import { create } from 'zustand';
import { authAPI } from '../services/api';

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
};

const persistUser = (user) => {
  if (localStorage.getItem(USER_KEY)) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return;
  }
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
};

const getSessionPersistence = () => (localStorage.getItem(USER_KEY) ? 'persistent' : 'session');

const useAuthStore = create((set) => ({
  user: getStoredUser(),
  isAuthenticated: !!getStoredUser(),
  loading: false,
  error: null,
  sessionPersistence: getSessionPersistence(),

  login: async (email, password, rememberMe = false) => {
    set({ loading: true, error: null });
    try {
      const { data } = await authAPI.login({ email, password });

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
      const { data } = await authAPI.mfaVerify(challenge, code);
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
      const { data } = await authAPI.register(formData);
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
