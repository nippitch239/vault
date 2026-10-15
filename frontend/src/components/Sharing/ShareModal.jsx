import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { ShareIcon, LockIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import {
  Button,
  Input,
  Field,
  Alert,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/index.js';
import { itemFields } from '../../lib/item-fields.js';

const PERMISSION_OPTIONS = [
  { value: 'read', label: 'อ่านอย่างเดียว', hint: 'ดูและคัดลอกรหัสผ่านได้ แก้ไขไม่ได้' },
  { value: 'modify', label: 'แก้ไขได้', hint: 'ดู แก้ไข และบันทึกเวอร์ชันใหม่ได้' },
];

export function ShareModal({ isOpen, item, onClose, onSuccess }) {
  const { mek } = useAuth();
  const { addToast } = useToast();

  const [recipientEmail, setRecipientEmail] = useState('');
  const [permissionLevel, setPermissionLevel] = useState('read'); // 'read' or 'modify'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [emailError, setEmailError] = useState(null);

  useEffect(() => {
    if (isOpen && item) {
      setRecipientEmail('');
      setPermissionLevel('read');
      setError(null);
      setEmailError(null);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const { title, locked } = itemFields(item);

  const handleShare = async (e) => {
    e.preventDefault();
    const email = recipientEmail.trim();
    if (!email) {
      setEmailError('กรุณากรอกอีเมลของผู้รับ');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      setEmailError('รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com');
      return;
    }
    if (!mek) {
      setError('คลังรหัสผ่านถูกล็อก กรุณาปลดล็อกก่อนแชร์');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Look up recipient to obtain their public key
      const lookupRes = await api.sharing.lookupUser(recipientEmail.trim().toLowerCase());
      const recipient = lookupRes?.data;
      if (!recipient || !recipient.public_key) {
        throw new Error('ไม่พบผู้รับ หรือผู้รับยังตั้งค่าบัญชีไม่เสร็จ จึงยังรับการแชร์ไม่ได้');
      }

      // 2. Generate a fresh 32-byte symmetric Item Key
      const itemKey = ClientCrypto.generateItemKey();

      // 3. Wrap (encrypt) the Item Key using recipient's RSA-OAEP public key
      const wrappedKeyPayload = await ClientCrypto.wrapItemKey(itemKey, recipient.public_key);

      // 4. Send share request to server
      const itemId = item.item_id || item.id;
      await api.sharing.shareItem(
        itemId,
        {
          recipient_email: recipient.email,
          recipient_user_id: recipient.user_id,
          permission_level: permissionLevel,
          encrypted_key_for_recipient: wrappedKeyPayload,
        },
        item.vault_id
      );

      addToast(`แชร์ให้ ${recipient.email} แล้ว`, 'success');
      setRecipientEmail('');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'แชร์ไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-w-md" dismissible={!loading}>
        <form onSubmit={handleShare} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShareIcon className="size-5 shrink-0 text-muted-foreground" />
              แชร์รายการ
            </DialogTitle>
            <DialogDescription className="truncate">{locked ? 'รายการที่ถอดรหัสไม่ได้' : title}</DialogDescription>
          </DialogHeader>

          {error && <Alert variant="error">{error}</Alert>}

          <Field label="อีเมลของผู้รับ" required error={emailError}>
            {(props) => (
              <Input
                {...props}
                data-autofocus
                type="email"
                autoComplete="off"
                value={recipientEmail}
                placeholder="name@example.com"
                onChange={(e) => {
                  setRecipientEmail(e.target.value);
                  setEmailError(null);
                  setError(null);
                }}
              />
            )}
          </Field>

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-ui">สิทธิ์ของผู้รับ</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMISSION_OPTIONS.map((opt) => {
                const checked = permissionLevel === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors duration-fast has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                      checked ? 'border-input bg-accent' : 'border-border hover:bg-accent/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="share-permission"
                      value={opt.value}
                      checked={checked}
                      onChange={() => setPermissionLevel(opt.value)}
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span className="grid gap-0.5">
                      <span className="text-sm font-ui">{opt.label}</span>
                      <span className="text-caption text-muted-foreground">{opt.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <LockIcon className="mt-0.5 size-4 shrink-0" />
            คีย์ของรายการจะถูกเข้ารหัสให้เฉพาะผู้รับก่อนส่ง เซิร์ฟเวอร์จึงอ่านรหัสผ่านไม่ได้
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              ยกเลิก
            </Button>
            <Button type="submit" loading={loading}>
              แชร์
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ShareModal;
