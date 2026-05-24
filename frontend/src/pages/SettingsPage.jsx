import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, Shield, Lock, Palette, Save, Loader2, Brain, KeyRound } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { isPlatformAdmin } from '../utils/permissions';
import PageHeader from '../components/common/PageHeader';
import { toast } from '../components/common/Toast';
import { authAPI } from '../services/api';
import { useMarketNotes, useSaveMarketNotes } from '../hooks/useIntelligence';
import AIUsageWidget from '../components/admin/AIUsageWidget';
import AIHealthWidget from '../components/admin/AIHealthWidget'; // PR-NX23
import CloseAccountCard from '../components/common/CloseAccountCard';
import MfaCard from '../components/common/MfaCard';
import OrgBenchmarkCard from '../components/common/OrgBenchmarkCard';
import ProductTourReplayCard from '../components/onboarding/ProductTourReplayCard';

const CURRENCY_OPTIONS = [
  { value: 'crores', label: 'Crores (Cr)' },
  { value: 'lakhs', label: 'Lakhs (L)' },
  { value: 'millions', label: 'Millions (M)' },
];

// The multi-currency display feature (USD/AED/EUR/GBP/JPY/SGD conversion
// at render time) was retired 2026-05-24 — REDIP is India-only and the
// extra control added friction without earning it.

const AREA_UNIT_OPTIONS = [
  { value: 'sqft', label: 'Square Feet (sqft)' },
  { value: 'sqm', label: 'Square Metres (sqm)' },
  { value: 'acres', label: 'Acres' },
];

const DATE_FORMAT_OPTIONS = [
  { value: 'en-IN', label: 'DD/MM/YYYY (Indian)' },
  { value: 'en-US', label: 'MM/DD/YYYY (US)' },
  { value: 'en-GB', label: 'DD/MM/YYYY (UK)' },
  { value: 'iso', label: 'YYYY-MM-DD (ISO)' },
];

