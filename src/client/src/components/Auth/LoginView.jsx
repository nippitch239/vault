import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { ShieldIcon, KeyIcon, EyeIcon, EyeOffIcon, CheckIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { MfaModal } from './MfaModal.jsx';

export function LoginView({ onNavigateRegister, onNavigateReset, onSuccess }) {
  const { login, loading, error: authError, setError } = useAuth();
  const { addToast } = useToast();

  const [identifier, setIdentifier] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [deriving, setDeriving] = useState(false);

  // MFA Challenge modal state
  const [mfaChallenge, setMfaChallenge] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!identifier.trim() || !masterPassword) {
      setError('กรุณากรอกชื่อผู้ใช้/อีเมล และรหัสผ่านหลักให้ครบถ้วน');
      return;
    }

    try {
      setDeriving(true);
      const res = await login({
        identifier: identifier.trim(),
        masterPassword,
      });

      if (res?.mfaRequired) {
        setMfaChallenge({
          mfaSessionToken: res.mfaSessionToken,
          mfaType: res.mfaType,
          pendingMek: res.pendingMek,
          identifier: res.identifier,
        });
      } else if (res?.success) {
        addToast('เข้าสู่ระบบสำเร็จ! ปลดล็อกคลังรหัสผ่านเรียบร้อยแล้ว', 'success');
        if (onSuccess) onSuccess();
      }
    } catch (err) {
      // Handled in context
    } finally {
      setDeriving(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-slate-800/90 backdrop-blur-xl border border-slate-700/80 rounded-3xl shadow-2xl">
      <div className="text-center mb-6">
        <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
          <ShieldIcon className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">เข้าสู่ระบบ SecureVault</h1>
        <p className="text-sm text-slate-400 mt-1">
          กรอกรหัสผ่านหลักเพื่อปลดล็อกข้อมูลลับ Zero-Knowledge ของคุณ
        </p>
      </div>

      {authError && (
        <div className="mb-5 p-3.5 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs sm:text-sm">
          {authError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Identifier */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            ชื่อผู้ใช้หรืออีเมล (Username / Email)
          </label>
          <input
            type="text"
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setError(null);
            }}
            placeholder="เช่น alice หรือ alice@example.com"
            className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            autoFocus
            required
          />
        </div>

        {/* Master Password */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              รหัสผ่านหลัก (Master Password)
            </label>
            <button
              type="button"
              onClick={onNavigateReset}
              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              ลืมรหัสผ่าน? (Forgot?)
            </button>
          </div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={masterPassword}
              onChange={(e) => {
                setMasterPassword(e.target.value);
                setError(null);
              }}
              placeholder="รหัสผ่านหลักของคุณ"
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
        </div>

        {/* Zero-Knowledge Privacy Badge */}
        <div className="p-3 bg-slate-900/60 border border-slate-700/50 rounded-xl text-xs text-slate-400 flex items-center space-x-2.5">
          <KeyIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>คีย์ถอดรหัสจะถูกเก็บในหน่วยความจำ RAM เท่านั้น และไม่ถูกบันทึกบนดิสก์</span>
        </div>

        <button
          type="submit"
          disabled={loading || deriving}
          className="w-full mt-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-all shadow-lg shadow-emerald-950/40 flex items-center justify-center space-x-2"
        >
          {deriving ? (
            <span>กำลังคำนวณคีย์ Argon2id...</span>
          ) : loading ? (
            <span>กำลังเข้าสู่ระบบ...</span>
          ) : (
            <>
              <CheckIcon className="w-4 h-4" />
              <span>เข้าสู่ระบบ (Sign In)</span>
            </>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-400">
        ยังไม่มีบัญชีผู้ใช้?{' '}
        <button
          type="button"
          onClick={onNavigateRegister}
          className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
        >
          สมัครสมาชิกใหม่ (Register)
        </button>
      </div>

      {/* MFA Challenge Modal */}
      {mfaChallenge && (
        <MfaModal
          isOpen={true}
          mode="challenge"
          challengeData={mfaChallenge}
          onClose={() => setMfaChallenge(null)}
          onSuccess={() => {
            setMfaChallenge(null);
            if (onSuccess) onSuccess();
          }}
        />
      )}
    </div>
  );
}

export default LoginView;
