import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../../context/AuthContext.jsx';
import { ShieldIcon, CloseIcon, CheckIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';

export function MfaModal({ isOpen, onClose, mode = 'setup', onSuccess }) {
  const { completeMfaLogin, setupTotp, verifyTotp } = useAuth();
  const { addToast } = useToast();

  const [setupData, setSetupData] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load MFA setup details when in 'setup' mode
  useEffect(() => {
    if (isOpen && mode === 'setup') {
      setCode('');
      setError(null);
      setLoading(true);
      setupTotp()
        .then((details) => {
          setSetupData({ secret: details.sharedSecret, otpauth_url: details.otpauthUrl });
        })
        .catch((err) => {
          setError(err.message || 'ไม่สามารถเริ่มการตั้งค่า MFA ได้');
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (isOpen && mode === 'challenge') {
      setCode('');
      setError(null);
    }
    // setupTotp is intentionally not a dependency: only re-run when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  // Render the otpauth:// URI locally: it contains the TOTP secret and must never be sent
  // to a third-party QR service.
  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);
    if (setupData?.otpauth_url) {
      QRCode.toDataURL(setupData.otpauth_url, { width: 160, margin: 1 })
        .then((url) => {
          if (!cancelled) setQrDataUrl(url);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [setupData]);

  if (!isOpen) return null;

  const handleVerifySetup = async (e) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      setError('รหัส OTP ต้องมี 6 หลัก (Must be 6 digits)');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await verifyTotp({ code: code.trim() });
      addToast('เปิดใช้งาน Multi-Factor Authentication (MFA) สำเร็จ!', 'success');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyChallenge = async (e) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      setError('รหัส OTP ต้องมี 6 หลัก (Must be 6 digits)');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await completeMfaLogin({ code: code.trim() });
      addToast('ยืนยันตัวตน MFA สำเร็จ ยินดีต้อนรับสู่ SecureVault!', 'success');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <CloseIcon className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ShieldIcon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">
              {mode === 'setup' ? 'ตั้งค่าการยืนยันตัวตน 2 ขั้นตอน (MFA)' : 'การยืนยันตัวตนขั้นที่สอง (MFA Challenge)'}
            </h3>
            <p className="text-xs text-slate-400">
              {mode === 'setup' ? 'ผูกกับ Authenticator App (Google/Microsoft Authenticator)' : 'กรอกรหัส 6 หลักจากแอปพลิเคชันของคุณ'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs">
            {error}
          </div>
        )}

        {mode === 'setup' ? (
          <div>
            {loading && !setupData ? (
              <div className="py-8 text-center text-sm text-slate-400">
                กำลังสร้างคีย์ TOTP สำหรับบัญชีของคุณ...
              </div>
            ) : setupData ? (
              <form onSubmit={handleVerifySetup} className="space-y-4">
                {/* Secret Key Display */}
                <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700/60 text-center">
                  <div className="text-xs text-slate-400 mb-2">
                    สแกน QR Code หรือเพิ่มรหัส Secret ใน Authenticator App:
                  </div>

                  <div className="w-40 h-40 mx-auto my-2 bg-white rounded-xl p-2 flex items-center justify-center shadow-md">
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt="QR Code สำหรับตั้งค่าแอป Authenticator" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-xs text-slate-500">กำลังสร้าง QR Code...</span>
                    )}
                  </div>

                  <div className="mt-3">
                    <span className="text-xs text-slate-400 block mb-1">รหัสสำหรับกรอกด้วยตนเอง (Manual Key):</span>
                    <code className="px-3 py-1.5 bg-slate-800 rounded-lg text-emerald-400 font-mono text-xs font-bold tracking-wider select-all border border-slate-700">
                      {setupData.secret}
                    </code>
                  </div>
                </div>

                <div>
                  <label htmlFor="mfa-verify-code" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    กรอกรหัสยืนยัน 6 หลัก (Enter 6-Digit Code)
                  </label>
                  <input
                    id="mfa-verify-code"
                    type="text"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="w-full text-center tracking-widest font-mono text-xl py-2.5 px-4 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                    required
                  />
                </div>

                <div className="flex space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={loading || code.length !== 6}
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center space-x-1"
                  >
                    <CheckIcon className="w-4 h-4" />
                    <span>ยืนยันและเปิดใช้</span>
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ) : (
          <form onSubmit={handleVerifyChallenge} className="space-y-4">
            <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/40 text-xs text-slate-300">
              บัญชีนี้ได้รับการปกป้องด้วย MFA กรุณากรอกรหัส 6 หลักจาก Authenticator App ของคุณเพื่อปลดล็อกคลังรหัสผ่าน
            </div>

            <div>
              <label htmlFor="mfa-challenge-code" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                รหัสความปลอดภัย (6-Digit OTP Code)
              </label>
              <input
                id="mfa-challenge-code"
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full text-center tracking-widest font-mono text-2xl py-3 px-4 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                autoFocus
                required
              />
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center space-x-1"
              >
                <CheckIcon className="w-4 h-4" />
                <span>ยืนยันเข้าสู่ระบบ</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default MfaModal;
