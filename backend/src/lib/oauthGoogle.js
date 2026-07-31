'use strict';

/**
 * Google OAuth — server-side ID-token verification.
 *
 * The frontend uses Google Identity Services (GIS) to obtain an ID token in
 * the user's browser. That token is posted to /api/auth/google. The backend
 * MUST verify the token before trusting any claim — the JWT signature, the
 * audience (our client_id), and the issuer (accounts.google.com).
 *
 * google-auth-library handles JWKS fetching + caching automatically; we do
 * not pin keys. The library also rejects expired tokens, wrong audiences,
 * and wrong issuers without us having to re-implement those checks.
 *
 * Operator setup (manual blocker, recorded in TODO_MANUAL.md):
 *   1. Google Cloud Console → APIs & Services → Credentials.
 *   2. Create an OAuth 2.0 Client ID (type: Web application).
 *   3. Authorized JavaScript origins:
 *        - https://acureal.in
 *        - http://localhost:5173 (dev)
 *   4. Authorized redirect URIs: not used (we use ID token mode, not
 *      authorization-code mode — frontend never redirects to Google's
 *      callback URL).
 *   5. Set Vercel env: GOOGLE_OAUTH_CLIENT_ID = "<id>.apps.googleusercontent.com".
 *      Set the same on the frontend via VITE_GOOGLE_OAUTH_CLIENT_ID.
 *
 * The GOOGLE_OAUTH_CLIENT_ID env var is the FEATURE FLAG. If unset, the
 * frontend hides the Sign in with Google button and the backend route
 * returns 503. Shipping this PR does not require operator action; the
 * feature stays dark until both env vars are present.
 */

const { OAuth2Client } = require('google-auth-library');
const { createError } = require('../middleware/errorHandler');

let cachedClient = null;

const getClientId = () => {
  const id = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  return id || null;
};

const isConfigured = () => Boolean(getClientId());

const getClient = () => {
  if (!cachedClient) {
    const id = getClientId();
    if (!id) return null;
    cachedClient = new OAuth2Client(id);
  }
  return cachedClient;
};

/**
 * Verify a Google ID token. Returns the trusted claims subset we use:
 *   - sub          stable Google user id (the "subject")
 *   - email        the user's primary email at this Google account
 *   - email_verified — Google's assertion the email is verified by them
 *   - name         display name (may be missing for some accounts)
 *   - picture      avatar URL (may be missing)
 *   - hd           hosted-domain (Google Workspace tenant), null otherwise
 *
 * Throws 503 if the feature is not configured. Throws 401 on any verification
 * failure (signature, audience, expiry, issuer). Errors deliberately do not
 * leak which check failed.
 */
const verifyIdToken = async (idToken) => {
  if (!idToken || typeof idToken !== 'string' || idToken.length < 20) {
    throw createError('Invalid Google sign-in token.', 401);
  }
  const client = getClient();
  if (!client) {
    throw createError('Google sign-in is not configured for this deployment.', 503);
  }

  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: getClientId(),
    });
  } catch {
    throw createError('Invalid Google sign-in token.', 401);
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw createError('Invalid Google sign-in token.', 401);
  }
  // Defense in depth: google-auth-library checks issuer + audience already,
  // but assert again so a misconfiguration cannot quietly downgrade us.
  if (
    payload.iss !== 'https://accounts.google.com' &&
    payload.iss !== 'accounts.google.com'
  ) {
    throw createError('Invalid Google sign-in token.', 401);
  }
  if (payload.aud !== getClientId()) {
    throw createError('Invalid Google sign-in token.', 401);
  }

  return {
    provider: 'google',
    subject: payload.sub,
    email: payload.email ? String(payload.email).toLowerCase() : null,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name || null,
    picture: payload.picture || null,
    hostedDomain: payload.hd || null,
  };
};

module.exports = {
  isConfigured,
  getClientId,
  verifyIdToken,
};
