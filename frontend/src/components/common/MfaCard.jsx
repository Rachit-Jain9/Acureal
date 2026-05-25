import { useState } from 'react';
import { ShieldCheck, KeyRound, Loader2, AlertTriangle, CheckCircle2, Copy } from 'lucide-react';
import { authAPI } from '../../services/api';
import useAuthStore from '../../store/authStore';
import { toast } from './Toast';
import { confirm } from '../../design-system';

// Two-factor authentication enrollment + management card.
//
// Three states:
//   1. user.mfa_enrolled === false  → "Enable two-factor" button (idle)
//   2. enrollment in progress       → QR + recovery codes + verify input
//   3. user.mfa_enrolled === true   → "Disable two-factor" button + status

export default function MfaCard() {
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const enrolled = Boolean(user?.mfa_enrolled);

  const [enrollmentData, setEnrollmentData] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const handleBegin = async () => {
    setBusy(true);
    try {
      const res = await authAPI.mfaBegin();
      setEnrollmentData(res.data?.data || null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not start MFA enrollment.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!enrollmentData || code.length < 6) return;
    setBusy(true);
    try {
      await authAPI.mfaVerifyEnrollment(code);
      toast.success('Two-factor authentication enabled.');
      setEnrollmentData(null);
      setCode('');
      if (typeof refreshUser === 'function') await refreshUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    const ok = await confirm({
      title: 'Disable two-factor authentication?',
      message: 'Your account will only require a password to sign in.',
      tone: 'danger',
      confirmLabel: 'Disable',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await authAPI.mfaDisable();
      toast.success('Two-factor authentication disabled.');
      if (typeof refreshUser === 'function') await refreshUser();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not disable MFA.');
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    if (!enrollmentData?.recoveryCodes) return;
    const text = enrollmentData.recoveryCodes.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Recovery codes copied. Store them somewhere safe.');
    } catch {
      toast.error('Could not copy. Select and copy manually.');
    }
  };

  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
      <h3 className="text-base font-semibold text-content-primary mb-1 flex items-center gap-2">
        <ShieldCheck size={18} />
        Two-Factor Authentication
        {enrolled && <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 ml-2">Enabled</span>}
      </h3>
      <p className="text-xs text-content-secondary mb-4 max-w-2xl">
        Add a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password) on every sign-in.
        Significantly reduces account-takeover risk if your password is ever leaked.
      </p>

      {/* Idle (not enrolled, no enrollment in progress) */}
      {!enrolled && !enrollmentData && (
        <button
          type="button"
          onClick={handleBegin}
          disabled={busy}
          className="btn btn-primary text-sm flex items-center gap-1.5"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {busy ? 'Preparing…' : 'Enable two-factor'}
        </button>
      )}

      {/* Enrollment in progress */}
      {enrollmentData && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4 items-start">
            <div className="flex items-center justify-center bg-bg-secondary border border-hairline rounded-lg p-3">
              <img src={enrollmentData.qrDataUrl} alt="MFA QR" className="w-36 h-36" />
            </div>
            <div className="space-y-3 text-sm">
              <p className="text-content-secondary">
                <strong className="text-content-primary">1.</strong> Open your authenticator app and scan the QR code.
              </p>
              <p className="text-content-secondary">
                <strong className="text-content-primary">2.</strong> Save these one-time recovery codes — each works once if you lose your device:
              </p>
              <div className="bg-bg-secondary border border-hairline rounded-lg p-3 font-mono text-xs grid grid-cols-2 gap-1 tabular-nums">
                {enrollmentData.recoveryCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <button type="button" onClick={copyCodes} className="text-xs text-content-secondary hover:text-content-primary inline-flex items-center gap-1">
                <Copy size={12} /> Copy recovery codes
              </button>
              <p className="text-content-secondary pt-2 border-t border-hairline">
                <strong className="text-content-primary">3.</strong> Enter the 6-digit code from your app to confirm:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  autoFocus
                  className="px-3 py-2 border border-hairline-strong rounded-lg text-sm font-mono w-32 text-center focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={busy || code.length !== 6}
                  className="btn btn-primary text-sm flex items-center gap-1.5"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Verify & enable
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>Save the recovery codes <strong>now</strong> — they're only shown once. Without them, a lost authenticator means contacting support.</span>
          </div>
        </div>
      )}

      {/* Enrolled */}
      {enrolled && !enrollmentData && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDisable}
            disabled={busy}
            className="text-sm font-medium text-rose-700 hover:text-rose-900 border border-rose-300 hover:border-rose-500 rounded-lg px-4 py-2 transition-colors flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Disable two-factor
          </button>
        </div>
      )}
    </div>
  );
}
