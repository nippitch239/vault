import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import ClientCrypto from '../../services/crypto.js';
import { useToast } from '../Common/Toast.jsx';
import { Button, Input, Field, Alert } from '../ui/index.js';
import { AuthCard, PasswordInput, PasswordStrengthMeter, DerivingStatus } from './LoginView.jsx';

export function RegisterView({ onNavigateLogin, onNavigateConfirm }) {
  const { register, loading, error: authError, setError } = useAuth();
  const { addToast } = useToast();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    fullName: '',
    masterPassword: '',
    confirmPassword: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [derivingKeys, setDerivingKeys] = useState(false);

  const busy = loading || derivingKeys;

  // Calculate live Master Password entropy & strength
  const passwordStrength = useMemo(() => {
    return ClientCrypto.calculateStrength(formData.masterPassword);
  }, [formData.masterPassword]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // The validator reports the master password under "password".
    const errKey = name === 'masterPassword' ? 'password' : name;
    if (formErrors[errKey] || formErrors.general) {
      setFormErrors((prev) => ({ ...prev, [errKey]: null, general: null }));
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
      const res = await register({
        username: formData.username.trim(),
        email: formData.email.trim().toLowerCase(),
        fullName: formData.fullName.trim(),
        masterPassword: formData.masterPassword,
      });

      addToast('สร้างบัญชีแล้ว กรอกรหัสยืนยันที่ส่งไปทางอีเมล', 'success', 5000);
      if (onNavigateConfirm) {
        onNavigateConfirm(formData.username.trim(), res?.devCode);
      }
    } catch (err) {
      // error is stored in authError
    } finally {
      setDerivingKeys(false);
    }
  };

  return (
    <AuthCard
      size="md"
      title="สมัครสมาชิก"
      description="สร้างคลังรหัสผ่านที่เข้ารหัสบนเครื่องของคุณ"
      footer={
        <>
          มีบัญชีอยู่แล้ว?{' '}
          <Button variant="link" className="h-auto p-0" onClick={onNavigateLogin}>
            เข้าสู่ระบบ
          </Button>
        </>
      }
    >
      {(authError || formErrors.general) && (
        <Alert variant="error" className="mb-5">
          {authError || formErrors.general}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="grid gap-4" noValidate aria-busy={busy || undefined}>
        <Field label="ชื่อผู้ใช้" required hint="ตัวอักษรภาษาอังกฤษ ตัวเลข _ หรือ - ยาว 3–30 ตัว" error={formErrors.username}>
          {(props) => (
            <Input
              {...props}
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={formData.username}
              onChange={handleChange}
              placeholder="เช่น alice_vault"
              disabled={busy}
              autoFocus
            />
          )}
        </Field>

        <Field label="อีเมล" required hint="ใช้สำหรับรับรหัสยืนยันและรีเซ็ตรหัสผ่าน" error={formErrors.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={formData.email}
              onChange={handleChange}
              placeholder="alice@example.com"
              disabled={busy}
            />
          )}
        </Field>

        <Field label="ชื่อ-นามสกุล" required error={formErrors.fullName}>
          {(props) => (
            <Input
              {...props}
              type="text"
              name="fullName"
              autoComplete="name"
              value={formData.fullName}
              onChange={handleChange}
              placeholder="สมชาย ใจดี"
              disabled={busy}
            />
          )}
        </Field>

        <div className="grid gap-2">
          <Field
            label="รหัสผ่านหลัก"
            required
            hint="อย่างน้อย 8 ตัวอักษร จำไว้ให้ดี ระบบกู้คืนรหัสผ่านหลักให้ไม่ได้"
            error={formErrors.password}
          >
            {(props) => (
              <PasswordInput
                {...props}
                name="masterPassword"
                autoComplete="new-password"
                value={formData.masterPassword}
                onChange={handleChange}
                visible={showPassword}
                onToggleVisible={() => setShowPassword((v) => !v)}
                disabled={busy}
              />
            )}
          </Field>
          {formData.masterPassword && <PasswordStrengthMeter strength={passwordStrength} />}
        </div>

        <Field label="ยืนยันรหัสผ่านหลัก" required error={formErrors.confirmPassword}>
          {(props) => (
            <PasswordInput
              {...props}
              name="confirmPassword"
              autoComplete="new-password"
              value={formData.confirmPassword}
              onChange={handleChange}
              visible={showPassword}
              placeholder="กรอกรหัสผ่านหลักอีกครั้ง"
              disabled={busy}
            />
          )}
        </Field>

        <Button type="submit" className="mt-1 w-full" loading={busy}>
          {derivingKeys ? 'กำลังเตรียมกุญแจเข้ารหัส…' : loading ? 'กำลังสมัครสมาชิก…' : 'สมัครสมาชิก'}
        </Button>

        <p className="text-center text-caption text-muted-foreground">
          รหัสผ่านหลักไม่ถูกส่งไปยังเซิร์ฟเวอร์ ระบบใช้รหัสนี้สร้างกุญแจเข้ารหัสบนเบราว์เซอร์ของคุณ ซึ่งอาจใช้เวลา 1–2 วินาที
        </p>
      </form>
      <DerivingStatus active={derivingKeys} />
    </AuthCard>
  );
}

export default RegisterView;
