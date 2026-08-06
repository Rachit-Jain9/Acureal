// Public invitation landing page — the step that never existed.
//
// The backend has accepted an `invitationToken` at registration since the
// multi-tenancy work, and the Google sign-in path accepts one too. But no
// surface in the product ever produced or forwarded a token: invitations were
// created, the raw token was returned to the inviting admin's browser, and
// nothing was ever emailed or consumed. This page is the missing half — it is
// where the link in the invitation email lands.
//
// It shows WHO invited you and to WHICH workspace before asking for anything,
// because an unexpected "create an account" screen with no context reads as
// phishing. The token is the secret, so the preview endpoint is public.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Building2, Loader2, UserPlus } from 'lucide-react';
import { organizationAPI } from '../services/api';
import useAuthStore from '../store/authStore';
import usePublicLightTheme from '../hooks/usePublicLightTheme';
import { Button, ErrorState } from '../design-system';
import { AcurealWordmark } from '../components/brand/AcurealBrand';

const ROLE_COPY = {
  admin: 'as an admin — you can manage members and settings',
  editor: 'as an editor — you can work on deals',
  viewer: 'as a viewer — you can read deals but not change them',
};

export default function InvitePage() {
  usePublicLightTheme();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const { isAuthenticated, authReady, user } = useAuthStore();

  const [state, setState] = useState(token ? 'loading' : 'invalid');
  const [invite, setInvite] = useState(null);
  const [message, setMessage] = useState(
    token ? '' : 'This link is missing its invitation code.'
  );

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await organizationAPI.previewInvitation(token);
        if (cancelled) return;
        setInvite(res?.data?.data || null);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setMessage(
          err?.response?.data?.message
            || 'This invitation link is not valid or has expired. Ask whoever invited you to send a new one.'
        );
        setState('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Carry the token into signup. The register + Google endpoints already know
  // how to consume it; nothing had ever handed them one.
  const goToSignup = () => navigate(`/login?mode=register&invite=${encodeURIComponent(token)}`);
  const goToSignIn = () => navigate(`/login?invite=${encodeURIComponent(token)}`);

  const invitedToADifferentAccount =
    isAuthenticated
    && invite
    && user?.email
    && user.email.toLowerCase() !== String(invite.email).toLowerCase();

  return (
    <div className="min-h-screen bg-bg-secondary">
      <header className="border-b border-hairline bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="text-sm text-content-secondary hover:text-content-primary transition-colors duration-150 ease-out rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Home
          </Link>
          <AcurealWordmark className="text-[14px]" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <section className="bg-white rounded-sm border border-hairline shadow-sm p-8">
          {state === 'loading' && (
            <div className="flex flex-col items-center text-center">
              <Loader2 className="text-content-muted animate-spin motion-reduce:animate-none" size={36} />
              <h1 className="font-serif text-xl font-semibold text-content-primary mt-4">
                Checking your invitation
              </h1>
              <p className="text-sm text-content-secondary mt-2">One moment.</p>
            </div>
          )}

          {state === 'invalid' && (
            <div className="flex flex-col items-center text-center">
              <AlertTriangle className="text-data-negative" size={36} />
              <h1 className="font-serif text-xl font-semibold text-content-primary mt-4">
                This invitation can&apos;t be opened
              </h1>
              <p className="text-sm text-content-secondary mt-2 max-w-md">{message}</p>
              <Link
                to="/login"
                className="mt-6 inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#c2410c] text-white text-sm font-medium hover:bg-[#9a3412] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
              >
                Go to sign in
              </Link>
            </div>
          )}

          {state === 'ready' && invite && (
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-bg-secondary border border-hairline flex items-center justify-center">
                <Building2 className="text-content-secondary" size={20} aria-hidden="true" />
              </div>
              <h1 className="font-serif text-xl font-semibold text-content-primary mt-4">
                Join {invite.organizationName}
              </h1>
              <p className="text-sm text-content-secondary mt-2 max-w-md">
                <span className="font-medium text-content-primary">
                  {invite.invitedByName || invite.invitedByEmail || 'A colleague'}
                </span>
                {invite.invitedByName && invite.invitedByEmail && (
                  <span className="text-content-muted"> ({invite.invitedByEmail})</span>
                )}
                {' '}invited <span className="font-medium text-content-primary">{invite.email}</span>
                {' '}to collaborate on {invite.organizationName}
                {ROLE_COPY[invite.role] ? `, ${ROLE_COPY[invite.role]}` : ''}.
              </p>

              {invitedToADifferentAccount && (
                <ErrorState tone="warn" className="mt-5 text-left">
                  You&apos;re signed in as <strong>{user.email}</strong>, but this
                  invitation was sent to <strong>{invite.email}</strong>. Sign out
                  first, then open this link again.
                </ErrorState>
              )}

              <div className="mt-6 flex flex-col sm:flex-row gap-2">
                {invite.hasAccount ? (
                  <Button variant="primary" onClick={goToSignIn} disabled={!authReady}>
                    <UserPlus size={14} />
                    Sign in to join
                  </Button>
                ) : (
                  <Button variant="primary" onClick={goToSignup} disabled={!authReady}>
                    <UserPlus size={14} />
                    Create account &amp; join
                  </Button>
                )}
              </div>

              <p className="text-xs text-content-muted mt-6 max-w-md">
                If you weren&apos;t expecting this invitation, you can close this page —
                no access is granted until you accept.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
