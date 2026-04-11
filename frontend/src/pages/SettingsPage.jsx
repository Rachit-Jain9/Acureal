import { useState, useEffect } from 'react';
import { User, Lock, Palette, Save, Loader2, DollarSign, Brain } from 'lucide-react';
import useAuthStore from '../store/authStore';
import PageHeader from '../components/common/PageHeader';
import { toast } from '../components/common/Toast';
import { authAPI } from '../services/api';
import { useMarketNotes, useSaveMarketNotes } from '../hooks/useIntelligence';

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
  { value: 'LKR', label: 'LKR — Sri Lankan Rupee', symbol: 'Rs' },
  { value: 'THB', label: 'THB — Thai Baht (฿)', symbol: '฿' },
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

  // Preferences (localStorage only)
  const [preferences, setPreferences] = useState({
    currency: localStorage.getItem('pref_currency') || 'crores',
    areaUnit: localStorage.getItem('pref_areaUnit') || 'sqft',
    dateFormat: localStorage.getItem('pref_dateFormat') || 'en-IN',
  });

  // Currency code + FX reference rate
  const [currencyCode, setCurrencyCode] = useState(localStorage.getItem('pref_currencyCode') || 'INR');
  const [fxRate, setFxRate] = useState(localStorage.getItem('pref_fx_rate') || '');
  const selectedCurrency = CURRENCY_CODE_OPTIONS.find((c) => c.value === currencyCode);

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
      setFxRate('');
    }
    toast.success('Currency updated — reload any open page to see converted values');
  };

  const handleFxRateSave = () => {
    const parsed = parseFloat(fxRate);
    if (!parsed || parsed <= 0) {
      toast.error('Enter a valid positive exchange rate');
      return;
    }
    localStorage.setItem('pref_fx_rate', String(parsed));
    toast.success(`Reference rate saved: 1 ${currencyCode} = ₹${parsed.toFixed(4)}`);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage your profile, security, and preferences"
      />

      {/* Profile Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User size={18} />
          Profile
        </h3>
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={profile.email}
              readOnly
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={profile.phone}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              placeholder="9876543210"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Lock size={18} />
          Security
        </h3>
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-sm font-medium text-gray-800">Current session behavior</p>
          <p className="mt-1 text-xs text-gray-500">
            {sessionPersistence === 'persistent'
              ? 'Remember me is enabled for this browser. REDIP will keep this session across browser restarts until you sign out.'
              : 'This is a browser-session login. REDIP will sign you out when the browser closes unless you choose Remember me at sign-in.'}
          </p>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input
              type="password"
              value={security.currentPassword}
              onChange={(e) => setSecurity((s) => ({ ...s, currentPassword: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={security.newPassword}
              onChange={(e) => setSecurity((s) => ({ ...s, newPassword: e.target.value }))}
              placeholder="At least 8 chars with uppercase, lowercase, and a number"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={security.confirmPassword}
              onChange={(e) => setSecurity((s) => ({ ...s, confirmPassword: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
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
      </div>

      {/* Preferences Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Palette size={18} />
          Preferences
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Number Format</label>
            <select
              value={preferences.currency}
              onChange={(e) => handlePreferenceChange('currency', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Area Unit</label>
            <select
              value={preferences.areaUnit}
              onChange={(e) => handlePreferenceChange('areaUnit', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {AREA_UNIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date Format</label>
            <select
              value={preferences.dateFormat}
              onChange={(e) => handlePreferenceChange('dateFormat', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {DATE_FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Market Intelligence Notes — admin only */}
      {user?.role === 'admin' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Brain size={18} />
            Market Intelligence Notes
          </h3>
          <p className="text-xs text-gray-500 mb-4">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <textarea
                rows={4}
                value={notesDraft[key]}
                onChange={(e) => setNotesDraft((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y font-mono"
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-gray-400">One observation per line.</p>
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

      {/* Currency Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <DollarSign size={18} />
          Display Currency
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          All deal values are stored in INR Crores. Select a display currency and enter your reference exchange rate — REDIP does not fetch live FX rates.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
            <select
              value={currencyCode}
              onChange={(e) => handleCurrencyCodeChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {CURRENCY_CODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {currencyCode !== 'INR' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reference rate: 1 {currencyCode} = how many INR?
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder={`e.g. ${currencyCode === 'USD' ? '84.20' : currencyCode === 'AED' ? '22.90' : currencyCode === 'EUR' ? '91.50' : currencyCode === 'GBP' ? '107.00' : currencyCode === 'JPY' ? '0.55' : currencyCode === 'SGD' ? '62.00' : currencyCode === 'LKR' ? '0.31' : '2.45'}`}
                  step="0.0001"
                  min="0"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button
                  onClick={handleFxRateSave}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition"
                >
                  <Save size={14} />
                  Save Rate
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Enter the rate from a source you trust (e.g. RBI, your bank, Bloomberg). This is for display only and does not affect stored data.
              </p>
              {localStorage.getItem('pref_fx_rate') && (
                <p className="mt-1 text-xs text-emerald-600 font-medium">
                  Active rate: 1 {currencyCode} = ₹{parseFloat(localStorage.getItem('pref_fx_rate')).toFixed(4)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
