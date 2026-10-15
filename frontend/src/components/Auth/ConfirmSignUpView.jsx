import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { describeAuthError } from '../../services/auth/index.js';
import { ShieldIcon, CheckIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';

/**
 * UC-1 step 2: enter the e-mail verification code sent by Amazon Cognito.
 * In local mode the emulator returns the code (devCode) and it is shown as a hint.
 */
export function ConfirmSignUpView({ username: initialUsername = '', devCode, onNavigateLogin }) {
  const { confirmRegistration, resendConfirmation, authMode } = useAuth();
  const { addToast } = useToast();

  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState('');
  const [hint, setHint] = useState(devCode || null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('กรุณากรอกชื่อผู้ใช้');
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('รหัสยืนยันต้องเป็นตัวเลข 6 หลัก');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await confirmRegistration({ username: username.trim(), code: code.trim() });
      addToast('ยืนยันอีเมลสำเร็จ! กรุณาเข้าสู่ระบบด้วยรหัสผ่านหลัก', 'success', 5000);
      onNavigateLogin?.();
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!username.trim()) {
      setError('กรุณากรอกชื่อผู้ใช้ก่อนขอรหัสใหม่');
      return;
    }
    setResending(true);
    setError(null);
    try {
      const res = await resendConfirmation({ username: username.trim() });
      if (res?.devCode) setHint(res.devCode);
      addToast('ส่งรหัสยืนยันใหม่แล้ว กรุณาตรวจสอบอีเมล', 'info');
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-slate-800/90 backdrop-blur-xl border border-slate-700/80 rounded-3xl shadow-2xl">
      <div className="text-center mb-6">
        <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
          <ShieldIcon className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">ยืนยันอีเมล</h1>
        <p className="text-sm text-slate-400 mt-1">กรอกรหัส 6 หลักที่ส่งไปยังอีเมลที่ใช้สมัคร</p>
      </div>

      {error && (
        <div role="alert" className="mb-5 p-3.5 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {authMode === 'local' && hint && (
        <p className="mb-4 text-xs text-slate-400">
          โหมดพัฒนา (local): รหัสยืนยันคือ <span className="font-mono text-emerald-300">{hint}</span>
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="confirm-username" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            ชื่อผู้ใช้ (Username)
          </label>
          <input
            id="confirm-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label htmlFor="confirm-code" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            รหัสยืนยัน (Verification code)
          </label>
          <input
            id="confirm-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-slate-100 text-sm tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            autoFocus
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm flex items-center justify-center space-x-2"
        >
          <CheckIcon className="w-4 h-4" />
          <span>{loading ? 'กำลังยืนยัน...' : 'ยืนยันอีเมล'}</span>
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm text-slate-400">
        <button type="button" onClick={handleResend} disabled={resending} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
          {resending ? 'กำลังส่ง...' : 'ส่งรหัสใหม่'}
        </button>
        <button type="button" onClick={onNavigateLogin} className="text-emerald-400 hover:text-emerald-300">
          กลับไปหน้าเข้าสู่ระบบ
        </button>
      </div>
    </div>
  );
}

export default ConfirmSignUpView;
