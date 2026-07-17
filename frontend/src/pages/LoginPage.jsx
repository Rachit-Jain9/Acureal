import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { LogIn, UserPlus, Eye, EyeOff } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { useLegalActive } from '../hooks/useLegalActive';
import usePublicLightTheme from '../hooks/usePublicLightTheme';
import { Button, Field, Input, Checkbox, ErrorState } from '../design-system';
import PublicFooter from '../components/common/PublicFooter';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';

export default function LoginPage() {
  usePublicLightTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, register, googleSignIn, completeMfaLogin, loading, error, clearError } = useAuthStore();
  const { data: legalDocs, loading: legalLoading, error: legalError } = useLegalActive();

  // Deep-link: `/login?mode=register` (or `?register=1`) opens the page
  // directly in the create-account form. The landing-page "Get started"
  // CTA uses this so first-time visitors don't have to find and click
  // the "Don't have an account? Register" toggle.
  const initialRegisterMode =
    searchParams.get('mode') === 'register' || searchParams.get('register') === '1';
  const [isRegister, setIsRegister] = useState(initialRegisterMode);
  const [showPassword, setShowPassword] = useState(false);
  // Defaults ON. This is a B2B work tool signed into daily from trusted
  // machines; the operator's real-world report was "it doesn't remember
  // anyone" — because with the old default-off, one-click Google sign-in
  // (which never touches the checkbox, rendered below the button) silently
  // meant "don't remember me". Unticking remains one click for shared
  // machines, and now genuinely issues a browser-session cookie server-side.
  const [rememberMe, setRememberMe] = useState(true);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
  });
  const [validationErrors, setValidationErrors] = useState({});

  // MFA challenge state — set when /auth/login returns mfaRequired: true.
  // While set, we render the 6-digit-code prompt instead of the password form.
  const [mfa, setMfa] = useState(null); // { challenge, expiresAt, rememberMe }
  const [mfaCode, setMfaCode] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({ ...prev, [name]: null }));
    }
    if (error) clearError();
  };

  const validate = () => {
    const errors = {};

    if (isRegister && !form.name.trim()) {
      errors.name = 'Name is required';
    }

    if (!form.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Enter a valid email';
    }

    if (!form.password) {
      errors.password = 'Password is required';
    } else if (isRegister && form.password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    } else if (isRegister && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password)) {
      errors.password = 'Password must include uppercase, lowercase, and a number';
    }

    if (isRegister && form.phone && !/^\d{10}$/.test(form.phone.replace(/\D/g, ''))) {
      errors.phone = 'Enter a valid 10-digit phone number';
    }

    if (isRegister && !acceptTerms) {
      errors.acceptTerms = 'You must accept the Terms & Conditions and Privacy Policy to create an account.';
    }

    if (isRegister && (!legalDocs?.terms_of_service?.version || !legalDocs?.privacy_policy?.version)) {
      errors.legal =
        'Legal documents are loading or unavailable. Please refresh the page in a moment.';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    let success;
    if (isRegister) {
      success = await register(
        {
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone || undefined,
          acceptedTermsVersion: legalDocs?.terms_of_service?.version,
          acceptedPrivacyVersion: legalDocs?.privacy_policy?.version,
        },
        rememberMe,
      );
    } else {
      success = await login(form.email, form.password, rememberMe);
      // MFA branch — login returned a challenge instead of a session.
      if (success && typeof success === 'object' && success.mfaRequired) {
        setMfa({ challenge: success.challenge, expiresAt: success.expiresAt, rememberMe: success.rememberMe });
        return;
      }
    }

    if (success === true) {
      navigate('/dashboard');
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    if (!mfa || mfaCode.length < 6) return;
    const success = await completeMfaLogin(mfa.challenge, mfaCode, mfa.rememberMe);
    if (success) {
      setMfa(null);
      setMfaCode('');
      navigate('/dashboard');
    }
  };

  const handleMfaCancel = () => {
    setMfa(null);
    setMfaCode('');
    clearError();
  };

  // Google ID token handler. Forwards the token + (on cold signup) the
  // accepted T&C / Privacy versions to the backend; the backend resolves
  // login vs bind vs register from the token claims.
  const handleGoogleCredential = async (idToken) => {
    if (isRegister) {
      // Block if T&C not accepted yet — same gate as the email/password form.
      if (!acceptTerms) {
        setValidationErrors((prev) => ({
          ...prev,
          acceptTerms:
            'You must accept the Terms & Conditions and Privacy Policy to create an account.',
        }));
        return;
      }
      if (!legalDocs?.terms_of_service?.version || !legalDocs?.privacy_policy?.version) {
        setValidationErrors((prev) => ({
          ...prev,
          legal: 'Legal documents are loading or unavailable. Please refresh the page in a moment.',
        }));
        return;
      }
    }
    const success = await googleSignIn(
      {
        idToken,
        acceptedTermsVersion: legalDocs?.terms_of_service?.version,
        acceptedPrivacyVersion: legalDocs?.privacy_policy?.version,
      },
      rememberMe,
    );
    if (success) navigate('/dashboard');
  };

  const toggleMode = () => {
    setIsRegister((prev) => !prev);
    setValidationErrors({});
    clearError();
  };

  const submitDisabled =
    loading || (isRegister && (!acceptTerms || legalLoading || !!legalError));

  const linkClass =
    'text-accent underline underline-offset-2 transition-opacity hover:opacity-80 rounded ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

  return (
    <div className="min-h-screen flex flex-col bg-bg-secondary">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Branding */}
          <div className="text-center mb-8">
            <h1 className="font-serif text-4xl font-semibold text-content-primary tracking-tight">
              REDIP<span className="text-premium">.</span>
            </h1>
            <p className="text-content-muted mt-2 text-[11px] uppercase tracking-[0.18em]">
              Real Estate Deal Intelligence · India
            </p>
          </div>

          {/* Card */}
          <div className="bg-bg-elevated rounded-editorial border border-hairline shadow-editorial p-8">
            <h2 className="font-serif text-2xl font-semibold text-content-primary leading-tight mb-1">
              {isRegister ? 'Create an account' : 'Welcome back'}
            </h2>
            <p className="text-sm text-content-secondary mb-6">
              {isRegister
                ? 'Create a deal workspace account for sourcing, diligence, and underwriting.'
                : 'Sign in to your REDIP deal intelligence workspace.'}
            </p>

            {/* Server error — hidden during the MFA step (that form shows its own) */}
            {error && !mfa && (
              <ErrorState tone="danger" className="mb-4">{error}</ErrorState>
            )}

            {/* Google sign-in. Hidden during MFA challenge — the user is
                already committed to a specific account at that point. */}
            {!mfa && (
              <div className="mb-4">
                <GoogleSignInButton
                  onCredential={handleGoogleCredential}
                  text={isRegister ? 'signup_with' : 'signin_with'}
                  disabled={isRegister && !acceptTerms}
                  disabledReason={
                    isRegister && !acceptTerms
                      ? 'Accept the Terms & Privacy first.'
                      : ''
                  }
                  showDivider
                />
                {/* The remember-me choice governs the GOOGLE path too, so it
                    must be visible next to the button — buried inside the
                    password form below, one-click sign-in never surfaced it
                    and the choice was made silently. */}
                <div className="mt-3">
                  <Checkbox
                    id="rememberMeGoogle"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    label="Keep me signed in on this device"
                  />
                  <p className="mt-1 text-xs text-content-muted">
                    Applies to Google and email sign-in. Untick on a shared
                    machine — REDIP will then sign you out when the browser
                    closes.
                  </p>
                </div>
              </div>
            )}

            {mfa ? (
              <form onSubmit={handleMfaSubmit} className="space-y-4">
                <Field
                  label="Two-factor code"
                  helper="Enter the 6-digit code from your authenticator app, or a recovery code if you've lost your device."
                >
                  <Input
                    type="text"
                    inputMode="text"
                    autoFocus
                    autoComplete="one-time-code"
                    maxLength={20}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="123456"
                    className="text-center font-mono tracking-[0.3em]"
                  />
                </Field>
                {error && <ErrorState tone="danger">{error}</ErrorState>}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    fullWidth
                    onClick={handleMfaCancel}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    fullWidth
                    loading={loading}
                    disabled={mfaCode.length < 6}
                  >
                    Verify
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {isRegister && (
                  <Field label="Full name" error={validationErrors.name}>
                    <Input
                      name="name"
                      type="text"
                      value={form.name}
                      onChange={handleChange}
                      placeholder="John Doe"
                      autoComplete="name"
                    />
                  </Field>
                )}

                <Field label="Email" error={validationErrors.email}>
                  <Input
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="you@company.com"
                    autoComplete="email"
                  />
                </Field>

                <Field label="Password" error={validationErrors.password}>
                  <Input
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={handleChange}
                    placeholder="Enter your password"
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    trailing={(
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="p-1 rounded text-content-muted transition-colors hover:text-content-primary
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    )}
                  />
                </Field>

                {isRegister && (
                  <Field label="Phone" helper="Optional" error={validationErrors.phone}>
                    <Input
                      name="phone"
                      type="tel"
                      value={form.phone}
                      onChange={handleChange}
                      placeholder="9876543210"
                      autoComplete="tel"
                    />
                  </Field>
                )}

                {/* The remember-me choice lives ABOVE, beside the Google
                    button, where it visibly governs every sign-in path —
                    a second copy here would just be two checkboxes bound to
                    one state. */}

                {/* Required acceptance — register only */}
                {isRegister && (
                  <div
                    className={`rounded-md border px-3 py-3 ${
                      validationErrors.acceptTerms
                        ? 'border-data-negative bg-bg-secondary'
                        : 'border-hairline bg-bg-secondary'
                    }`}
                  >
                    <Checkbox
                      id="acceptTerms"
                      checked={acceptTerms}
                      onChange={(e) => {
                        setAcceptTerms(e.target.checked);
                        if (validationErrors.acceptTerms) {
                          setValidationErrors((prev) => ({ ...prev, acceptTerms: null }));
                        }
                      }}
                      tone={validationErrors.acceptTerms ? 'error' : 'default'}
                      required
                    >
                      <span className="text-sm text-content-secondary leading-snug">
                        I have read and agree to the{' '}
                        <Link to="/terms" target="_blank" rel="noopener noreferrer" className={linkClass}>
                          Terms &amp; Conditions
                        </Link>{' '}
                        and{' '}
                        <Link to="/privacy" target="_blank" rel="noopener noreferrer" className={linkClass}>
                          Privacy Policy
                        </Link>
                        .
                      </span>
                    </Checkbox>
                    {validationErrors.acceptTerms && (
                      <p className="text-xs text-data-negative mt-2">{validationErrors.acceptTerms}</p>
                    )}
                    {validationErrors.legal && (
                      <p className="text-xs text-data-negative mt-2">{validationErrors.legal}</p>
                    )}
                    {legalError && (
                      <p className="text-xs text-data-negative mt-2">
                        Could not load the current Terms and Privacy versions. Please refresh the
                        page or contact{' '}
                        <a href="mailto:grievance@redip.in" className={linkClass}>
                          grievance@redip.in
                        </a>
                        .
                      </p>
                    )}
                    {legalLoading && !legalError && (
                      <p className="mt-2 text-xs text-content-muted">Loading current versions…</p>
                    )}
                    {!legalLoading && !legalError && legalDocs?.terms_of_service && (
                      <p className="mt-2 text-xs text-content-muted">
                        Acceptance is recorded with timestamp, IP, and browser for audit (DPDP Act
                        2023 §6). Current versions:{' '}
                        <span className="font-mono">Terms {legalDocs.terms_of_service.version}</span>
                        ,{' '}
                        <span className="font-mono">
                          Privacy {legalDocs.privacy_policy?.version || '—'}
                        </span>
                        .
                      </p>
                    )}
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  loading={loading}
                  disabled={submitDisabled}
                  leftIcon={isRegister ? <UserPlus size={15} /> : <LogIn size={15} />}
                >
                  {isRegister ? 'Create Account' : 'Sign In'}
                </Button>
              </form>
            )}

            {/* Toggle between sign-in and register */}
            <p className="text-center text-sm text-content-secondary mt-6">
              {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button type="button" onClick={toggleMode} className={`font-medium ${linkClass}`}>
                {isRegister ? 'Sign In' : 'Register'}
              </button>
            </p>
          </div>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
