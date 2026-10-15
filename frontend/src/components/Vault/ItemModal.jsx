import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { PasswordGenerator } from '../Common/PasswordGenerator.jsx';
import { CloseIcon, KeyIcon, EyeIcon, EyeOffIcon, CheckIcon, StarIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { Button } from '../ui/Button.jsx';
import { Input } from '../ui/Input.jsx';
import { Badge } from '../ui/Badge.jsx';

export function ItemModal({ isOpen, item = null, onClose, onSuccess }) {
  const { mek, privateKey } = useAuth();
  const { addToast } = useToast();

  const isEditing = Boolean(item);

  const [collections, setCollections] = useState([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');

  const [formData, setFormData] = useState({
    title: '',
    category: 'LOGIN',
    url: '',
    username: '',
    password: '',
    notes: '',
    tags: '',
    favorite: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (isOpen) {
      // Load collections the user can write to (only those can receive the item)
      api.collections
        .list()
        .then((res) => {
          if (!cancelled) {
            setCollections((res?.collections || []).filter((c) => ['write', 'admin'].includes(c.effectivePermission)));
          }
        })
        .catch(() => {
          if (!cancelled) setCollections([]);
        });

      if (item) {
        // If editing existing item, load its decrypted fields if available
        const meta = item.metadata || {};
        const decrypted = item._decrypted || {};
        const colId =
          item.collection_id ||
          item._collectionId ||
          item.collectionId ||
          meta.collection_id ||
          '';
        setSelectedCollectionId(colId);

        setFormData({
          title: meta.title || item.title || '',
          category: item.item_type ? item.item_type.toUpperCase() : (item.category || 'LOGIN'),
          url: decrypted.url || meta.url || '',
          username: decrypted.username || meta.username_preview || '',
          password: decrypted.password || '',
          notes: decrypted.notes || '',
          tags: Array.isArray(meta.tags) ? meta.tags.join(', ') : '',
          favorite: Boolean(meta.favorite),
        });
      } else {
        // Adding new item
        setSelectedCollectionId('');
        setFormData({
          title: '',
          category: 'LOGIN',
          url: '',
          username: '',
          password: '',
          notes: '',
          tags: '',
          favorite: false,
        });
      }
      setShowGenerator(false);
      setError(null);
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, item]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    setError(null);
  };

  const handlePasswordSelected = (genPassword) => {
    setFormData((prev) => ({ ...prev, password: genPassword }));
    setShowGenerator(false);
    addToast('นำรหัสผ่านที่สุ่มได้มาใส่ในฟอร์มแล้ว (Generated password applied)', 'info');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      setError('กรุณาระบุชื่อรายการ (Title is required)');
      return;
    }
    if (!formData.password) {
      setError('กรุณาระบุรหัสผ่าน (Password is required)');
      return;
    }
    if (!mek) {
      setError('คลังรหัสผ่านถูกล็อกอยู่ ไม่สามารถเข้ารหัสได้ กรุณาปลดล็อกคลังรหัสผ่าน');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Prepare sensitive plaintext payload to encrypt
      const sensitivePayload = {
        title: formData.title.trim(),
        username: formData.username.trim(),
        password: formData.password,
        url: formData.url.trim(),
        notes: formData.notes.trim(),
        updatedAt: new Date().toISOString(),
      };

      // 2. Encrypt using collection key if collection selected, otherwise fallback to MEK
      let encryptedData;
      if (selectedCollectionId) {
        if (!privateKey) {
          throw new Error('คีย์ส่วนตัวถูกล็อกอยู่ กรุณาปลดล็อกคลังรหัสผ่านก่อนบันทึกรายการในคอลเลกชัน');
        }
        const keyRes = await api.collections.getKeys(selectedCollectionId);
        const wrappedPayload =
          keyRes?.key?.encrypted_key_for_recipient ||
          keyRes?.key?.encryptedKeyForRecipient ||
          keyRes?.encrypted_key_for_recipient ||
          keyRes?.encryptedKeyForRecipient ||
          keyRes?.key ||
          keyRes;

        const colKey = await ClientCrypto.unwrapCollectionKey(wrappedPayload, privateKey);
        encryptedData = await ClientCrypto.encryptCollectionItem(sensitivePayload, colKey);
      } else {
        encryptedData = await ClientCrypto.encryptItem(sensitivePayload, mek);
      }

      // 3. Prepare metadata (unencrypted indexable attributes)
      const tagsArray = formData.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const metadata = {
        title: formData.title.trim(),
        url: formData.url.trim(),
        username_preview: formData.username.trim(),
        favorite: formData.favorite,
        tags: tagsArray,
        ...(selectedCollectionId ? { collection_id: selectedCollectionId } : {}),
      };

      const itemType = formData.category.toLowerCase();
      let savedItemId = null;

      if (isEditing) {
        // UC-5: Update Vault Item
        savedItemId = item.item_id || item.id;
        await api.vault.updateItem(
          savedItemId,
          {
            item_type: itemType,
            encrypted_data: encryptedData,
            metadata,
            version: item.version,
          },
          item.vault_id
        );
        addToast('แก้ไขข้อมูลรหัสผ่านสำเร็จ (Updated successfully)', 'success');
      } else {
        // UC-4: Add Vault Item
        const createRes = await api.vault.createItem({
          item_type: itemType,
          encrypted_data: encryptedData,
          metadata,
        });
        savedItemId =
          createRes?.data?.item_id ||
          createRes?.data?.id ||
          createRes?.item?.item_id ||
          createRes?.item_id;
        addToast('เพิ่มรายการรหัสผ่านใหม่สำเร็จ (Added successfully)', 'success');
      }

      // 4. Keep the collection link in sync with the key the item is now encrypted with.
      const previousCollectionId = isEditing
        ? item._collectionId || item.collection_id || item.metadata?.collection_id || ''
        : '';
      let linkError = null;
      if (savedItemId && previousCollectionId && previousCollectionId !== selectedCollectionId) {
        try {
          await api.collections.removeItem(previousCollectionId, savedItemId);
        } catch (err) {
          if (err?.status !== 404) linkError = err;
        }
      }
      if (savedItemId && selectedCollectionId && selectedCollectionId !== previousCollectionId) {
        try {
          await api.collections.addItem(selectedCollectionId, { itemId: savedItemId });
        } catch (err) {
          if (err?.status !== 409) linkError = err;
        }
      }
      if (linkError) {
        addToast(`บันทึกรายการแล้ว แต่ปรับคอลเลกชันไม่สำเร็จ: ${linkError.message}`, 'error', 8000);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
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
      <div className="relative w-full max-w-lg md:max-w-xl max-h-[85vh] flex flex-col bg-card text-card-foreground border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Fixed Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <KeyIcon className="size-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-foreground">
                {isEditing ? `แก้ไขรหัสผ่าน (v${item.version || 1})` : 'เพิ่มรหัสผ่านใหม่ (Add Password)'}
              </h3>
              <p className="text-xs text-muted-foreground">
                เข้ารหัสแบบ AES-256-GCM อัตโนมัติ (Zero-Knowledge)
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
        <form id="item-modal-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-h-[calc(85vh-130px)]">
          {error && (
            <div className="p-3 bg-destructive/15 border border-destructive/30 rounded-lg text-destructive text-xs font-medium">
              {error}
            </div>
          )}

          {/* Title & Favorite */}
          <div className="flex items-center space-x-3">
            <div className="flex-1 space-y-1">
              <label htmlFor="item-title" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                ชื่อรายการ (Title) *
              </label>
              <Input
                id="item-title"
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="เช่น GitHub, Google Workspace, AWS Console"
                required
              />
            </div>
            <div className="pt-5">
              <Button
                type="button"
                variant={formData.favorite ? 'secondary' : 'outline'}
                size="icon"
                onClick={() => setFormData((p) => ({ ...p, favorite: !p.favorite }))}
                className={`size-10 rounded-md transition-colors ${
                  formData.favorite
                    ? 'border-warning/50 text-warning bg-warning/10 hover:bg-warning/20'
                    : 'text-muted-foreground'
                }`}
                title="รายการโปรด (Favorite)"
              >
                <StarIcon className="size-5" filled={formData.favorite} />
              </Button>
            </div>
          </div>

          {/* Category & Collection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="item-category" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                หมวดหมู่ (Category)
              </label>
              <select
                id="item-category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground"
              >
                <option value="LOGIN">บัญชีผู้ใช้ / เว็บไซต์ (Login)</option>
                <option value="SECURE_NOTE">บันทึกลับ (Secure Note)</option>
                <option value="CARD">บัตรเครดิต / การเงิน (Card)</option>
                <option value="SERVER">เซิร์ฟเวอร์ / SSH / Database (Server)</option>
                <option value="IDENTITY">ข้อมูลระบุตัวตน (Identity)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="item-collection" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                คอลเลกชัน (Collection)
              </label>
              <select
                id="item-collection"
                value={selectedCollectionId}
                onChange={(e) => setSelectedCollectionId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground"
              >
                <option value="">คลังส่วนตัว (Personal Vault)</option>
                {collections.map((c) => {
                  const cid = c.collection_id || c.id;
                  const perm = c.effective_permission || c.effectivePermission || 'member';
                  return (
                    <option key={cid} value={cid}>
                      📁 {c.name} ({perm})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Username & URL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="item-username" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                ชื่อผู้ใช้ / อีเมล (Username)
              </label>
              <Input
                id="item-username"
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="item-url" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                ที่อยู่เว็บไซต์ (Website URL)
              </label>
              <Input
                id="item-url"
                type="text"
                name="url"
                value={formData.url}
                onChange={handleChange}
                placeholder="https://example.com"
              />
            </div>
          </div>

          {/* Password with Generator Button */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="item-password" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                รหัสผ่าน (Password) *
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowGenerator(!showGenerator)}
                className="text-xs h-7 text-primary hover:text-primary font-medium flex items-center space-x-1 px-2"
              >
                <KeyIcon className="size-3.5" />
                <span>{showGenerator ? 'ซ่อนเครื่องมือสุ่ม' : 'สุ่มรหัสผ่าน (Generate)'}</span>
              </Button>
            </div>
            <div className="relative">
              <Input
                id="item-password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="กรอกรหัสผ่านหรือคลิกสุ่มรหัสผ่าน"
                className="pr-10 font-mono"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>

            {/* Embedded Password Generator Drawer */}
            {showGenerator && (
              <div className="mt-3 p-4 bg-muted/30 rounded-xl border border-primary/20 animate-content-show space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-border">
                  <Badge variant="outline" className="text-[11px] font-semibold text-primary">
                    เครื่องมือสุ่มรหัสผ่านในตัว (Embedded Generator)
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowGenerator(false)}
                    className="h-6 text-xs text-muted-foreground hover:text-foreground px-2"
                  >
                    ปิด
                  </Button>
                </div>
                <PasswordGenerator onSelect={handlePasswordSelected} isEmbedded={true} />
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label htmlFor="item-notes" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
              หมายเหตุลับ (Secure Notes)
            </label>
            <textarea
              id="item-notes"
              name="notes"
              rows={3}
              value={formData.notes}
              onChange={handleChange}
              placeholder="หมายเหตุเพิ่มเติม ข้อความลับ หรือรหัสสำรอง (จะถูกเข้ารหัส AES-256 เช่นกัน)"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground resize-none"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <label htmlFor="item-tags" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
              แท็ก (Tags, คั่นด้วยเครื่องหมายจุลภาค)
            </label>
            <Input
              id="item-tags"
              type="text"
              name="tags"
              value={formData.tags}
              onChange={handleChange}
              placeholder="work, personal, dev"
            />
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
            form="item-modal-form"
            disabled={loading}
            className="flex items-center space-x-1.5 shadow-sm"
          >
            <CheckIcon className="size-4" />
            <span>{loading ? 'กำลังเข้ารหัสและบันทึก...' : isEditing ? 'บันทึกการแก้ไข' : 'บันทึกรหัสผ่าน'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ItemModal;
