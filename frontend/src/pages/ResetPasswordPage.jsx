// Public reset-password landing page. Lifts the one-shot `token` query param
// from the link in the reset email, collects a new password, and posts both to
// /api/auth/reset-password. On success the server has also signed the account
// out everywhere; the user continues to the sign-in form (no auto-login — a
// public route must not mint session cookies past MFA). Structure mirrors
// pages/legal/VerifyEmailPage.jsx.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { authAPI } from '../services/api';
import usePublicLightTheme from '../hooks/usePublicLightTheme';
import { Button, Field, Input, ErrorState } from '../design-system';
import { AcurealWordmark } from '../components/brand/AcurealBrand';

// Same policy the server enforces (and the register form advertises).
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

export default function ResetPasswordPage() {
  usePublicLightTheme();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const validate = () => {
    const errors = {};
    if (password.length < 8) {
      errors.password = 'At least 8 characters.';
    } else if (!PASSWORD_PATTERN.test(password)) {
      errors.password = 'Must include an uppercase letter, a lowercase letter, and a number.';
    }
    if (confirm !== password) {
      errors.confirm = 'Passwords do not match.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setError('');
    setLoading(true);
    try {
      await authAPI.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'This reset link is invalid or has expired. Request a fresh one and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const showHideButton = (
    <button
      type="button"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      className="p-1 rounded text-content-muted transition-colors hover:text-content-primary
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  );

  return (
    <div className="min-h-screen bg-bg-secondary">
      <header className="border-b border-hairline bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm text-content-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded px-2 py-1"
          >
            Sign in
          </Link>
          <AcurealWordmark className="text-[14px]" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <section className="bg-white rounded-sm border border-hairline shadow-sm p-8">
          {!token && (
            <div className="flex flex-col items-center text-center">
              <AlertTriangle className="text-data-negative" size={36} />
              <h1 className="font-serif text-xl font-semibold text-content-primary mt-4">
                Link incomplete
              </h1>
              <p className="text-sm text-content-secondary mt-2 max-w-md">
                No reset token was provided in the link. Use the button from the
                email, or request a fresh link.
              </p>
              <Link
                to="/forgot-password"
                className="mt-6 inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#c2410c] text-white text-sm font-medium hover:bg-[#9a3412] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
              >
                Request a new link
              </Link>
            </div>
          )}

          {token && done && (
            <div className="flex flex-col items-center text-center">
              <CheckCircle2 className="text-data-positive" size={36} />
              <h1 className="font-serif text-xl font-semibold text-content-primary mt-4">
                Password reset
              </h1>
              <p className="text-sm text-content-secondary mt-2 max-w-sm">
                Your new password is set, and for your security every device has
                been signed out. Sign in again with the new password.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#c2410c] text-white text-sm font-medium hover:bg-[#9a3412] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
              >
                Continue to sign in
              </Link>
            </div>
          )}

          {token && !done && (
            <>
              <h1 className="font-serif text-xl font-semibold text-content-primary">
                Choose a new password
              </h1>
              <p className="text-sm text-content-secondary mt-2 mb-6">
                At least 8 characters, with an uppercase letter, a lowercase
                letter, and a number.
              </p>

              {error && (
                <ErrorState tone="danger" className="mb-4">
                  {error}{' '}
                  <Link
                    to="/forgot-password"
                    className="underline underline-offset-2 transition-opacity hover:opacity-80 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    Request a new link
                  </Link>
                </ErrorState>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="New password" error={fieldErrors.password}>
                  <Input
                    name="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter a new password"
                    autoComplete="new-password"
                    autoFocus
                    trailing={showHideButton}
                  />
                </Field>
                <Field label="Confirm new password" error={fieldErrors.confirm}>
                  <Input
                    name="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Type it again"
                    autoComplete="new-password"
                  />
                </Field>
                <Button type="submit" variant="primary" fullWidth loading={loading}>
                  Set new password
                </Button>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