export default function SettingsPage() {
  const { user, updateProfile, sessionPersistence } = useAuthStore();

  // OAuth-only users (signed up via Google, never picked a password) get a
  // distinct Settings card: "Set a password" instead of "Change password".
  // The flag defaults to true on the backend column for every legacy user,
  // so this branch only fires for accounts created through Google sign-in.
  const passwordIsUnset = user?.password_set === false;

  // Profile form
  const [profile, setProfile] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Security form
  const [security, setSecurity] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [changingPassword, setChangingPassword] = useState(false);

  // Set-first-password form (only used when passwordIsUnset === true).
  const [firstPwd, setFirstPwd] = useState({ newPassword: '', confirmPassword: '' });
  const [settingFirstPassword, setSettingFirstPassword] = useState(false);

  // Preferences (localStorage only)
  const [preferences, setPreferences] = useState({
    currency: localStorage.getItem('pref_currency') || 'crores',
    areaUnit: localStorage.getItem('pref_areaUnit') || 'sqft',
    dateFormat: localStorage.getItem('pref_dateFormat') || 'en-IN',
  });

  // Market notes (admin only). Only `micro_market` is editable now —
  // PR #530 retired the Slowdown + Strategic note types along with their
  // on-page sections; the backend still ignores reads/writes for those
  // sections, so leaving them in the Settings editor would just let the
  // operator type into a void.
  const { data: marketNotes } = useMarketNotes();
  const saveMarketNotes = useSaveMarketNotes();
  const [notesDraft, setNotesDraft] = useState({
    micro_market: '',
  });

  useEffect(() => {
    if (marketNotes) {
      setNotesDraft({
        micro_market: (marketNotes.micro_market || []).join('\n'),
      });
    }
  }, [marketNotes]);

  const handleNotesSave = async (section) => {
    const items = notesDraft[section]
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await saveMarketNotes.mutateAsync({ section, items });
      toast.success('Notes saved — refresh the Intelligence page to see them.');
    } catch {
      toast.error('Failed to save notes');
    }
  };

  useEffect(() => {
    if (user) {
      setProfile({
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
      });
    }
  }, [user]);

  const handleProfileSave = async (e) => {
    e.preventDefault();
    if (!profile.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSavingProfile(true);
    const success = await updateProfile({
      name: profile.name.trim(),
      phone: profile.phone.trim() || undefined,
    });
    setSavingProfile(false);
    if (success) {
      toast.success('Profile updated');
    } else {
      toast.error('Failed to update profile');
    }
  };

  const handleSetFirstPassword = async (e) => {
    e.preventDefault();
    if (firstPwd.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(firstPwd.newPassword)) {
      toast.error('Password must include uppercase, lowercase, and a number');
      return;
    }
    if (firstPwd.newPassword !== firstPwd.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSettingFirstPassword(true);
    try {
      const { data } = await authAPI.setFirstPassword({ newPassword: firstPwd.newPassword });
      // Refresh the user object so password_set flips to true and the UI
      // collapses the "Set a password" card on the next render.
      const updated = data?.data || null;
      if (updated) {
        useAuthStore.setState((state) => ({ ...state, user: updated }));
        // Persist alongside the token so a refresh keeps the flag.
        if (localStorage.getItem('token')) {
          localStorage.setItem('user', JSON.stringify(updated));
        } else if (sessionStorage.getItem('token')) {
          sessionStorage.setItem('user', JSON.stringify(updated));
        }
      }
      toast.success('Password set. You can now sign in with email and password too.');
      setFirstPwd({ newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to set password');
    } finally {
      setSettingFirstPassword(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!security.currentPassword) {
      toast.error('Current password is required');
      return;
    }
    if (security.newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(security.newPassword)) {
      toast.error('New password must include uppercase, lowercase, and a number');
      return;
    }
    if (security.newPassword !== security.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await authAPI.updateMe({
        currentPassword: security.currentPassword,
        newPassword: security.newPassword,
      });
      toast.success('Password changed');
      setSecurity({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const handlePreferenceChange = (key, value) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    localStorage.setItem(`pref_${key}`, value);
    toast.success('Preference saved');
  };

  // One-shot cleanup: clear any localStorage keys left over from the
  // retired multi-currency feature so we don't carry orphan rows
  // forever. Idempotent — fires once per browser then no-ops.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('pref_currencyCode')) localStorage.removeItem('pref_currencyCode');
    if (localStorage.getItem('pref_fx_rate')) localStorage.removeItem('pref_fx_rate');
  }, []);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage your profile, security, and preferences"
      />

      {/* Profile Section */}
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
        <h3 className="text-base font-semibold text-content-primary mb-4 flex items-center gap-2">
          <User size={18} />
          Profile
        </h3>
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">Full Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">Email</label>
            <input
              type="email"
              value={profile.email}
              readOnly
              className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm bg-bg-secondary text-content-secondary cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">Phone</label>
            <input
              type="tel"
              value={profile.phone}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              placeholder="9876543210"
              className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button
            type="submit"
            disabled={savingProfile}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
          >
            {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Profile
          </button>
        </form>
      </div>

      {/* Security Section */}
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
        <h3 className="text-base font-semibold text-content-primary mb-4 flex items-center gap-2">
          <Lock size={18} />
          Security
        </h3>
        <div className="mb-4 rounded-lg border border-hairline-strong bg-bg-secondary px-4 py-3">
          <p className="text-sm font-medium text-content-primary">Current session behavior</p>
          <p className="mt-1 text-xs text-content-secondary">
            {sessionPersistence === 'persistent'
              ? 'Remember me is enabled for this browser. REDIP will keep this session across browser restarts until you sign out.'
              : 'This is a browser-session login. REDIP will sign you out when the browser closes unless you choose Remember me at sign-in.'}
          </p>
        </div>

        {passwordIsUnset ? (
          // OAuth-only flow: account has never had a real password. Surface a
          // "Set a password" card explaining the lockout risk (Google
          // revokes / user deletes Google account → no fallback) and let
          // them attach a password without an operator-support hand-off.
          <>
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
              <KeyRound size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="text-sm text-amber-900 leading-relaxed">
                <p className="font-medium">Your account currently signs in with Google only.</p>
                <p className="mt-1 text-xs text-amber-800">
                  Setting a password adds a fallback so you can sign in with
                  email and password if your Google account ever becomes
                  unavailable. You can keep using Google sign-in either way.
                </p>
              </div>
            </div>
            <form onSubmit={handleSetFirstPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-content-secondary mb-1">New Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={firstPwd.newPassword}
                  onChange={(e) => setFirstPwd((s) => ({ ...s, newPassword: e.target.value }))}
                  placeholder="At least 8 chars with uppercase, lowercase, and a number"
                  className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-content-secondary mb-1">Confirm New Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={firstPwd.confirmPassword}
                  onChange={(e) => setFirstPwd((s) => ({ ...s, confirmPassword: e.target.value }))}
                  className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <button
                type="submit"
                disabled={settingFirstPassword}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
              >
                {settingFirstPassword ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                Set Password
              </button>
            </form>
          </>
        ) : (
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Current Password</label>
              <input
                type="password"
                value={security.currentPassword}
                onChange={(e) => setSecurity((s) => ({ ...s, currentPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">New Password</label>
              <input
                type="password"
                value={security.newPassword}
                onChange={(e) => setSecurity((s) => ({ ...s, newPassword: e.target.value }))}
                placeholder="At least 8 chars with uppercase, lowercase, and a number"
                className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Confirm New Password</label>
              <input
                type="password"
                value={security.confirmPassword}
                onChange={(e) => setSecurity((s) => ({ ...s, confirmPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              type="submit"
              disabled={changingPassword}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              {changingPassword ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              Change Password
            </button>
          </form>
        )}
      </div>

      {/* Privacy & data — DPDP rights: see / download data, manage consent.
          Links to the dedicated Privacy Centre (PrivacyCentrePage). */}
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
        <h3 className="text-base font-semibold text-content-primary mb-1 flex items-center gap-2">
          <Shield size={18} />
          Privacy & your data
        </h3>
        <p className="text-xs text-content-secondary mb-4 max-w-2xl">
          See exactly what personal data REDIP holds about you, download a copy, manage
          your consent choices for each purpose, and exercise your rights under the
          Digital Personal Data Protection Act, 2023.
        </p>
        <Link
          to="/dashboard/privacy"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
        >
          <Shield size={14} />
          Open Privacy Centre
        </Link>
      </div>

      {/* Preferences Section */}
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
        <h3 className="text-base font-semibold text-content-primary mb-4 flex items-center gap-2">
          <Palette size={18} />
          Preferences
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">Number Format</label>
            <select
              value={preferences.currency}
              onChange={(e) => handlePreferenceChange('currency', e.target.value)}
              className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">Area Unit</label>
            <select
              value={preferences.areaUnit}
              onChange={(e) => handlePreferenceChange('areaUnit', e.target.value)}
              className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {AREA_UNIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">Date Format</label>
            <select
              value={preferences.dateFormat}
              onChange={(e) => handlePreferenceChange('dateFormat', e.target.value)}
              className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {DATE_FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* AI provider health + usage are cross-org platform operations data
          (cost across every workspace, provider availability) — not something
          every workspace owner needs. Gated to the REDIP platform admin via
          isPlatformAdmin, NOT workspace role (every account is admin of its
          own workspace, which would expose these to everyone). */}
      {isPlatformAdmin(user) && (
        <>
          <AIHealthWidget />
          <AIUsageWidget />
        </>
      )}

      {/* Market Intelligence Notes are platform-curated — they appear in the
          shared brief and are labelled "admin-entered" — so only the REDIP
          platform admin should be editing them. */}
      {isPlatformAdmin(user) && (
        <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
          <h3 className="text-base font-semibold text-content-primary mb-1 flex items-center gap-2">
            <Brain size={18} />
            Market Intelligence Notes
          </h3>
          <p className="text-xs text-content-secondary mb-4">
            Enter your own verified market observations — sourced from broker calls, reports, or site visits.
            Each line becomes one bullet in the Intelligence brief. These are labelled as admin-entered and never
            fabricated by REDIP.
          </p>

          {[
            { key: 'micro_market', label: 'Bengaluru Micro-Market Intelligence', placeholder: 'e.g. Whitefield absorption tightening due to new IT campus demand\ne.g. ORR rental yields compressing on oversupply' },
            // Demand Slowdown Indicators + Strategic Takeaways retired
            // 2026-05-23 (PR #530) — the corresponding on-page sections
            // produced generic copy that didn't earn their place. The
            // backend `saveMarketNotes` now rejects those section keys
            // outright, so leaving them in this editor would just be a
            // void to type into.
          ].map(({ key, label, placeholder }) => (
            <div key={key} className="mb-5 last:mb-0">
              <label className="block text-sm font-medium text-content-secondary mb-1">{label}</label>
              <textarea
                rows={4}
                value={notesDraft[key]}
                onChange={(e) => setNotesDraft((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y font-mono"
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-content-muted">One observation per line.</p>
                <button
                  onClick={() => handleNotesSave(key)}
                  disabled={saveMarketNotes.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-medium transition disabled:opacity-50"
                >
                  {saveMarketNotes.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Org benchmark contribution — Workstream C2. Same owner/admin gate
          as the Market Intelligence Notes card above. */}
      {(user?.role === 'owner' || user?.role === 'admin') && <OrgBenchmarkCard />}

      {/* Replay the welcome / product tour. Lives here because the welcome
          modal explicitly tells users they can come back to Settings to
          run it again. */}
      <ProductTourReplayCard />

      {/* Two-factor authentication (TOTP via authenticator app). */}
      <MfaCard />

      {/* Account closure (DPDP §8(7)) — every authenticated user can
          self-serve. Erasure scheduled +90 days, runs via the daily
          retention sweep cron. */}
      <CloseAccountCard />
    </div>
  );
}
