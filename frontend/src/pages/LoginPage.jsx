import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus, Mail, Lock, User, Phone, Eye, EyeOff } from 'lucide-react';
import useAuthStore from '../store/authStore';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register, loading, error, clearError } = useAuthStore();

  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
  });
  const [validationErrors, setValidationErrors] = useState({});

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
        },
        rememberMe,
      );
    } else {
      success = await login(form.email, form.password, rememberMe);
    }

    if (success) {
      navigate('/dashboard');
    }
  };

  const toggleMode = () => {
    setIsRegister((prev) => !prev);
    setValidationErrors({});
    clearError();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-primary-600 tracking-tight">REDIP</h1>
          <p className="text-gray-500 mt-2 text-sm">Real Estate Deal Intelligence Platform</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-1">
            {isRegister ? 'Create an account' : 'Welcome back'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {isRegister
              ? 'Create a deal workspace account for sourcing, diligence, and underwriting'
              : 'Sign in to your REDIP deal intelligence workspace'}
          </p>

          {/* Server error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name (register only) */}
            {isRegister && (
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    id="name"
                    name="name"
                    type="text"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="John Doe"
                    className={`w-full pl-10 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                      validationErrors.name ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                </div>
                {validationErrors.name && (
                  <p className="text-xs text-red-600 mt-1">{validationErrors.name}</p>
                )}
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="you@company.com"
                  className={`w-full pl-10 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                    validationErrors.email ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
              </div>
              {validationErrors.email && (
                <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  className={`w-full pl-10 pr-10 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                    validationErrors.password ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {validationErrors.password && (
                <p className="text-xs text-red-600 mt-1">{validationErrors.password}</p>
              )}
            </div>

            {/* Phone (register only) */}
            {isRegister && (
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="9876543210"
                    className={`w-full pl-10 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                      validationErrors.phone ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                </div>
                {validationErrors.phone && (
                  <p className="text-xs text-red-600 mt-1">{validationErrors.phone}</p>
                )}
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
              <div className="flex items-center gap-2">
                <input
                  id="rememberMe"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                />
                <label htmlFor="rememberMe" className="text-sm text-gray-600 cursor-pointer select-none">
                  Remember me across browser restarts
                </label>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Default session behavior is privacy-first: if this stays unchecked, REDIP signs you
                out when the browser closes.
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Toggle */}
          <p className="text-center text-sm text-gray-500 mt-6">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="text-primary-600 hover:text-primary-700 font-medium"
            >
              {isRegister ? 'Sign In' : 'Register'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
