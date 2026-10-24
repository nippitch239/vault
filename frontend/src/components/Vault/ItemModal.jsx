import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import { PasswordGenerator } from '../Common/PasswordGenerator.jsx';
import { KeyIcon, EyeIcon, EyeOffIcon, LockIcon, CloseIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { Button, Input, Textarea, Select, Field, Alert, ConfirmDialog } from '../ui/index.js';
import { CATEGORY_OPTIONS } from './CategoryBadge.jsx';
import { buildMetadata } from '../../lib/item-fields.js';
import { encryptForSave, fetchCollectionKey, openItemKey } from '../../lib/item-crypto.js';

const PERMISSION_LABELS = { admin: 'ผู้ดูแล', write: 'แก้ไขได้', read: 'อ่านอย่างเดียว' };

const EMPTY_FORM = {
  title: '',
  category: 'LOGIN',
  url: '',
  username: '',
  password: '',
  notes: '',
  tags: '',
  favorite: false,
};

function ArrowLeftIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

function ChevronIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

const snapshotOf = (form, collectionId) => JSON.stringify({ ...form, collectionId });

/**
 * Add / edit item. Despite the historical name this renders as a full page inside the
 * vault area (the dashboard shows it in place of the list); props are unchanged.
 */
export function ItemModal({ isOpen, item = null, onClose, onSuccess }) {
  const { mek, privateKey, user } = useAuth();
  const { addToast } = useToast();

  const isEditing = Boolean(item);
  // Collection members with 'write' may edit an item, but only its owner may move it.
  const isOwner = !isEditing || !item.user_id || item.user_id === user?.user_id;

  const [collections, setCollections] = useState([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');

  const [formData, setFormData] = useState(EMPTY_FORM);

  const [showPassword, setShowPassword] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [showMore, setShowMore] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const initialSnapshotRef = useRef(snapshotOf(EMPTY_FORM, ''));
  const headingRef = useRef(null);
  const titleInputRef = useRef(null);
  const passwordInputRef = useRef(null);

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

        const next = {
          title: decrypted.title || '',
          category: item.item_type ? item.item_type.toUpperCase() : (item.category || 'LOGIN'),
          url: decrypted.url || '',
          username: decrypted.username || '',
          password: decrypted.password || '',
          notes: decrypted.notes || '',
          tags: Array.isArray(decrypted.tags) ? decrypted.tags.join(', ') : '',
          favorite: Boolean(meta.favorite),
        };
        setFormData(next);
        initialSnapshotRef.current = snapshotOf(next, colId);
        setShowMore(true);
      } else {
        // Adding new item
        setSelectedCollectionId('');
        setFormData(EMPTY_FORM);
        initialSnapshotRef.current = snapshotOf(EMPTY_FORM, '');
        setShowMore(false);
      }
      setShowGenerator(false);
      setShowPassword(false);
      setError(null);
      setFieldErrors({});
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, item]);

  const isDirty = snapshotOf(formData, selectedCollectionId) !== initialSnapshotRef.current;

  const requestClose = () => {
    if (loading) return;
    if (isDirty) setConfirmLeave(true);
    else onClose();
  };

  // Move focus to the page heading when the form opens (it replaces the list).
  useEffect(() => {
    if (isOpen) headingRef.current?.focus();
  }, [isOpen]);

  // Esc closes the generator first, then leaves the page (ignored while a dialog is open).
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (showGenerator) {
        setShowGenerator(false);
        return;
      }
      requestCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, showGenerator]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    setError(null);
    if (fieldErrors[name]) setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handlePasswordSelected = (genPassword) => {
    setFormData((prev) => ({ ...prev, password: genPassword }));
    setFieldErrors((prev) => ({ ...prev, password: undefined }));
    setShowGenerator(false);
    addToast('ใส่รหัสผ่านที่สร้างแล้ว', 'success');
    passwordInputRef.current?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!formData.title.trim()) errors.title = 'กรุณาระบุชื่อรายการ';
    if (!formData.password) errors.password = 'กรุณาระบุรหัสผ่าน หรือกด “สร้างรหัสผ่าน”';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      (errors.title ? titleInputRef : passwordInputRef).current?.focus();
      return;
    }
    if (!mek) {
      setError('คลังรหัสผ่านถูกล็อก จึงเข้ารหัสไม่ได้ กรุณาปลดล็อกคลังก่อนบันทึก');
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
        tags: formData.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        updatedAt: new Date().toISOString(),
      };

      // 2. Encrypt with the item's own Item Key. Its existing key is kept so people the item
      //    is shared with can still read it; the key is wrapped with the collection key when
      //    the item is in a collection, otherwise with the Vault Key.
      const previousCollectionId = isEditing
        ? item._collectionId || item.collection_id || item.metadata?.collection_id || ''
        : '';
      if ((selectedCollectionId || previousCollectionId) && !privateKey) {
        throw new Error('คลังรหัสผ่านถูกล็อก กรุณาปลดล็อกก่อนบันทึกรายการในคอลเลกชัน');
      }
      const currentCollectionKey = await fetchCollectionKey(previousCollectionId, privateKey);
      const targetCollectionKey =
        selectedCollectionId === previousCollectionId
          ? currentCollectionKey
          : await fetchCollectionKey(selectedCollectionId, privateKey);
      if (isOwner && selectedCollectionId && !targetCollectionKey) {
        throw new Error('คุณยังไม่มีคีย์ของคอลเลกชันนี้ กรุณาให้ผู้ดูแลคอลเลกชันส่งคีย์ให้ก่อน');
      }
      const itemKey = isEditing
        ? await openItemKey(item, { mek, collectionKey: currentCollectionKey, privateKey })
        : null;
      if (isEditing && (item.encrypted_item_key || item.encrypted_key_for_recipient) && !itemKey) {
        throw new Error('เปิดคีย์ของรายการนี้ไม่ได้ จึงบันทึกการแก้ไขไม่ได้ ลองโหลดหน้าใหม่');
      }
      const encrypted = await encryptForSave(sensitivePayload, {
        isOwner,
        itemKey,
        mek,
        targetCollectionKey: selectedCollectionId ? targetCollectionKey : null,
        legacyKey: currentCollectionKey,
      });

      // 3. Plaintext metadata: non-sensitive flags only (title/url/username/tags are encrypted)
      const metadata = buildMetadata({ favorite: formData.favorite, collectionId: selectedCollectionId });

      const itemType = formData.category.toLowerCase();
      let savedItemId = null;

      if (isEditing) {
        // UC-5: Update Vault Item
        savedItemId = item.item_id || item.id;
        await api.vault.updateItem(
          savedItemId,
          {
            item_type: itemType,
            ...encrypted,
            metadata,
            version: item.version,
          },
          item.vault_id
        );
        addToast('บันทึกการแก้ไขแล้ว', 'success');
      } else {
        // UC-4: Add Vault Item
        const createRes = await api.vault.createItem({
          item_type: itemType,
          ...encrypted,
          metadata,
        });
        savedItemId =
          createRes?.data?.item_id ||
          createRes?.data?.id ||
          createRes?.item?.item_id ||
          createRes?.item_id;
        addToast('เพิ่มรายการแล้ว', 'success');
      }

      // 4. Keep the collection link in sync with the key the Item Key is now wrapped with.
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
        addToast(`บันทึกรายการแล้ว แต่ย้ายคอลเลกชันไม่สำเร็จ: ${linkError.message}`, 'error', 8000);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'บันทึกรายการไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  const pageTitle = isEditing ? 'แก้ไขรายการ' : 'เพิ่มรายการ';
  const currentCollectionMissing =
    selectedCollectionId && !collections.some((c) => (c.collection_id || c.id) === selectedCollectionId);
  const moreSummary = [
    CATEGORY_OPTIONS.find((o) => o.value === formData.category)?.label,
    selectedCollectionId ? 'อยู่ในคอลเลกชัน' : 'คลังส่วนตัว',
    formData.favorite ? 'รายการโปรด' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const actions = (
    <>
      <Button variant="outline" onClick={requestClose} disabled={loading} className="flex-1 sm:flex-none">
        ยกเลิก
      </Button>
      <Button type="submit" form="item-form" loading={loading} className="flex-1 sm:flex-none">
        บันทึก
      </Button>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Button variant="ghost" size="sm" onClick={requestClose} disabled={loading} aria-label="กลับไปที่รายการ" className="-ml-3 text-muted-foreground">
        <ArrowLeftIcon />
        กลับไปที่รายการ
      </Button>

      <header className="mt-2 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl tracking-tight focus:outline-none">
            {pageTitle}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" />
            ข้อมูลถูกเข้ารหัสบนเครื่องคุณก่อนบันทึก
          </p>
        </div>
        <div className="hidden gap-2 sm:flex">{actions}</div>
      </header>

      <form id="item-form" onSubmit={handleSubmit} noValidate className="grid gap-8 py-6" aria-busy={loading}>
        {error && <Alert variant="error">{error}</Alert>}

        {/* Main details */}
        <section aria-labelledby="item-main-heading" className="grid gap-4">
          <h2 id="item-main-heading" className="text-base">
            ข้อมูลหลัก
          </h2>

          <Field label="ชื่อรายการ" required error={fieldErrors.title}>
            {(props) => (
              <Input
                {...props}
                ref={titleInputRef}
                name="title"
                autoComplete="off"
                value={formData.title}
                onChange={handleChange}
                placeholder="เช่น GitHub, Gmail ที่ทำงาน"
              />
            )}
          </Field>

          <Field label="ชื่อผู้ใช้หรืออีเมล">
            {(props) => (
              <Input
                {...props}
                name="username"
                autoComplete="off"
                value={formData.username}
                onChange={handleChange}
                placeholder="name@example.com"
              />
            )}
          </Field>

          <div className="grid gap-3">
            <Field label="รหัสผ่าน" required error={fieldErrors.password}>
              {(props) => (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <Input
                      {...props}
                      ref={passwordInputRef}
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      spellCheck={false}
                      value={formData.password}
                      onChange={handleChange}
                      className="pr-11 font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-pressed={showPassword}
                      aria-label="แสดงรหัสผ่าน"
                      className="absolute right-1 top-1 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </Button>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setShowGenerator((v) => !v)}
                    aria-expanded={showGenerator}
                    aria-controls="item-password-generator"
                  >
                    <KeyIcon />
                    สร้างรหัสผ่าน
                  </Button>
                </div>
              )}
            </Field>

            {showGenerator && (
              <div id="item-password-generator" role="region" aria-label="สร้างรหัสผ่าน" className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-ui">สร้างรหัสผ่าน</p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowGenerator(false)}
                    aria-label="ปิดตัวสร้างรหัสผ่าน"
                    className="text-muted-foreground"
                  >
                    <CloseIcon />
                  </Button>
                </div>
                <PasswordGenerator onSelect={handlePasswordSelected} isEmbedded={true} compact />
              </div>
            )}
          </div>

          <Field label="เว็บไซต์">
            {(props) => (
              <Input
                {...props}
                name="url"
                type="url"
                inputMode="url"
                autoComplete="off"
                value={formData.url}
                onChange={handleChange}
                placeholder="https://example.com"
              />
            )}
          </Field>
        </section>

        {/* Optional details */}
        <section aria-labelledby="item-more-heading" className="grid gap-4 border-t border-border pt-6">
          <h2 id="item-more-heading" className="text-base">
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              aria-controls="item-more-panel"
              className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid gap-0.5">
                <span>เพิ่มเติม</span>
                {!showMore && <span className="text-caption text-muted-foreground">{moreSummary}</span>}
              </span>
              <ChevronIcon className={`size-4 shrink-0 text-muted-foreground transition-transform duration-fast ${showMore ? 'rotate-180' : ''}`} />
            </button>
          </h2>

          {showMore && (
          <div id="item-more-panel" className="grid gap-4">
            <Field label="หมวดหมู่">
              {(props) => (
                <Select {...props} name="category" value={formData.category} onChange={handleChange}>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="คอลเลกชัน"
              hint={
                isOwner
                  ? 'เลือกคอลเลกชันเพื่อแชร์รายการนี้กับสมาชิกคอลเลกชัน'
                  : 'เฉพาะเจ้าของรายการเท่านั้นที่ย้ายคอลเลกชันได้'
              }
            >
              {(props) => (
                <Select
                  {...props}
                  value={selectedCollectionId}
                  onChange={(e) => setSelectedCollectionId(e.target.value)}
                  disabled={!isOwner}
                >
                  <option value="">คลังส่วนตัว</option>
                  {currentCollectionMissing && (
                    <option value={selectedCollectionId}>{item?._collection?.name || 'คอลเลกชันปัจจุบัน'}</option>
                  )}
                  {collections.map((c) => {
                    const cid = c.collection_id || c.id;
                    const perm = c.effective_permission || c.effectivePermission || 'member';
                    return (
                      <option key={cid} value={cid}>
                        {c.name} · {PERMISSION_LABELS[perm] || perm}
                      </option>
                    );
                  })}
                </Select>
              )}
            </Field>

            <Field label="แท็ก" hint="คั่นแต่ละแท็กด้วยเครื่องหมายจุลภาค เช่น งาน, ส่วนตัว">
              {(props) => (
                <Input {...props} name="tags" autoComplete="off" value={formData.tags} onChange={handleChange} placeholder="งาน, ส่วนตัว" />
              )}
            </Field>

            <Field label="บันทึก">
              {(props) => (
                <Textarea
                  {...props}
                  name="notes"
                  rows={4}
                  value={formData.notes}
                  onChange={handleChange}
                  placeholder="รหัสสำรอง คำถามความปลอดภัย หรือข้อมูลอื่น"
                />
              )}
            </Field>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input
                type="checkbox"
                name="favorite"
                checked={formData.favorite}
                onChange={handleChange}
                className="mt-0.5 size-4 shrink-0"
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-ui">รายการโปรด</span>
                <span className="text-caption text-muted-foreground">แสดงเมื่อกรองด้วย “รายการโปรด”</span>
              </span>
            </label>
          </div>
          )}
        </section>
      </form>

      {/* Mobile: actions stay reachable at the bottom of the screen */}
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-background px-4 py-3 sm:hidden">{actions}</div>

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="ทิ้งการเปลี่ยนแปลง?"
        description="ข้อมูลที่กรอกไว้ในหน้านี้ยังไม่ได้บันทึก และจะหายไปเมื่อกลับไปที่รายการ"
        confirmLabel="ทิ้งการเปลี่ยนแปลง"
        cancelLabel="แก้ไขต่อ"
        onConfirm={() => {
          setConfirmLeave(false);
          onClose();
        }}
      />
    </div>
  );
}

export default ItemModal;
