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
import { encryptForSave, fetchCollectionKey, openItemKey } from '../../lib/item-crypto.js';

const PERMISSION_OPTIONS = [
  { value: 'read', label: 'อ่านอย่างเดียว', hint: 'ดูและคัดลอกรหัสผ่านได้ แก้ไขไม่ได้' },
  { value: 'modify', label: 'แก้ไขได้', hint: 'ดู แก้ไข และบันทึกเวอร์ชันใหม่ได้' },
];

export function ShareModal({ isOpen, item, onClose, onSuccess }) {
  const { mek, privateKey } = useAuth();
  const { addToast } = useToast();

  const [recipientUsername, setRecipientUsername] = useState('');
  const [permissionLevel, setPermissionLevel] = useState('read'); // 'read' or 'modify'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [usernameError, setUsernameError] = useState(null);

  useEffect(() => {
    if (isOpen && item) {
      setRecipientUsername('');
      setPermissionLevel('read');
      setError(null);
      setUsernameError(null);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const { title, locked } = itemFields(item);

  /**
   * The item's Item Key. An item saved before per-item keys has none (its data is under the
   * Vault Key, which must never be shared), so it is re-saved with a fresh Item Key first.
   */
  const ensureItemKey = async () => {
    const collectionId = item._collectionId || item.metadata?.collection_id || '';
    const collectionKey = await fetchCollectionKey(collectionId, privateKey);
    if (item.encrypted_item_key) {
      const itemKey = await openItemKey(item, { mek, collectionKey, privateKey });
      if (!itemKey) throw new Error('เปิดคีย์ของรายการนี้ไม่ได้ ลองโหลดหน้าใหม่แล้วแชร์อีกครั้ง');
      return itemKey;
    }
    if (!item._decrypted) throw new Error('ยังถอดรหัสรายการนี้ไม่ได้ จึงแชร์ไม่ได้');
    if (collectionId && !collectionKey) {
      throw new Error('คุณยังไม่มีคีย์ของคอลเลกชันที่รายการนี้อยู่ จึงแชร์ไม่ได้');
    }
    const itemKey = ClientCrypto.generateItemKey();
    const encrypted = await encryptForSave(item._decrypted, { isOwner: true, itemKey, mek, targetCollectionKey: collectionKey });
    await api.vault.updateItem(
      item.item_id || item.id,
      { item_type: item.item_type || 'login', ...encrypted, metadata: item.metadata || {}, version: item.version },
      item.vault_id
    );
    return itemKey;
  };

  const handleShare = async (e) => {
    e.preventDefault();
    const username = recipientUsername.trim().toLowerCase();
    if (!username) {
      setUsernameError('กรุณากรอกชื่อผู้ใช้ของผู้รับ');
      return;
    }
    if (!mek || !privateKey) {
      setError('คลังรหัสผ่านถูกล็อก กรุณาปลดล็อกก่อนแชร์');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Look up the recipient (only people in your groups) to get their public key
      let recipient;
      try {
        recipient = (await api.sharing.lookupUser(username))?.data;
      } catch (err) {
        if (err?.status === 404) {
          setUsernameError('ไม่พบชื่อผู้ใช้นี้ในกลุ่มของคุณ แชร์ได้เฉพาะคนที่อยู่กลุ่มเดียวกัน');
          return;
        }
        throw err;
      }
      if (!recipient?.public_key) {
        throw new Error('ผู้รับยังตั้งค่าบัญชีไม่เสร็จ จึงยังรับการแชร์ไม่ได้');
      }

      // 2. Wrap this item's own key (never the Vault Key) with the recipient's public key
      const itemKey = await ensureItemKey();
      const wrappedKeyPayload = await ClientCrypto.wrapItemKey(itemKey, recipient.public_key);

      // 3. Send share request to server
      await api.sharing.shareItem(
        item.item_id || item.id,
        {
          recipient_user_id: recipient.user_id,
          permission_level: permissionLevel,
          encrypted_key_for_recipient: wrappedKeyPayload,
        },
        item.vault_id
      );

      addToast(`แชร์ให้ ${recipient.full_name || recipient.username} แล้ว`, 'success');
      setRecipientUsername('');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(
        err?.status === 409
          ? 'รายการนี้ถูกแก้ไขจากที่อื่นระหว่างแชร์ โหลดรายการใหม่แล้วลองอีกครั้ง'
          : err.message || 'แชร์ไม่สำเร็จ ลองอีกครั้ง'
      );
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

          <Field
            label="ชื่อผู้ใช้ของผู้รับ"
            required
            error={usernameError}
            hint="แชร์ได้เฉพาะคนที่อยู่กลุ่มเดียวกับคุณ"
          >
            {(props) => (
              <Input
                {...props}
                data-autofocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={recipientUsername}
                placeholder="เช่น somchai"
                onChange={(e) => {
                  setRecipientUsername(e.target.value);
                  setUsernameError(null);
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
            ผู้รับได้เฉพาะคีย์ของรายการนี้ ซึ่งเข้ารหัสให้ผู้รับก่อนส่ง เซิร์ฟเวอร์จึงอ่านรหัสผ่านไม่ได้
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
