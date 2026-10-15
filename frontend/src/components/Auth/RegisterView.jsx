import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import ClientCrypto from '../../services/crypto.js';
import { ShieldIcon, KeyIcon, EyeIcon, EyeOffIcon, CheckIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';

export function RegisterView({ onNavigateLogin }) {
  const { register, loading, error: authError, setError } = useAuth();
  const { addToast } = useToast();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    fullName: '',
    masterPassword: '',
    confirmPassword: '',
    role: 'user',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [derivingKeys, setDerivingKeys] = useState(false);

  // Calculate live Master Password entropy & strength
  const passwordStrength = useMemo(() => {
    return ClientCrypto.calculateStrength(formData.masterPassword);
  }, [formData.masterPassword]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: null }));
    }
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormErrors({});

    // Client-side validations
    const validation = ClientCrypto.validators.validateRegistration({
      username: formData.username,
      email: formData.email,
      fullName: formData.fullName,
      password: formData.masterPassword,
      confirmPassword: formData.confirmPassword,
    });

    if (!validation.valid) {
      const errMap = {};
      validation.errors.forEach((err) => {
        errMap[err.field] = err.message;
      });
      setFormErrors(errMap);
      return;
    }

    try {
      setDerivingKeys(true);
      await register({
        username: formData.username.trim(),
        email: formData.email.trim().toLowerCase(),
        fullName: formData.fullName.trim(),
        masterPassword: formData.masterPassword,
        role: formData.role,
      });

      addToast('สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบด้วยรหัสผ่านหลักของคุณ', 'success', 5000);
      if (onNavigateLogin) {
        onNavigateLogin();
      }
    } catch (err) {
      // error is stored in authError
    } finally {
      setDerivingKeys(false);
    }
  };

  const getScoreColor = (score) => {
    if (score <= 1) return 'bg-rose-500';
    if (score === 2) return 'bg-amber-500';
    if (score === 3) return 'bg-blue-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-slate-800/90 backdrop-blur-xl border border-slate-700/80 rounded-3xl shadow-2xl">
      <div className="text-center mb-6">
        <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
          <ShieldIcon className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">สร้างบัญชี SecureVault</h1>
        <p className="text-sm text-slate-400 mt-1">
          ระบบคลังรหัสผ่านคลาวด์ Zero-Knowledge เข้ารหัสลับสมบูรณ์แบบที่เบราว์เซอร์
        </p>
      </div>

      {authError && (
        <div className="mb-5 p-3.5 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs sm:text-sm">
          {authError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Username */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            ชื่อผู้ใช้ (Username) *
          </label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleChange}
            placeholder="เช่น alice_vault"
            className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            required
          />
          {formErrors.username && (
            <p className="mt-1 text-xs text-rose-400">{formErrors.username}</p>
          )}
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            อีเมล (Email) *
          </label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="alice@example.com"
            className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            required
          />
          {formErrors.email && (
            <p className="mt-1 text-xs text-rose-400">{formErrors.email}</p>
          )}
        </div>

        {/* Full Name */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            ชื่อ-นามสกุล (Full Name) *
          </label>
          <input
            type="text"
            name="fullName"
            value={formData.fullName}
            onChange={handleChange}
            placeholder="สมชาย ใจดี"
            className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            required
          />
          {formErrors.fullName && (
            <p className="mt-1 text-xs text-rose-400">{formErrors.fullName}</p>
          )}
        </div>

        {/* Master Password */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            รหัสผ่านหลัก (Master Password) *
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              name="masterPassword"
              value={formData.masterPassword}
              onChange={handleChange}
              placeholder="รหัสผ่านหลักที่ดีที่สุดเพียงรหัสเดียว"
              className="w-full px-4 py-2.5 pr-11 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
            </button>
          </div>
          {formErrors.password && (
            <p className="mt-1 text-xs text-rose-400">{formErrors.password}</p>
          )}

          {/* Password Strength Indicator */}
          {formData.masterPassword && (
            <div className="mt-2 p-2.5 bg-slate-900/60 rounded-xl border border-slate-700/50 text-xs">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-slate-400">
                  ระดับความแข็งแรง: <strong className="text-slate-200">{passwordStrength.label.th}</strong>
                </span>
                <span className="font-mono text-slate-400">{passwordStrength.entropyBits} bits</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden flex">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`h-full flex-1 border-r border-slate-900 last:border-none transition-all ${
                      passwordStrength.score >= step ? getScoreColor(passwordStrength.score) : 'bg-transparent'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            ยืนยันรหัสผ่าน (Confirm Password) *
          </label>
          <input
            type={showPassword ? 'text' : 'password'}
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder="กรอกรหัสผ่านหลักอีกครั้งให้ตรงกัน"
            className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            required
          />
          {formErrors.confirmPassword && (
            <p className="mt-1 text-xs text-rose-400">{formErrors.confirmPassword}</p>
          )}
        </div>

        {/* Role Toggle for testing / admin */}
        <div className="flex items-center justify-between text-xs pt-1 px-1 text-slate-400">
          <span>ประเภทบัญชี:</span>
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setFormData((p) => ({ ...p, role: 'user' }))}
              className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${
                formData.role === 'user'
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              User
            </button>
            <button
              type="button"
              onClick={() => setFormData((p) => ({ ...p, role: 'admin' }))}
              className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${
                formData.role === 'admin'
                  ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              Admin
            </button>
          </div>
        </div>

        {/* Zero-Knowledge Privacy Notice */}
        <div className="p-3 bg-emerald-950/30 border border-emerald-500/20 rounded-xl text-emerald-300 text-xs flex items-start space-x-2.5">
          <KeyIcon className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
          <p className="leading-relaxed">
            รหัสผ่านหลักของคุณจะไม่ถูกส่งไปยังเซิร์ฟเวอร์ ระบบใช้อัลกอริทึม <strong>Argon2id</strong> สร้างคีย์เข้ารหัสบนเครื่องของคุณโดยเฉพาะ
          </p>
        </div>

        <button
          type="submit"
          disabled={loading || derivingKeys}
          className="w-full mt-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-all shadow-lg shadow-emerald-950/40 flex items-center justify-center space-x-2"
        >
          {derivingKeys ? (
            <span>กำลังคำนวณคีย์ Argon2id บนเครื่อง...</span>
          ) : loading ? (
            <span>กำลังลงทะเบียน...</span>
          ) : (
            <>
              <CheckIcon className="w-4 h-4" />
              <span>สมัครสมาชิก (Register)</span>
            </>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-400">
        มีบัญชีอยู่แล้ว?{' '}
        <button
          type="button"
          onClick={onNavigateLogin}
          className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
        >
          เข้าสู่ระบบ (Sign In)
        </button>
      </div>
    </div>
  );
}

export default RegisterView;
