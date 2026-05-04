import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn, UserPlus, Mail, Lock, User, Phone, Eye, EyeOff } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { useLegalActive } from '../hooks/useLegalActive';
import usePublicLightTheme from '../hooks/usePublicLightTheme';
import Checkbox from '../design-system/Checkbox';
import PublicFooter from '../components/common/PublicFooter';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';

export default function LoginPage() {
  usePublicLightTheme();
  const navigate = useNavigate();
  const { login, register, googleSignIn, completeMfaLogin, loading, error, clearError } = useAuthStore();
  const { data: legalDocs, loading: legalLoading, error: legalError } = useLegalActive();

  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
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

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="font-serif text-4xl font-semibold text-stone-900 tracking-tight">
            REDIP<span className="text-[#c2410c]">.</span>
          </h1>
          <p className="text-stone-500 mt-2 text-[11px] uppercase tracking-[0.18em]">Real Estate Deal Intelligence · India</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-sm border border-stone-200 shadow-sm p-8">
          <h2 className="font-serif text-2xl font-semibold text-stone-900 leading-tight mb-1">
            {isRegister ? 'Create an account' : 'Welcome back'}
          </h2>
          <p className="text-sm text-stone-600 mb-6">
            {isRegister
              ? 'Create a deal workspace account for sourcing, diligence, and underwriting'
              : 'Sign in to your REDIP deal intelligence workspace'}
          </p>

          {/* Server error */}
          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-sm text-sm text-rose-800">
              {error}
            </div>
          )}

          {/* Google sign-in. Hidden during MFA challenge step — user is
              committed to a specific account at that point. */}
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
            </div>
          )}

          {mfa ? (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-stone-700 mb-2 font-medium">
                  Two-factor code
                </label>
                <p className="text-xs text-stone-500 mb-3">
                  Enter the 6-digit code from your authenticator app, or a recovery code if you've lost your device.
                </p>
                <input
                  type="text"
                  inputMode="text"
                  autoFocus
                  autoComplete="one-time-code"
                  maxLength={20}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="123456"
                  className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-base font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[#c2410c]/30"
                />
              </div>
              {error && (
                <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleMfaCancel}
                  className="btn btn-secondary flex-1"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || mfaCode.length < 6}
                  className="btn btn-primary flex-1"
                >
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name (register only) */}
            {isRegister && (
              <div>
                <label htmlFor="name" className="block text-[11px] uppercase tracking-[0.14em] text-stone-600 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
                  <input
                    id="name"
                    name="name"
                    type="text"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="John Doe"
                    className={`w-full pl-10 pr-3 py-2 border rounded-sm text-sm bg-white focus:outline-none focus:border-[#c2410c] focus:ring-0 ${validationErrors.name ? 'border-rose-400' : 'border-stone-300'}`}
                  />
                </div>
                {validationErrors.name && (
                  <p className="text-xs text-rose-700 mt-1">{validationErrors.name}</p>
                )}
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-[11px] uppercase tracking-[0.14em] text-stone-600 mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="you@company.com"
                  className={`w-full pl-10 pr-3 py-2 border rounded-sm text-sm bg-white focus:outline-none focus:border-[#c2410c] focus:ring-0 ${validationErrors.email ? 'border-rose-400' : 'border-stone-300'}`}
                />
              </div>
              {validationErrors.email && (
                <p className="text-xs text-rose-700 mt-1">{validationErrors.email}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-[11px] uppercase tracking-[0.14em] text-stone-600 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  className={`w-full pl-10 pr-10 py-2 border rounded-sm text-sm bg-white focus:outline-none focus:border-[#c2410c] focus:ring-0 ${validationErrors.password ? 'border-rose-400' : 'border-stone-300'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {validationErrors.password && (
                <p className="text-xs text-rose-700 mt-1">{validationErrors.password}</p>
              )}
            </div>

            {/* Phone (register only) */}
            {isRegister && (
              <div>
                <label htmlFor="phone" className="block text-[11px] uppercase tracking-[0.14em] text-stone-600 mb-1">
                  Phone <span className="text-content-muted font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="9876543210"
                    className={`w-full pl-10 pr-3 py-2 border rounded-sm text-sm bg-white focus:outline-none focus:border-[#c2410c] focus:ring-0 ${validationErrors.phone ? 'border-rose-400' : 'border-stone-300'}`}
                  />
                </div>
                {validationErrors.phone && (
                  <p className="text-xs text-rose-700 mt-1">{validationErrors.phone}</p>
                )}
              </div>
            )}

            <div className="rounded-lg border border-hairline-strong bg-bg-secondary px-3 py-3">
              <div className="flex items-center gap-2">
                <input
                  id="rememberMe"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded-sm border-stone-300 text-[#c2410c] focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <label htmlFor="rememberMe" className="text-sm text-stone-700 cursor-pointer select-none">
                  Remember me across browser restarts
                </label>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Default session behavior is privacy-first: if this stays unchecked, REDIP signs you
                out when the browser closes.
              </p>
            </div>

            {/* Required acceptance — register only */}
            {isRegister && (
              <div
                className={`rounded-lg border px-3 py-3 ${
                  validationErrors.acceptTerms
                    ? 'border-rose-300 bg-rose-50'
                    : 'border-hairline-strong bg-bg-secondary'
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
                  <span className="text-sm text-stone-700 leading-snug">
                    I have read and agree to the{' '}
                    <Link
                      to="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#c2410c] hover:text-[#9a3412] underline underline-offset-2"
                    >
                      Terms &amp; Conditions
                    </Link>{' '}
                    and{' '}
                    <Link
                      to="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#c2410c] hover:text-[#9a3412] underline underline-offset-2"
                    >
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </Checkbox>
                {validationErrors.acceptTerms && (
                  <p className="text-xs text-rose-700 mt-2">{validationErrors.acceptTerms}</p>
                )}
                {validationErrors.legal && (
                  <p className="text-xs text-rose-700 mt-2">{validationErrors.legal}</p>
                )}
                {legalError && (
                  <p className="text-xs text-rose-700 mt-2">
                    Could not load the current Terms and Privacy versions. Please refresh the page
                    or contact{' '}
                    <a href="mailto:grievance@redip.in" className="underline">
                      grievance@redip.in
                    </a>
                    .
                  </p>
                )}
                {legalLoading && !legalError && (
                  <p className="mt-2 text-xs text-stone-500">Loading current versions…</p>
                )}
                {!legalLoading && !legalError && legalDocs?.terms_of_service && (
                  <p className="mt-2 text-xs text-stone-500">
                    Acceptance is recorded with timestamp, IP, and browser for audit (DPDP Act
                    2023 §6). Current versions:{' '}
                    <span className="font-mono">
                      Terms {legalDocs.terms_of_service.version}
                    </span>
                    ,{' '}
                    <span className="font-mono">
                      Privacy {legalDocs.privacy_policy?.version || '—'}
                    </span>
                    .
                  </p>
                )}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitDisabled}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#c2410c] hover:brightness-95 text-white rounded-sm text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : isRegister ? (
                <UserPlus size={16} />
              ) : (
                <LogIn size={16} />
              )}
              {loading
                ? isRegister
                  ? 'Creating account...'
                  : 'Signing in...'
                : isRegister
                  ? 'Create Account'
                  : 'Sign In'}
            </button>
          </form>
          )}

          {/* Toggle */}
          <p className="text-center text-sm text-stone-600 mt-6">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="text-[#c2410c] hover:text-[#9a3412] font-medium underline underline-offset-2"
            >
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
