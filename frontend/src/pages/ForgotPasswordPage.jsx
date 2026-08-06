// Public "forgot password" request page. The user enters their email; the
// server ALWAYS answers the same generic 200 (never confirming whether an
// account exists), so this page's success state is deliberately worded as
// "if an account exists…". Structure mirrors pages/legal/VerifyEmailPage.jsx.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { authAPI } from '../services/api';
import usePublicLightTheme from '../hooks/usePublicLightTheme';
import { Button, Field, Input, ErrorState } from '../design-system';
import { AcurealWordmark } from '../components/brand/AcurealBrand';

export default function ForgotPasswordPage() {
  usePublicLightTheme();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter the email address you sign in with.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await authAPI.forgotPassword(trimmed);
      setSent(true);
    } catch (err) {
      // 400 = malformed email; 429 = the shared /api/auth limiter. Neither
      // reveals account existence — the server's contract, mirrored here.
      setError(
        err?.response?.data?.message ||
          'Something went wrong sending the reset link. Please try again in a moment.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-secondary">
      <header className="border-b border-hairline bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/login'))}
            className="inline-flex items-center gap-1.5 text-sm text-content-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded px-2 py-1"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <AcurealWordmark className="text-[14px]" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <section className="bg-white rounded-sm border border-hairline shadow-sm p-8">
          {sent ? (
            <div className="flex flex-col items-center text-center">
              <MailCheck className="text-data-positive" size={36} />
              <h1 className="font-serif text-xl font-semibold text-content-primary mt-4">
                Check your inbox
              </h1>
              <p className="text-sm text-content-secondary mt-2 max-w-sm">
                If an account exists for <span className="font-medium text-content-primary">{email.trim()}</span>,
                a password reset link is on its way. The link works once and
                expires in 60 minutes.
              </p>
              <p className="text-xs text-content-muted mt-4 max-w-sm">
                Nothing arriving? Check spam, or request another link — at most
                five per hour.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#c2410c] text-white text-sm font-medium hover:bg-[#9a3412] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="font-serif text-xl font-semibold text-content-primary">
                Reset your password
              </h1>
              <p className="text-sm text-content-secondary mt-2 mb-6">
                Enter the email you sign in with and we&apos;ll send a link to
                choose a new password.
              </p>

              {error && <ErrorState tone="danger" className="mb-4">{error}</ErrorState>}

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Email">
                  <Input
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    autoFocus
                  />
                </Field>
                <Button type="submit" variant="primary" fullWidth loading={loading}>
                  Send reset link
                </Button>
              </form>

              <p className="text-xs text-content-muted mt-6 text-center">
                Remembered it after all?{' '}
                <Link
                  to="/login"
                  className="text-accent underline underline-offset-2 transition-opacity hover:opacity-80 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Sign in
                </Link>
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
