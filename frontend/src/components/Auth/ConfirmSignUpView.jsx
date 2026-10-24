import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { describeAuthError } from '../../services/auth/index.js';
import { useToast } from '../Common/Toast.jsx';
import { Button, Input, Field, Alert } from '../ui/index.js';
import { AuthCard } from './LoginView.jsx';

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
  const [fieldErrors, setFieldErrors] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!username.trim()) errs.username = 'กรอกชื่อผู้ใช้';
    if (!/^\d{6}$/.test(code.trim())) errs.code = 'รหัสยืนยันต้องเป็นตัวเลข 6 หลัก';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError(null);
      return;
    }
    setFieldErrors({});
    setLoading(true);
    setError(null);
    try {
      await confirmRegistration({ username: username.trim(), code: code.trim() });
      addToast('ยืนยันอีเมลแล้ว เข้าสู่ระบบด้วยรหัสผ่านหลักได้เลย', 'success', 5000);
      onNavigateLogin?.();
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!username.trim()) {
      setFieldErrors({ username: 'กรอกชื่อผู้ใช้ก่อนขอรหัสใหม่' });
      return;
    }
    setResending(true);
    setError(null);
    try {
      const res = await resendConfirmation({ username: username.trim() });
      if (res?.devCode) setHint(res.devCode);
      addToast('ส่งรหัสยืนยันใหม่แล้ว ตรวจสอบอีเมลของคุณ', 'info');
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthCard
      title="ยืนยันอีเมล"
      description="กรอกรหัส 6 หลักที่ส่งไปยังอีเมลที่ใช้สมัคร"
      footer={
        <Button variant="link" className="h-auto p-0" onClick={onNavigateLogin}>
          กลับไปหน้าเข้าสู่ระบบ
        </Button>
      }
    >
      <div className="grid gap-3 empty:hidden mb-5">
        {error && <Alert variant="error">{error}</Alert>}
        {authMode === 'local' && hint && (
          <Alert variant="info" title="โหมดทดสอบในเครื่อง">
            รหัสยืนยันของคุณคือ <span className="font-mono font-ui tracking-widest">{hint}</span>
          </Alert>
        )}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4" noValidate aria-busy={loading || undefined}>
        <Field label="ชื่อผู้ใช้" error={fieldErrors.username}>
          {(props) => (
            <Input
              {...props}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) setFieldErrors((p) => ({ ...p, username: null }));
              }}
              disabled={loading}
            />
          )}
        </Field>

        <Field label="รหัสยืนยัน" error={fieldErrors.code}>
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                if (fieldErrors.code) setFieldErrors((p) => ({ ...p, code: null }));
              }}
              placeholder="000000"
              className="h-11 text-center font-mono text-lg tracking-[0.4em]"
              disabled={loading}
              autoFocus
            />
          )}
        </Field>

        <Button type="submit" className="mt-1 w-full" loading={loading}>
          {loading ? 'กำลังยืนยัน…' : 'ยืนยันอีเมล'}
        </Button>

        <div className="flex flex-wrap items-center justify-center gap-x-1 text-sm text-muted-foreground">
          <span>ไม่ได้รับรหัส?</span>
          <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={handleResend} loading={resending}>
            {resending ? 'กำลังส่ง…' : 'ส่งรหัสใหม่'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}

export default ConfirmSignUpView;
