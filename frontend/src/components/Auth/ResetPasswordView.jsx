import React, { useState, useMemo } from 'react';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { ShieldIcon, KeyIcon, EyeIcon, EyeOffIcon, CheckIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';

export function ResetPasswordView({ onNavigateLogin }) {
  const { addToast } = useToast();

  const [step, setStep] = useState(1); // 1: Request OTP, 2: Enter OTP & New Password
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Live strength meter for new password
  const passwordStrength = useMemo(() => {
    return ClientCrypto.calculateStrength(newPassword);
  }, [newPassword]);

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('กรุณากรอกอีเมลที่ใช้ลงทะเบียน');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.resetPasswordRequest(email.trim().toLowerCase());
      addToast(res.message || 'ส่งรหัสยืนยัน OTP ไปยังอีเมลเรียบร้อยแล้ว', 'info');

      // In local dev/testing, the backend provides debug_otp for easy verification
      if (res?.data?.debug_otp) {
        setOtpCode(res.data.debug_otp);
      }
      setStep(2);
    } catch (err) {
      setError(err.message || 'ไม่พบอีเมลนี้ในระบบ หรือเกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e) => {
    e.preventDefault();
    setError(null);

    // Validation
    const validation = ClientCrypto.validators.validatePasswordReset({
      email,
      otp: otpCode,
      newPassword,
      confirmPassword,
    });

    if (!validation.valid) {
      setError(validation.errors[0]?.message || 'กรุณาตรวจสอบข้อมูล');
      return;
    }

    setLoading(true);
    try {
      // 1. Generate fresh salt
      const newAuthSalt = ClientCrypto.createSalt(16);

      // 2. Derive new Auth Hash via Argon2id
      const { authHash: newAuthHash } = await ClientCrypto.deriveKeys(newPassword, newAuthSalt);

      // 3. Submit reset to server
      await api.auth.resetPasswordConfirm({
        email: email.trim().toLowerCase(),
        otpCode: otpCode.trim(),
        newAuthHash,
        newAuthSalt,
      });

      addToast('รีเซ็ตรหัสผ่านสำเร็จ! กรุณาเข้าสู่ระบบด้วยรหัสผ่านหลักใหม่', 'success', 6000);
      if (onNavigateLogin) {
        onNavigateLogin();
      }
    } catch (err) {
      setError(err.message || 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ');
    } finally {
      setLoading(false);
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
        <div className="inline-flex p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 mb-3">
          <KeyIcon className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">รีเซ็ตรหัสผ่านหลัก</h1>
        <p className="text-sm text-slate-400 mt-1">
          {step === 1 ? 'กรอกอีเมลเพื่อรับรหัสยืนยัน 6 หลัก (OTP)' : 'กรอกรหัสยืนยันและตั้งรหัสผ่านหลักใหม่'}
        </p>
      </div>

      {error && (
        <div className="mb-5 p-3.5 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {step === 1 ? (
        <form onSubmit={handleRequestOtp} className="space-y-4">
          <div>
            <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              อีเมลที่ลงทะเบียน (Registered Email)
            </label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="alice@example.com"
              className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              autoFocus
              required
            />
          </div>

          <div className="p-3 bg-amber-950/30 border border-amber-500/20 rounded-xl text-amber-200 text-xs flex items-start space-x-2">
            <span className="text-amber-400 font-bold">⚠️ ข้อควรทราบ:</span>
            <span>
              ตามสถาปัตยกรรม Zero-Knowledge การรีเซ็ตรหัสผ่านหลักจะทำให้กุญแจถอดรหัสเปลี่ยนไป ข้อมูลเดิมจะไม่สามารถอ่านได้หากไม่มี Recovery Key
            </span>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-all shadow-lg shadow-amber-950/40 flex items-center justify-center space-x-2"
          >
            {loading ? <span>กำลังส่ง OTP...</span> : <span>ส่งรหัสยืนยัน OTP (Request OTP)</span>}
          </button>
        </form>
      ) : (
        <form onSubmit={handleConfirmReset} className="space-y-4">
          {/* OTP Code */}
          <div>
            <label htmlFor="otp-input" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              รหัสยืนยัน 6 หลัก (OTP Code)
            </label>
            <input
              id="otp-input"
              type="text"
              maxLength={6}
              value={otpCode}
              onChange={(e) => {
                setOtpCode(e.target.value.replace(/\D/g, ''));
                setError(null);
              }}
              placeholder="123456"
              className="w-full text-center tracking-widest font-mono text-xl py-2.5 px-4 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
              autoFocus
              required
            />
          </div>

          {/* New Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              รหัสผ่านหลักใหม่ (New Master Password)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError(null);
                }}
                placeholder="อย่างน้อย 8 ตัวอักษร"
                className="w-full px-4 py-2.5 pr-11 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
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

            {/* Strength meter */}
            {newPassword && (
              <div className="mt-2 p-2.5 bg-slate-900/60 rounded-xl border border-slate-700/50 text-xs">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-slate-400">
                    ความแข็งแรง: <strong className="text-slate-200">{passwordStrength.label.th}</strong>
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

          {/* Confirm New Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              ยืนยันรหัสผ่านใหม่ (Confirm New Password)
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError(null);
              }}
              placeholder="กรอกรหัสผ่านใหม่อีกครั้งให้ตรงกัน"
              className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              required
            />
          </div>

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors"
            >
              ย้อนกลับ
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 px-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center space-x-1"
            >
              <CheckIcon className="w-4 h-4" />
              <span>{loading ? 'กำลังบันทึก...' : 'ยืนยันรหัสผ่านใหม่'}</span>
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 text-center text-sm text-slate-400">
        จำรหัสผ่านได้แล้ว?{' '}
        <button
          type="button"
          onClick={onNavigateLogin}
          className="text-amber-400 hover:text-amber-300 font-medium transition-colors"
        >
          กลับสู่หน้าเข้าสู่ระบบ (Back to Sign In)
        </button>
      </div>
    </div>
  );
}

export default ResetPasswordView;
