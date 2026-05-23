import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { User, Shield, Lock, Palette, Save, Loader2, DollarSign, Brain, RefreshCw, CheckCircle, AlertTriangle, KeyRound } from 'lucide-react';
import useAuthStore from '../store/authStore';
import PageHeader from '../components/common/PageHeader';
import { toast } from '../components/common/Toast';
import { authAPI } from '../services/api';
import api from '../services/api';
import { useMarketNotes, useSaveMarketNotes } from '../hooks/useIntelligence';
import { emitCurrencyChange } from '../hooks/useCurrencyPref';
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

const CURRENCY_CODE_OPTIONS = [
  { value: 'INR', label: 'INR — Indian Rupee (₹)', symbol: '₹' },
  { value: 'USD', label: 'USD — US Dollar ($)', symbol: '$' },
  { value: 'AED', label: 'AED — UAE Dirham', symbol: 'AED' },
  { value: 'EUR', label: 'EUR — Euro (€)', symbol: '€' },
  { value: 'GBP', label: 'GBP — British Pound (£)', symbol: '£' },
  { value: 'JPY', label: 'JPY — Japanese Yen (¥)', symbol: '¥' },
  { value: 'SGD', label: 'SGD — Singapore Dollar (S$)', symbol: 'S$' },
];

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

  // Currency code + live FX rates
  const [currencyCode, setCurrencyCode] = useState(localStorage.getItem('pref_currencyCode') || 'INR');
  const [liveRates, setLiveRates] = useState(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesRefreshing, setRatesRefreshing] = useState(false);
  const selectedCurrency = CURRENCY_CODE_OPTIONS.find((c) => c.value === currencyCode);

  const fetchLiveRates = useCallback(async () => {
    setRatesLoading(true);
    try {
      const resp = await api.get('/fx/rates');
      setLiveRates(resp.data.rates || []);
    } catch {
      // Rates unavailable — graceful degradation
    } finally {
      setRatesLoading(false);
    }
  }, []);

  useEffect(() => { fetchLiveRates(); }, [fetchLiveRates]);

  const handleRefreshRates = async () => {
    setRatesRefreshing(true);
    try {
      await api.post('/fx/refresh');
      await fetchLiveRates();
      toast.success('Exchange rates refreshed');
    } catch {
      toast.error('Rate refresh failed — using most recent stored rates');
    } finally {
      setRatesRefreshing(false);
    }
  };

  const getActiveRate = () => {
    if (!liveRates || currencyCode === 'INR') return null;
    return liveRates.find((r) => r.quote_currency === currencyCode) || null;
  };

  // Market notes (admin only)
  const { data: marketNotes } = useMarketNotes();
  const saveMarketNotes = useSaveMarketNotes();
  const [notesDraft, setNotesDraft] = useState({
    micro_market: '',
    slowdown: '',
    strategic: '',
  });

  useEffect(() => {
    if (marketNotes) {
      setNotesDraft({
        micro_market: (marketNotes.micro_market || []).join('\n'),
        slowdown: (marketNotes.slowdown || []).join('\n'),
        strategic: (marketNotes.strategic || []).join('\n'),
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

  const handleCurrencyCodeChange = (code) => {
    setCurrencyCode(code);
    localStorage.setItem('pref_currencyCode', code);
    if (code === 'INR') {
      localStorage.removeItem('pref_fx_rate');
    } else {
      const row = liveRates?.find((r) => r.quote_currency === code);
      if (row?.rate) {
        localStorage.setItem('pref_fx_rate', String(row.rate));
      }
    }
    emitCurrencyChange();
    toast.success('Currency updated');
  };

  // Keep pref_fx_rate in sync whenever live rates refresh — otherwise a user
  // who set their currency yesterday would see stale numbers until they
  // re-picked the same currency today.
  useEffect(() => {
    if (!liveRates || currencyCode === 'INR') return;
    const row = liveRates.find((r) => r.quote_currency === currencyCode);
    if (!row?.rate) return;
    const prev = localStorage.getItem('pref_fx_rate');
    const next = String(row.rate);
    if (prev !== next) {
      localStorage.setItem('pref_fx_rate', next);
      emitCurrencyChange();
    }
  }, [liveRates, currencyCode]);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage your profile, security, and preferences"
      />

      {/* Profile Section */}
      <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
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
      <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
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
      <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
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
      <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
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

      {/* PR-NX23 (2026-05-16): Live provider health surface — sits ABOVE
          the AI usage / cost widget because "is it working?" precedes
          "how much did it cost?". Same role gate as the cost widget. */}
      {(user?.role === 'owner' || user?.role === 'admin' || user?.role === 'analyst') && (
        <AIHealthWidget />
      )}

      {(user?.role === 'owner' || user?.role === 'admin' || user?.role === 'analyst') && (
        <AIUsageWidget />
      )}

      {(user?.role === 'owner' || user?.role === 'admin') && (
        <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
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
            { key: 'slowdown', label: 'Demand Slowdown Indicators', placeholder: 'e.g. Sarjapur new launch absorption fell 15% last quarter per broker feedback\ne.g. Peripheral markets seeing extended unsold inventory' },
            { key: 'strategic', label: 'Strategic Takeaways', placeholder: 'e.g. Focus underwriting on micro-markets with sub-18 month absorption cycles\ne.g. Avoid land deals in oversupplied peripheral zones until Q3 correction clears' },
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

      {/* Currency Section */}
      <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <DollarSign size={18} />
            Display Currency
          </h3>
          <button
            onClick={handleRefreshRates}
            disabled={ratesRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 transition disabled:opacity-50"
          >
            {ratesRefreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh Rates
          </button>
        </div>
        <p className="text-xs text-content-secondary mb-4">
          All deal values are stored in INR Crores. Rates are auto-updated daily. Select a display currency and the app will use the latest available rate.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">Display Currency</label>
            <select
              value={currencyCode}
              onChange={(e) => handleCurrencyCodeChange(e.target.value)}
              className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {CURRENCY_CODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Live rate display */}
          {currencyCode !== 'INR' && (
            <div className="rounded-lg border border-hairline bg-bg-secondary p-4">
              {ratesLoading ? (
                <div className="flex items-center gap-2 text-sm text-content-secondary">
                  <Loader2 size={14} className="animate-spin" />
                  Loading rates…
                </div>
              ) : (() => {
                const activeRate = getActiveRate();
                if (!activeRate) {
                  return (
                    <div className="flex items-start gap-2 text-sm text-amber-700">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      <div>
                        No rate available for INR → {currencyCode}. Click <strong>Refresh Rates</strong> to fetch the latest rates.
                      </div>
                    </div>
                  );
                }
                const isStale = activeRate.freshness_status !== 'fresh';
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {isStale
                        ? <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                        : <CheckCircle size={14} className="text-emerald-500 flex-shrink-0" />
                      }
                      <span className="text-sm font-semibold text-content-primary">
                        1 INR = {currencyCode} {Number(activeRate.rate).toFixed(6)}
                      </span>
                    </div>
                    <div className="text-xs text-content-secondary space-y-0.5">
                      <p>Effective date: {activeRate.effective_date}</p>
                      <p>Source: {activeRate.source}</p>
                      <p>Status: <span className={isStale ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>{activeRate.freshness_status}</span></p>
                      {isStale && <p className="text-amber-600">Using most recent available rate — click Refresh Rates to update.</p>}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* All rates table */}
          {liveRates && liveRates.length > 0 && (
            <div>
              <p className="text-xs font-medium text-content-secondary uppercase tracking-wider mb-2">All Available Rates (1 INR =)</p>
              <div className="rounded-lg border border-hairline overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-bg-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-content-secondary">Currency</th>
                      <th className="px-3 py-2 text-right font-medium text-content-secondary">Rate</th>
                      <th className="px-3 py-2 text-right font-medium text-content-secondary">Date</th>
                      <th className="px-3 py-2 text-right font-medium text-content-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {liveRates.map((r) => (
                      <tr key={r.quote_currency} className={r.quote_currency === currencyCode ? 'bg-primary-50' : 'bg-white'}>
                        <td className="px-3 py-2 font-medium text-content-primary">{r.quote_currency}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-content-secondary">{Number(r.rate).toFixed(6)}</td>
                        <td className="px-3 py-2 text-right text-content-secondary">{r.effective_date}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${r.freshness_status === 'fresh' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {r.freshness_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-xs text-content-muted">Rates are stored in INR base. Display only — stored deal values are never modified.</p>
            </div>
          )}

          {/* Two-factor authentication (TOTP via authenticator app). */}
          <MfaCard />

          {/* Account closure (DPDP §8(7)) — every authenticated user can
              self-serve. Erasure scheduled +90 days, runs via the daily
              retention sweep cron. */}
          <CloseAccountCard />
        </div>
      </div>
    </div>
  );
}
