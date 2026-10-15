import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { ShieldIcon, EyeIcon, EyeOffIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { Button, Card, Input, Field, Alert, cn } from '../ui/index.js';
import { MfaModal } from './MfaModal.jsx';

/* ------------------------------------------------------------------------------------------
 * Shared building blocks for the signed-out screens (Login / Register / Confirm / Reset).
 * ---------------------------------------------------------------------------------------- */

/** Centered auth card with the product mark, page title and description. */
export function AuthCard({ title, description, children, footer, size = 'sm' }) {
  return (
    <div className={cn('mx-auto w-full', size === 'md' ? 'max-w-md' : 'max-w-sm')}>
      <div className="mb-6 flex items-center justify-center gap-2 text-foreground">
        <span
          className="flex size-8 items-center justify-center rounded-md border border-border bg-secondary text-primary"
          aria-hidden="true"
        >
          <ShieldIcon className="size-4" />
        </span>
        <span className="text-sm font-strong tracking-tight">SecureVault</span>
      </div>

      <Card className="rounded-xl p-6 sm:p-7">
        <div className="mb-6 grid gap-1.5 text-center">
          <h1 className="text-2xl tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {children}
      </Card>

      {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Password input with an accessible show/hide toggle. Spread Field's render props into it. */
export const PasswordInput = React.forwardRef(({ visible, onToggleVisible, className, ...props }, ref) => (
  <div className="relative">
    <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-11', className)} {...props} />
    {onToggleVisible && (
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
        onClick={onToggleVisible}
        aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        aria-pressed={visible}
        aria-controls={props.id}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    )}
  </div>
));
PasswordInput.displayName = 'PasswordInput';

const STRENGTH_BAR = ['bg-error-foreground', 'bg-error-foreground', 'bg-warning-foreground', 'bg-info-foreground', 'bg-success-foreground'];

/** Strength meter for ClientCrypto.calculateStrength() results: segmented bar + text label. */
export function PasswordStrengthMeter({ strength }) {
  if (!strength) return null;
  const score = Math.max(0, Math.min(4, strength.score ?? 0));
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn('h-1 flex-1 rounded-full transition-colors duration-fast', score >= step ? STRENGTH_BAR[score] : 'bg-muted')}
          />
        ))}
      </div>
      <p className="flex items-center justify-between text-caption text-muted-foreground">
        <span>
          ความแข็งแรง: <span className="font-ui text-foreground">{strength.label?.th}</span>
        </span>
        {typeof strength.entropyBits === 'number' && <span className="font-mono text-xs">{strength.entropyBits} บิต</span>}
      </p>
    </div>
  );
}

/** Polite live region that announces the key-derivation step to screen readers. */
export function DerivingStatus({ active, message = 'กำลังเตรียมกุญแจเข้ารหัส…' }) {
  return (
    <p className="sr-only" aria-live="polite">
      {active ? message : ''}
    </p>
  );
}

/* ------------------------------------------------------------------------------------------ */

export function LoginView({ onNavigateRegister, onNavigateReset, onNavigateConfirm, onSuccess }) {
  const { login, loading, error: authError, setError } = useAuth();
  const { addToast } = useToast();

  const [identifier, setIdentifier] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  // MFA Challenge modal state
  const [mfaChallenge, setMfaChallenge] = useState(null);

  const busy = loading || deriving;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!identifier.trim()) errs.identifier = 'กรอกชื่อผู้ใช้หรืออีเมล';
    if (!masterPassword) errs.masterPassword = 'กรอกรหัสผ่านหลัก';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError(null);
      return;
    }

    try {
      setDeriving(true);
      const res = await login({
        identifier: identifier.trim(),
        masterPassword,
      });

      if (res?.mfaRequired) {
        setMfaChallenge({ mfaType: res.mfaType });
      } else if (res?.confirmationRequired) {
        addToast('บัญชียังไม่ได้ยืนยันอีเมล กรอกรหัสยืนยันเพื่อดำเนินการต่อ', 'info');
        if (onNavigateConfirm) onNavigateConfirm(res.identifier);
      } else if (res?.success) {
        addToast('เข้าสู่ระบบและปลดล็อกคลังแล้ว', 'success');
        if (onSuccess) onSuccess();
      }
    } catch (err) {
      // Handled in context
    } finally {
      setDeriving(false);
    }
  };

  return (
    <AuthCard
      title="เข้าสู่ระบบ"
      description="ใช้รหัสผ่านหลักเพื่อปลดล็อกคลังรหัสผ่านของคุณ"
      footer={
        <>
          ยังไม่มีบัญชี?{' '}
          <Button variant="link" className="h-auto p-0" onClick={onNavigateRegister}>
            สมัครสมาชิก
          </Button>
        </>
      }
    >
      {authError && (
        <Alert variant="error" className="mb-5">
          {authError}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="grid gap-4" noValidate aria-busy={busy || undefined}>
        <Field label="ชื่อผู้ใช้หรืออีเมล" error={fieldErrors.identifier}>
          {(props) => (
            <Input
              {...props}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (fieldErrors.identifier) setFieldErrors((p) => ({ ...p, identifier: null }));
                setError(null);
              }}
              placeholder="เช่น alice หรือ alice@example.com"
              disabled={busy}
              autoFocus
            />
          )}
        </Field>

        <div className="grid gap-1.5">
          <Field label="รหัสผ่านหลัก" error={fieldErrors.masterPassword}>
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="current-password"
                value={masterPassword}
                onChange={(e) => {
                  setMasterPassword(e.target.value);
                  if (fieldErrors.masterPassword) setFieldErrors((p) => ({ ...p, masterPassword: null }));
                  setError(null);
                }}
                visible={showPassword}
                onToggleVisible={() => setShowPassword((v) => !v)}
                disabled={busy}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button variant="link" size="sm" className="h-auto p-0" onClick={onNavigateReset}>
              ลืมรหัสผ่านหลัก?
            </Button>
          </div>
        </div>

        <Button type="submit" className="mt-1 w-full" loading={busy}>
          {deriving ? 'กำลังเตรียมกุญแจเข้ารหัส…' : loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </Button>

        <p className="text-center text-caption text-muted-foreground">
          รหัสผ่านหลักไม่ถูกส่งออกจากเครื่องนี้ กุญแจถอดรหัสถูกเก็บไว้ในหน่วยความจำชั่วคราวเท่านั้น
        </p>
      </form>
      <DerivingStatus active={deriving} />

      {/* MFA Challenge Modal */}
      {mfaChallenge && (
        <MfaModal
          isOpen={true}
          mode="challenge"
          onClose={() => setMfaChallenge(null)}
          onSuccess={() => {
            setMfaChallenge(null);
            if (onSuccess) onSuccess();
          }}
        />
      )}
    </AuthCard>
  );
}

export default LoginView;
