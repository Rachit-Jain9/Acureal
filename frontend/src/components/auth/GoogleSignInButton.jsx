// Google Identity Services (GIS) sign-in button.
//
// Why raw GIS instead of @react-oauth/google or Supabase Auth:
//   - One JS file (https://accounts.google.com/gsi/client), zero npm deps,
//     no SDK version drift.
//   - Backend remains the single source of truth for auth; this component
//     just hands an ID token to /api/auth/google.
//   - Works without leaving the page — no redirect to Google's domain — so
//     we never have to round-trip the legal-acceptance state through a
//     redirect callback.
//
// Activation gate: this component renders nothing unless the backend reports
// `enabled: true` from /auth/google/config. Until the operator sets
// GOOGLE_OAUTH_CLIENT_ID, the surrounding card is hidden — so shipping this
// PR before Google Cloud Console is configured is safe.

import { useEffect, useRef, useState } from 'react';
import { authAPI } from '../../services/api';

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let gisScriptPromise = null;

const loadGisScript = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google || null));
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services.')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google || null);
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(script);
  });

  return gisScriptPromise;
};

/**
 * Renders Google's official Sign in with Google button.
 *
 * @param {Object} props
 * @param {(idToken: string) => void} props.onCredential  Called with the
 *   raw ID token after the user completes the GIS prompt. The parent is
 *   responsible for posting it to /api/auth/google.
 * @param {boolean} [props.disabled]  When true, the button is rendered but
 *   click is intercepted (used while T&C checkbox is unchecked on signup).
 * @param {string} [props.disabledReason]  Tooltip to show why the button is
 *   currently disabled.
 * @param {string} [props.text]  GIS button text variant: signin_with |
 *   signup_with | continue_with | signin (default: continue_with).
 * @param {string} [props.theme]  GIS theme: outline | filled_blue | filled_black.
 * @param {boolean} [props.showDivider]  When true, renders an "or" divider
 *   beneath the button so the parent does not have to know whether the
 *   button rendered anything (avoids flicker / phantom dividers).
 * @returns {JSX.Element|null}  Null when the feature flag is off.
 */
export default function GoogleSignInButton({
  onCredential,
  disabled = false,
  disabledReason = '',
  text = 'continue_with',
  theme = 'outline',
  showDivider = false,
}) {
  const containerRef = useRef(null);
  const [config, setConfig] = useState(null);   // { enabled, clientId }
  const [error, setError] = useState('');

  // Fetch the feature-flag config once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authAPI.googleConfig();
        if (cancelled) return;
        setConfig(res?.data?.data || { enabled: false, clientId: null });
      } catch {
        if (cancelled) return;
        setConfig({ enabled: false, clientId: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialise GIS and render the button once the config + DOM are ready.
  useEffect(() => {
    if (!config?.enabled || !config.clientId || !containerRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const google = await loadGisScript();
        if (cancelled || !google?.accounts?.id || !containerRef.current) return;

        google.accounts.id.initialize({
          client_id: config.clientId,
          callback: (response) => {
            if (response?.credential) {
              onCredential(response.credential);
            }
          },
          ux_mode: 'popup',
          // We deliberately do NOT enable One Tap (auto_select / cancel_on_tap_outside)
          // — for an investor-grade B2B flow, an unsolicited account picker on
          // page load is intrusive. The button is explicit consent.
        });

        // Render with width matching the parent. GIS rounds to its grid;
        // 320 fits the Login card cleanly at default zoom.
        google.accounts.id.renderButton(containerRef.current, {
          theme,
          size: 'large',
          type: 'standard',
          shape: 'rectangular',
          text,
          logo_alignment: 'left',
          width: 320,
        });
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Could not load Google sign-in.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config, onCredential, text, theme]);

  if (!config) return null;          // initial loading — no flicker
  if (!config.enabled) return null;  // feature flag off — render nothing

  return (
    <div className="w-full">
      <div className="relative inline-flex w-full justify-center">
        <div ref={containerRef} aria-label="Sign in with Google" />
        {disabled && (
          // Transparent click-shield. Lets the GIS button still render its
          // hover state but blocks the click until pre-conditions (T&C
          // acceptance) are met. Pointer-events on the shield only.
          <button
            type="button"
            aria-label={disabledReason || 'Accept the Terms first'}
            title={disabledReason || 'Accept the Terms first'}
            onClick={(e) => e.preventDefault()}
            className="absolute inset-0 cursor-not-allowed bg-white/40"
          />
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs text-rose-700">{error}</p>
      )}
      {showDivider && (
        <div className="flex items-center gap-3 mt-4 text-[11px] uppercase tracking-[0.14em] text-stone-500">
          <span className="flex-1 h-px bg-stone-200" />
          or
          <span className="flex-1 h-px bg-stone-200" />
        </div>
      )}
    </div>
  );
}
