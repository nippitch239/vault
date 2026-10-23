import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { ShareIcon, CloseIcon, CheckIcon, KeyIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { Button } from '../ui/Button.jsx';
import { Input } from '../ui/Input.jsx';
import { Badge } from '../ui/Badge.jsx';

export function ShareModal({ isOpen, item, onClose, onSuccess }) {
  const { mek } = useAuth();
  const { addToast } = useToast();

  const [recipientEmail, setRecipientEmail] = useState('');
  const [permissionLevel, setPermissionLevel] = useState('read'); // 'read' or 'modify'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && item) {
      setRecipientEmail('');
      setPermissionLevel('read');
      setError(null);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const handleShare = async (e) => {
    e.preventDefault();
    if (!recipientEmail.trim()) {
      setError('กรุณากรอกอีเมลผู้รับ (Recipient email is required)');
      return;
    }
    if (!mek) {
      setError('คลังรหัสผ่านถูกล็อกอยู่ กรุณาปลดล็อกเพื่อแชร์รหัสผ่าน');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Look up recipient to obtain their public key
      const lookupRes = await api.sharing.lookupUser(recipientEmail.trim().toLowerCase());
      const recipient = lookupRes?.data;
      if (!recipient || !recipient.public_key) {
        throw new Error('ไม่พบคีย์สาธารณะของผู้รับ หรือผู้รับยังไม่ได้ลงทะเบียนในระบบ');
      }

      const itemId = item.item_id || item.id;

      // 2. Get the item's own Item Key. The first time an item is shared, re-encrypt it
      //    with a fresh Item Key (kept for the owner as `owner_key`) so the recipient can read it.
      let itemKey = await ClientCrypto.getOwnerItemKey(item.encrypted_data, mek);
      if (!itemKey) {
        if (item._collectionId || item.metadata?.collection_id) {
          throw new Error('รายการนี้อยู่ในคอลเลกชัน กรุณาแชร์ผ่านคอลเลกชันแทน');
        }
        const plainPayload =
          item._decrypted || (await ClientCrypto.decryptItem(item.encrypted_data, mek));
        const envelope = await ClientCrypto.createSharedEnvelope(plainPayload, mek);
        await api.vault.updateItem(
          itemId,
          {
            item_type: item.item_type,
            encrypted_data: envelope.encryptedData,
            metadata: item.metadata,
            version: item.version,
          },
          item.vault_id
        );
        itemKey = envelope.itemKey;
      }

      // 3. Wrap (encrypt) the Item Key using recipient's RSA-OAEP public key
      const wrappedKeyPayload = await ClientCrypto.wrapItemKey(itemKey, recipient.public_key);

      // 4. Send share request to server
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

      addToast(`แชร์รหัสผ่านให้กับ ${recipient.email} สำเร็จ!`, 'success');
      setRecipientEmail('');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'ไม่สามารถแชร์รหัสผ่านได้');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-background/80 backdrop-blur-sm animate-content-show"
    >
      <div className="relative w-full max-w-md max-h-[85vh] flex flex-col bg-card text-card-foreground border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Fixed Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <ShareIcon className="size-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-foreground">
                แชร์รหัสผ่าน (Share Item)
              </h3>
              <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                {item.metadata?.title || item.title || 'Untitled Item'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring text-muted-foreground hover:text-foreground p-1"
            aria-label="Close"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <form id="share-modal-form" onSubmit={handleShare} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="p-3 bg-destructive/15 border border-destructive/30 rounded-lg text-destructive text-xs font-medium">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="recipient-email" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
              อีเมลผู้รับ (Recipient Email) *
            </label>
            <Input
              id="recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(e) => {
                setRecipientEmail(e.target.value);
                setError(null);
              }}
              placeholder="colleague@example.com"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider">
              ระดับสิทธิ์การเข้าถึง (Permission Level)
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <label
                className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${
                  permissionLevel === 'read'
                    ? 'bg-primary/10 border-primary text-foreground'
                    : 'bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-xs">อ่านอย่างเดียว (READ)</span>
                  <input
                    type="radio"
                    name="permission"
                    value="read"
                    checked={permissionLevel === 'read'}
                    onChange={() => setPermissionLevel('read')}
                    className="size-4 text-primary focus:ring-ring"
                  />
                </div>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  ดูและคัดลอกรหัสผ่านได้ ไม่สามารถแก้ไขได้
                </span>
              </label>

              <label
                className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${
                  permissionLevel === 'modify'
                    ? 'bg-primary/10 border-primary text-foreground'
                    : 'bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-xs">แก้ไขได้ (MODIFY)</span>
                  <input
                    type="radio"
                    name="permission"
                    value="modify"
                    checked={permissionLevel === 'modify'}
                    onChange={() => setPermissionLevel('modify')}
                    className="size-4 text-primary focus:ring-ring"
                  />
                </div>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  ดู แก้ไข และบันทึกเวอร์ชันใหม่ได้
                </span>
              </label>
            </div>
          </div>

          {/* Zero-Knowledge Sharing Security Info */}
          <div className="p-3 bg-muted/40 rounded-xl border border-border text-xs text-muted-foreground flex items-start space-x-2.5">
            <KeyIcon className="size-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              กุญแจรหัสผ่านจะถูกเข้ารหัสแบบอสมมาตร (RSA-OAEP-256) ด้วยกุญแจสาธารณะของผู้รับ เซิร์ฟเวอร์ไม่สามารถถอดรหัสข้อความได้ (Zero-Knowledge)
            </p>
          </div>
        </form>

        {/* Fixed Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-muted/30 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            ยกเลิก (Cancel)
          </Button>
          <Button
            type="submit"
            form="share-modal-form"
            disabled={loading}
            className="flex items-center space-x-1.5 shadow-sm"
          >
            <CheckIcon className="size-4" />
            <span>{loading ? 'กำลังเข้ารหัสและแชร์...' : 'แชร์รหัสผ่าน'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ShareModal;
