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

// Prefer localStorage over sessionStorage when both exist
const getStoredToken = () =>
  localStorage.getItem('token') || sessionStorage.getItem('token') || null;

const getStoredUser = () => {
  const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveSession = (token, user, rememberMe) => {
  clearSession();
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem('token', token);
  storage.setItem('user', JSON.stringify(user));
};

const getSessionPersistence = () => (localStorage.getItem('token') ? 'persistent' : 'session');

const clearSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
};

const useAuthStore = create((set) => ({
  user: getStoredUser(),
  token: getStoredToken(),
  isAuthenticated: !!getStoredToken(),
  loading: false,
  error: null,

  login: async (email, password, rememberMe = false) => {
    set({ loading: true, error: null });
    try {
      const { data } = await authAPI.login({ email, password });
      const { user, token } = data.data;
      saveSession(token, user, rememberMe);
      set({
        user,
        token,
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

  register: async (formData, rememberMe = false) => {
    set({ loading: true, error: null });
    try {
      const { data } = await authAPI.register(formData);
      const { user, token } = data.data;
      saveSession(token, user, rememberMe);
      set({
        user,
        token,
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

  logout: () => {
    clearSession();
    set({ user: null, token: null, isAuthenticated: false, sessionPersistence: 'session' });
  },

  updateProfile: async (data) => {
    try {
      const { data: res } = await authAPI.updateMe(data);
      const updatedUser = res.data;
      // Persist to whichever storage currently holds the user
      if (localStorage.getItem('token')) {
        localStorage.setItem('user', JSON.stringify(updatedUser));
      } else {
        sessionStorage.setItem('user', JSON.stringify(updatedUser));
      }
      set({ user: updatedUser });
      return true;
    } catch {
      return false;
    }
  },

  clearError: () => set({ error: null }),
  sessionPersistence: getSessionPersistence(),
}));

export default useAuthStore;
