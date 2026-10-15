import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { describeAuthError } from '../../services/auth/index.js';
import ClientCrypto from '../../services/crypto.js';
import { useToast } from '../Common/Toast.jsx';
import { Button, Input, Field, Alert } from '../ui/index.js';
import { AuthCard, PasswordInput, PasswordStrengthMeter, DerivingStatus } from './LoginView.jsx';

export function ResetPasswordView({ onNavigateLogin }) {
  const { addToast } = useToast();
  const { requestPasswordReset, confirmPasswordReset, authMode } = useAuth();
  const [devCodeHint, setDevCodeHint] = useState(null);

  const [step, setStep] = useState(1); // 1: Request OTP, 2: Enter OTP & New Password
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Live strength meter for new password
  const passwordStrength = useMemo(() => {
    return ClientCrypto.calculateStrength(newPassword);
  }, [newPassword]);

  const clearFieldError = (key) => {
    if (fieldErrors[key]) setFieldErrors((p) => ({ ...p, [key]: null }));
    setError(null);
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setFieldErrors({ email: 'กรอกอีเมลที่ใช้สมัคร' });
      return;
    }

    setFieldErrors({});
    setLoading(true);
    setError(null);
    try {
      const res = await requestPasswordReset({ identifier: email.trim().toLowerCase() });
      // Same message whether or not the e-mail exists (no account enumeration).
      addToast('หากอีเมลนี้มีบัญชีอยู่ ระบบได้ส่งรหัสยืนยันไปแล้ว', 'info');
      setDevCodeHint(res?.devCode || null);
      setStep(2);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Validation
    const validation = ClientCrypto.validators.validatePasswordReset({
      email,
      otp: otpCode,
      newPassword,
      confirmPassword,
    });

    if (!validation.valid) {
      const errMap = {};
      validation.errors.forEach((err) => {
        if (!errMap[err.field]) errMap[err.field] = err.message;
      });
      // The e-mail was entered in step 1, so report it at the top of the form.
      if (errMap.email) setError(errMap.email);
      setFieldErrors(errMap);
      return;
    }

    setLoading(true);
    try {
      const result = await confirmPasswordReset({
        identifier: email.trim().toLowerCase(),
        code: otpCode.trim(),
        newMasterPassword: newPassword,
      });
      addToast(
        result.keysReset
          ? 'ตั้งรหัสผ่านหลักใหม่แล้ว เข้าสู่ระบบด้วยรหัสผ่านหลักใหม่ได้เลย'
          : 'ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบและยืนยันตัวตนสองขั้นตอนเพื่อสร้างคลังรหัสผ่านใหม่',
        'success',
        6000
      );
      if (onNavigateLogin) {
        onNavigateLogin();
      }
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      size={step === 1 ? 'sm' : 'md'}
      title="รีเซ็ตรหัสผ่านหลัก"
      description={
        step === 1
          ? 'ขั้นตอนที่ 1 จาก 2 · กรอกอีเมลเพื่อรับรหัสยืนยัน 6 หลัก'
          : `ขั้นตอนที่ 2 จาก 2 · กรอกรหัสที่ส่งไปยัง ${email.trim()} และตั้งรหัสผ่านหลักใหม่`
      }
      footer={
        <>
          จำรหัสผ่านได้แล้ว?{' '}
          <Button variant="link" className="h-auto p-0" onClick={onNavigateLogin}>
            กลับไปหน้าเข้าสู่ระบบ
          </Button>
        </>
      }
    >
      {error && (
        <Alert variant="error" className="mb-5">
          {error}
        </Alert>
      )}

      {step === 1 ? (
        <form onSubmit={handleRequestOtp} className="grid gap-4" noValidate aria-busy={loading || undefined}>
          <Field label="อีเมลที่ใช้สมัคร" error={fieldErrors.email}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError('email');
                }}
                placeholder="alice@example.com"
                disabled={loading}
                autoFocus
              />
            )}
          </Field>

          <Alert variant="warning" title="รายการเดิมจะเปิดอ่านไม่ได้">
            ระบบไม่เก็บรหัสผ่านหลักของคุณ จึงกู้คืนให้ไม่ได้ เมื่อตั้งรหัสผ่านหลักใหม่ ระบบจะสร้างคลังรหัสผ่านใหม่
            และรายการที่บันทึกไว้เดิมจะถอดรหัสไม่ได้อีก หากยังจำรหัสผ่านหลักได้ ให้กลับไปเข้าสู่ระบบแทน
          </Alert>

          <Button type="submit" className="mt-1 w-full" loading={loading}>
            {loading ? 'กำลังส่งรหัส…' : 'ส่งรหัสยืนยัน'}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleConfirmReset} className="grid gap-4" noValidate aria-busy={loading || undefined}>
          {authMode === 'local' && devCodeHint && (
            <Alert variant="info" title="โหมดทดสอบในเครื่อง">
              รหัสยืนยันของคุณคือ <span className="font-mono font-ui tracking-widest">{devCodeHint}</span>
            </Alert>
          )}

          <Field label="รหัสยืนยัน 6 หลัก" error={fieldErrors.otp}>
            {(props) => (
              <Input
                {...props}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, ''));
                  clearFieldError('otp');
                }}
                placeholder="000000"
                className="h-11 text-center font-mono text-lg tracking-[0.4em]"
                disabled={loading}
                autoFocus
              />
            )}
          </Field>

          <div className="grid gap-2">
            <Field label="รหัสผ่านหลักใหม่" hint="อย่างน้อย 8 ตัวอักษร" error={fieldErrors.newPassword}>
              {(props) => (
                <PasswordInput
                  {...props}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    clearFieldError('newPassword');
                  }}
                  visible={showPassword}
                  onToggleVisible={() => setShowPassword((v) => !v)}
                  disabled={loading}
                />
              )}
            </Field>
            {newPassword && <PasswordStrengthMeter strength={passwordStrength} />}
          </div>

          <Field label="ยืนยันรหัสผ่านหลักใหม่" error={fieldErrors.confirmPassword}>
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  clearFieldError('confirmPassword');
                }}
                visible={showPassword}
                placeholder="กรอกรหัสผ่านหลักใหม่อีกครั้ง"
                disabled={loading}
              />
            )}
          </Field>

          <p className="text-caption text-muted-foreground">
            เมื่อยืนยันแล้ว รายการเดิมในคลังจะถอดรหัสไม่ได้อีก
          </p>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => {
                setStep(1);
                setError(null);
                setFieldErrors({});
              }}
              disabled={loading}
            >
              ย้อนกลับ
            </Button>
            <Button type="submit" className="w-full sm:flex-1" loading={loading}>
              {loading ? 'กำลังเตรียมกุญแจเข้ารหัส…' : 'ตั้งรหัสผ่านหลักใหม่'}
            </Button>
          </div>
        </form>
      )}
      <DerivingStatus active={step === 2 && loading} />
    </AuthCard>
  );
}

export default ResetPasswordView;
