import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../../context/AuthContext.jsx';
import { CopyIcon, CheckIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import {
  Button,
  Input,
  Field,
  Alert,
  Skeleton,
  Spinner,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/index.js';

const CODE_ERROR = 'รหัสต้องเป็นตัวเลข 6 หลัก';

/** Groups the base32 secret in blocks of 4 for easier manual entry (display only). */
const formatSecret = (secret) => (secret || '').replace(/(.{4})(?=.)/g, '$1 ');

export function MfaModal({ isOpen, onClose, mode = 'setup', onSuccess }) {
  const { completeMfaLogin, setupTotp, verifyTotp } = useAuth();
  const { addToast } = useToast();

  const [setupData, setSetupData] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [codeError, setCodeError] = useState(null);
  const [setupFailed, setSetupFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);

  const loadSetup = () => {
    setCode('');
    setError(null);
    setCodeError(null);
    setSetupFailed(false);
    setLoading(true);
    setupTotp()
      .then((details) => {
        setSetupData({ secret: details.sharedSecret, otpauth_url: details.otpauthUrl });
      })
      .catch((err) => {
        setSetupFailed(true);
        setError(err.message || 'เริ่มตั้งค่าการยืนยันตัวตนสองขั้นตอนไม่สำเร็จ ลองอีกครั้ง');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // Load MFA setup details when in 'setup' mode
  useEffect(() => {
    if (isOpen && mode === 'setup') {
      loadSetup();
    } else if (isOpen && mode === 'challenge') {
      setCode('');
      setError(null);
      setCodeError(null);
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

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  if (!isOpen) return null;

  const handleCopySecret = async () => {
    if (!setupData?.secret) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setCopied(true);
      addToast('คัดลอกคีย์แล้ว', 'success');
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('คัดลอกไม่สำเร็จ เลือกข้อความแล้วคัดลอกเอง', 'error');
    }
  };

  const handleVerifySetup = async (e) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      setCodeError(CODE_ERROR);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await verifyTotp({ code: code.trim() });
      addToast('เปิดการยืนยันตัวตนสองขั้นตอนแล้ว', 'success');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'รหัสยืนยันไม่ถูกต้อง ตรวจสอบรหัสในแอปแล้วลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyChallenge = async (e) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      setCodeError(CODE_ERROR);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await completeMfaLogin({ code: code.trim() });
      addToast('ยืนยันตัวตนแล้ว ปลดล็อกคลังเรียบร้อย', 'success');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'รหัสยืนยันไม่ถูกต้อง ตรวจสอบรหัสในแอปแล้วลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  const isSetup = mode === 'setup';
  // Verifying a code (not the initial setup load) must not be interrupted.
  const submitting = loading && (!isSetup || !!setupData);
  const formId = isSetup ? 'mfa-setup-form' : 'mfa-challenge-form';

  const codeField = (
    <Field
      label="รหัส 6 หลักจากแอป"
      hint="รหัสในแอปจะเปลี่ยนทุก 30 วินาที"
      error={codeError}
    >
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
            if (codeError) setCodeError(null);
          }}
          placeholder="000000"
          className="h-11 text-center font-mono text-lg tracking-[0.4em]"
          disabled={loading}
          autoFocus
          data-autofocus
        />
      )}
    </Field>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-md" dismissible={!submitting}>
        <DialogHeader>
          <DialogTitle>{isSetup ? 'เปิดการยืนยันตัวตนสองขั้นตอน (2FA)' : 'ยืนยันตัวตนสองขั้นตอน'}</DialogTitle>
          <DialogDescription>
            {isSetup
              ? 'เชื่อมบัญชีกับแอปยืนยันตัวตน เช่น Google Authenticator หรือ Microsoft Authenticator'
              : 'เปิดแอปยืนยันตัวตนแล้วกรอกรหัส 6 หลักเพื่อปลดล็อกคลังรหัสผ่าน'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert
            variant="error"
            action={
              isSetup && setupFailed ? (
                <Button variant="outline" size="sm" onClick={loadSetup} disabled={loading}>
                  ลองอีกครั้ง
                </Button>
              ) : null
            }
          >
            {error}
          </Alert>
        )}

        {isSetup ? (
          loading && !setupData ? (
            <div className="grid gap-4" aria-busy="true">
              <div className="flex justify-center">
                <Spinner label="กำลังสร้างคีย์สำหรับบัญชีของคุณ" />
              </div>
              <Skeleton className="mx-auto size-40 rounded-lg" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : setupData ? (
            <form id={formId} onSubmit={handleVerifySetup} className="grid gap-5" noValidate aria-busy={loading || undefined}>
              <div className="grid gap-5">
                <div className="grid gap-3">
                  <p className="text-sm font-ui">1. สแกนคิวอาร์โค้ดด้วยแอปยืนยันตัวตน</p>
                  <div className="mx-auto flex size-44 items-center justify-center rounded-lg border border-border bg-card p-2">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="คิวอาร์โค้ดสำหรับเพิ่มบัญชีในแอปยืนยันตัวตน"
                        className="size-40 rounded-md object-contain"
                      />
                    ) : (
                      <Skeleton className="size-40" />
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  <p className="text-sm font-ui">หรือกรอกคีย์นี้ในแอปด้วยตนเอง</p>
                  <div className="flex items-center gap-2 rounded-md border border-border bg-secondary py-1 pl-3 pr-1">
                    <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground select-all">
                      {formatSecret(setupData.secret)}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleCopySecret}
                      aria-label={copied ? 'คัดลอกคีย์แล้ว' : 'คัดลอกคีย์'}
                    >
                      {copied ? <CheckIcon /> : <CopyIcon />}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <p className="text-sm font-ui">2. กรอกรหัสที่แอปแสดงเพื่อยืนยัน</p>
                  {codeField}
                </div>
              </div>
            </form>
          ) : null
        ) : (
          <form id={formId} onSubmit={handleVerifyChallenge} className="grid gap-4" noValidate aria-busy={loading || undefined}>
            {codeField}
          </form>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            ยกเลิก
          </Button>
          {(!isSetup || setupData) && (
            <Button type="submit" form={formId} loading={submitting}>
              {submitting
                ? isSetup
                  ? 'กำลังตรวจสอบ…'
                  : 'กำลังปลดล็อกคลัง…'
                : isSetup
                  ? 'ยืนยันและเปิดใช้'
                  : 'ยืนยัน'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MfaModal;
