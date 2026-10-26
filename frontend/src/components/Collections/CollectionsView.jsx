import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { PlusIcon, SearchIcon, EditIcon, TrashIcon, RefreshIcon, ShieldIcon, KeyIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { CollectionDetailView } from './CollectionDetailView.jsx';
import {
  Button,
  Badge,
  Card,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Field,
  Textarea,
  Select,
  Alert,
  Skeleton,
  EmptyState,
  ConfirmDialog,
} from '../ui/index.js';

const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;

export const PERMISSION_LABELS = {
  admin: 'ผู้ดูแล',
  write: 'แก้ไขได้',
  read: 'อ่านอย่างเดียว',
};

const PERMISSION_HINTS = {
  read: 'ดูและคัดลอกรหัสผ่านในคอลเลกชันได้',
  write: 'เพิ่มและแก้ไขรายการในคอลเลกชันได้',
  admin: 'จัดการสิทธิ์ ส่งคีย์ แก้ไขและลบคอลเลกชันได้',
};

export const PERMISSION_BADGE = { admin: 'info', write: 'success', read: 'outline' };

function FolderIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

const charCount = (s) => [...(s || '')].length;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '—');

export function CollectionsView() {
  const { user, privateKey, isAdmin } = useAuth();
  const { addToast } = useToast();

  // List
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCollection, setSelectedCollection] = useState(null);

  // Create / edit
  const [editor, setEditor] = useState(null); // { mode: 'create' | 'edit', collection? }
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Access management
  const [accessCollection, setAccessCollection] = useState(null);
  const [accessList, setAccessList] = useState([]);
  const [pendingKeys, setPendingKeys] = useState([]);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [accessError, setAccessError] = useState(null);
  const [targetType, setTargetType] = useState('user');
  const [recipientUsername, setRecipientUsername] = useState('');
  const [foundRecipient, setFoundRecipient] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [selectedPermission, setSelectedPermission] = useState('read');
  const [userGroups, setUserGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [granting, setGranting] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const collectionIdOf = (c) => c?.collection_id || c?.id;

  const loadCollections = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.collections.list();
      setCollections(res?.collections || []);
    } catch (err) {
      setLoadError(err.message || 'ไม่สามารถโหลดรายการคอลเลกชันได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  const loadAccessList = useCallback(async (collectionId) => {
    if (!collectionId) return;
    setLoadingAccess(true);
    setAccessError(null);
    try {
      const [res, pending] = await Promise.all([
        api.collections.listAccess(collectionId),
        api.collections.pendingKeys(collectionId).catch(() => ({ pending: [] })),
      ]);
      setAccessList(res?.access || []);
      setPendingKeys(pending?.pending || []);
    } catch (err) {
      setAccessError(err.message || 'ไม่สามารถโหลดรายการสิทธิ์ได้');
    } finally {
      setLoadingAccess(false);
    }
  }, []);

  // ---------------------------------------------------------------- create / edit

  const openCreate = () => {
    setFormData({ name: '', description: '' });
    setFormErrors({});
    setEditor({ mode: 'create' });
  };

  const openEdit = (collection) => {
    setFormData({ name: collection.name || '', description: collection.description || '' });
    setFormErrors({});
    setEditor({ mode: 'edit', collection });
  };

  const validateForm = () => {
    const errors = {};
    const name = formData.name.trim();
    if (!name) errors.name = 'กรุณาระบุชื่อคอลเลกชัน';
    else if (charCount(name) > NAME_MAX) errors.name = `ชื่อยาวได้ไม่เกิน ${NAME_MAX} ตัวอักษร`;
    if (charCount(formData.description.trim()) > DESCRIPTION_MAX) {
      errors.description = `คำอธิบายยาวได้ไม่เกิน ${DESCRIPTION_MAX.toLocaleString('th-TH')} ตัวอักษร`;
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const getUserPublicKey = async () => {
    if (user?.public_key) return user.public_key;
    if (!user?.username) return null;
    const lookup = await api.sharing.lookupUser(user.username).catch(() => null);
    return lookup?.data?.public_key || null;
  };

  const getUnwrappedCollectionKey = async (collectionId) => {
    if (!privateKey) throw new Error('คลังรหัสผ่านถูกล็อกอยู่ กรุณาปลดล็อกก่อน');
    const keyRes = await api.collections.getKeys(collectionId);
    return ClientCrypto.unwrapCollectionKey(keyRes?.key?.encryptedKeyForRecipient, privateKey);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setSaving(true);
    try {
      const payload = { name: formData.name.trim(), description: formData.description.trim() || null };
      if (editor.mode === 'edit') {
        await api.collections.update(collectionIdOf(editor.collection), payload);
        addToast('บันทึกการแก้ไขคอลเลกชันแล้ว', 'success');
        if (selectedCollection && collectionIdOf(selectedCollection) === collectionIdOf(editor.collection)) {
          setSelectedCollection((prev) => ({ ...prev, ...payload }));
        }
      } else {
        // Zero knowledge: a fresh 256-bit collection key, wrapped for the creator.
        const publicKey = await getUserPublicKey();
        if (!publicKey) throw new Error('ไม่พบคีย์สาธารณะของบัญชีนี้ กรุณาเข้าสู่ระบบใหม่');
        const wrappedKey = await ClientCrypto.wrapCollectionKey(ClientCrypto.generateCollectionKey(), publicKey);
        await api.collections.create({ ...payload, encryptedKeyForRecipient: wrappedKey });
        addToast('สร้างคอลเลกชันแล้ว', 'success');
      }
      setEditor(null);
      loadCollections();
    } catch (err) {
      const fieldErrors = err?.data?.details;
      if (Array.isArray(fieldErrors)) {
        setFormErrors(Object.fromEntries(fieldErrors.map((d) => [d.field, d.message])));
      } else {
        setFormErrors({ form: err.message || 'บันทึกคอลเลกชันไม่สำเร็จ' });
      }
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- delete

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.collections.delete(collectionIdOf(deleteTarget));
      addToast(`ลบคอลเลกชัน “${deleteTarget.name}” แล้ว`, 'success');
      if (selectedCollection && collectionIdOf(selectedCollection) === collectionIdOf(deleteTarget)) {
        setSelectedCollection(null);
      }
      setDeleteTarget(null);
      loadCollections();
    } catch (err) {
      addToast(err.message || 'ลบคอลเลกชันไม่สำเร็จ', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------- access

  const openAccess = async (collection) => {
    setAccessCollection(collection);
    setTargetType('user');
    setRecipientUsername('');
    setFoundRecipient(null);
    setLookupError(null);
    setSelectedPermission('read');
    setAccessList([]);
    setPendingKeys([]);
    loadAccessList(collectionIdOf(collection));
    try {
      const res = await api.groups.list();
      const groups = res?.groups || [];
      setUserGroups(groups);
      setSelectedGroupId(groups[0]?.group_id || groups[0]?.id || '');
    } catch {
      setUserGroups([]);
    }
  };

  const handleLookupRecipient = async (e) => {
    e.preventDefault();
    const username = recipientUsername.trim().toLowerCase();
    if (!username) {
      setLookupError('กรุณากรอกชื่อผู้ใช้ของผู้รับ');
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    setFoundRecipient(null);
    try {
      const res = await api.sharing.lookupUser(username);
      if (res?.data?.user_id === user?.user_id) setLookupError('นี่คือบัญชีของคุณเอง');
      else if (res?.data?.public_key) setFoundRecipient(res.data);
      else setLookupError('ผู้ใช้นี้ยังไม่ได้ตั้งค่าบัญชีให้เสร็จ จึงยังรับคีย์ไม่ได้');
    } catch (err) {
      setLookupError(
        err?.status === 404
          ? 'ไม่พบชื่อผู้ใช้นี้ในกลุ่มของคุณ ค้นหาได้เฉพาะคนที่อยู่กลุ่มเดียวกัน'
          : err.message || 'ค้นหาไม่สำเร็จ'
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const handleGrantAccess = async () => {
    if (!accessCollection) return;
    const colId = collectionIdOf(accessCollection);
    if (targetType === 'user' && !foundRecipient) {
      setLookupError('กรุณาค้นหาผู้รับก่อน');
      return;
    }
    if (targetType === 'group' && !selectedGroupId) return;

    setGranting(true);
    try {
      // Without the collection key the recipients could not decrypt anything, so stop
      // before granting instead of granting "empty" access.
      let collectionKey;
      try {
        collectionKey = await getUnwrappedCollectionKey(colId);
      } catch (keyErr) {
        throw new Error(
          keyErr?.status === 404
            ? 'คุณยังไม่มีคีย์ของคอลเลกชันนี้ จึงมอบสิทธิ์ให้ผู้อื่นไม่ได้ กรุณาให้ผู้ดูแลคอลเลกชันส่งคีย์ให้ก่อน'
            : keyErr?.message || 'ไม่สามารถถอดรหัสคีย์ของคอลเลกชันได้'
        );
      }

      if (targetType === 'user') {
        await api.collections.grantAccess(colId, { targetType: 'user', targetId: foundRecipient.user_id, permission: selectedPermission });
        const wrapped = await ClientCrypto.wrapCollectionKey(collectionKey, foundRecipient.public_key);
        await api.collections.storeKey(colId, { userId: foundRecipient.user_id, encryptedKeyForRecipient: wrapped });
        addToast(`ให้สิทธิ์ ${foundRecipient.full_name || foundRecipient.username} แล้ว`, 'success');
        setFoundRecipient(null);
        setRecipientUsername('');
      } else {
        await api.collections.grantAccess(colId, { targetType: 'group', targetId: selectedGroupId, permission: selectedPermission });
        const members = (await api.groups.listMembers(selectedGroupId))?.members || [];
        const results = await Promise.allSettled(
          members.map(async (mbr) => {
            const memberUserId = mbr.user_id || mbr.userId;
            const pubKey = mbr.public_key || mbr.publicKey;
            if (!pubKey) throw new Error(`no public key for ${memberUserId}`);
            const wrapped = await ClientCrypto.wrapCollectionKey(collectionKey, pubKey);
            await api.collections.storeKey(colId, { userId: memberUserId, encryptedKeyForRecipient: wrapped });
          })
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          addToast(`ให้สิทธิ์กลุ่มแล้ว แต่ส่งคีย์ไม่สำเร็จ ${failed} จาก ${members.length} คน — ดูรายชื่อในหัวข้อ “รอรับคีย์”`, 'error', 8000);
        } else {
          addToast(`ให้สิทธิ์และส่งคีย์ให้สมาชิกกลุ่ม ${members.length} คนแล้ว`, 'success');
        }
      }
      loadAccessList(colId);
      loadCollections();
    } catch (err) {
      addToast(err.message || 'ให้สิทธิ์ไม่สำเร็จ', 'error');
    } finally {
      setGranting(false);
    }
  };

  const handleDistributePendingKeys = async () => {
    if (!accessCollection || pendingKeys.length === 0) return;
    const colId = collectionIdOf(accessCollection);
    setDistributing(true);
    try {
      let collectionKey;
      try {
        collectionKey = await getUnwrappedCollectionKey(colId);
      } catch (keyErr) {
        throw new Error(keyErr?.status === 404 ? 'คุณยังไม่มีคีย์ของคอลเลกชันนี้ จึงส่งคีย์ให้ผู้อื่นไม่ได้' : keyErr?.message || 'ไม่สามารถถอดรหัสคีย์ของคอลเลกชันได้');
      }
      const results = await Promise.allSettled(
        pendingKeys.map(async (member) => {
          if (!member.public_key) throw new Error('no public key');
          const wrapped = await ClientCrypto.wrapCollectionKey(collectionKey, member.public_key);
          await api.collections.storeKey(colId, { userId: member.user_id, encryptedKeyForRecipient: wrapped });
        })
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      addToast(
        failed ? `ส่งคีย์สำเร็จ ${pendingKeys.length - failed} คน ไม่สำเร็จ ${failed} คน` : `ส่งคีย์ให้ ${pendingKeys.length} คนแล้ว`,
        failed ? 'error' : 'success',
        failed ? 6000 : undefined
      );
      loadAccessList(colId);
    } catch (err) {
      addToast(err.message || 'ส่งคีย์ไม่สำเร็จ', 'error');
    } finally {
      setDistributing(false);
    }
  };

  const handleRevoke = async () => {
    if (!accessCollection || !revokeTarget) return;
    const colId = collectionIdOf(accessCollection);
    setRevoking(true);
    try {
      await api.collections.revokeAccess(colId, revokeTarget.targetType || revokeTarget.target_type, revokeTarget.targetId || revokeTarget.target_id);
      addToast(`เพิกถอนสิทธิ์ของ ${revokeTarget.targetName || 'ผู้ใช้'} แล้ว`, 'success');
      setRevokeTarget(null);
      loadAccessList(colId);
    } catch (err) {
      addToast(err.message || 'เพิกถอนสิทธิ์ไม่สำเร็จ', 'error');
    } finally {
      setRevoking(false);
    }
  };

  // ---------------------------------------------------------------- render

  const filteredCollections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => `${c.name || ''} ${c.description || ''}`.toLowerCase().includes(q));
  }, [collections, searchQuery]);

  return (
    <div className="space-y-6">
      {selectedCollection ? (
        <CollectionDetailView
          collection={selectedCollection}
          onBack={() => {
            setSelectedCollection(null);
            loadCollections();
          }}
          onEditCollection={openEdit}
          onDeleteCollection={(c) => setDeleteTarget(c)}
          onManageAccess={openAccess}
        />
      ) : (
        <>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">คอลเลกชัน</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            แชร์รหัสผ่านให้ทีมหรือบุคคลอย่างปลอดภัย รายการในคอลเลกชันถูกเข้ารหัสด้วยคีย์ที่มีเฉพาะสมาชิกเท่านั้น
          </p>
        </div>
        <Button onClick={openCreate} className="w-full sm:w-auto">
          <PlusIcon />
          สร้างคอลเลกชัน
        </Button>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative w-full sm:max-w-sm">
          <label htmlFor="collection-search" className="sr-only">
            ค้นหาคอลเลกชัน
          </label>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="collection-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาจากชื่อหรือคำอธิบาย"
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" onClick={loadCollections} disabled={loading} aria-label="โหลดรายการคอลเลกชันใหม่">
          <RefreshIcon className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      <section aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-8 w-1/2" />
              </Card>
            ))}
            <span className="sr-only">กำลังโหลดรายการคอลเลกชัน</span>
          </div>
        ) : loadError ? (
          <Alert
            variant="error"
            title="โหลดรายการคอลเลกชันไม่สำเร็จ"
            action={
              <Button variant="outline" size="sm" onClick={loadCollections}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : collections.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
            title="ยังไม่มีคอลเลกชัน"
            description="สร้างคอลเลกชันเพื่อเก็บรหัสผ่านที่ใช้ร่วมกับทีม แล้วให้สิทธิ์สมาชิกเป็นรายคนหรือเป็นกลุ่ม"
            action={
              <Button onClick={openCreate}>
                <PlusIcon />
                สร้างคอลเลกชันแรก
              </Button>
            }
          />
        ) : filteredCollections.length === 0 ? (
          <EmptyState
            icon={<SearchIcon className="size-5" />}
            title="ไม่พบคอลเลกชันที่ตรงกับคำค้นหา"
            description={`ไม่มีคอลเลกชันที่มีคำว่า “${searchQuery.trim()}”`}
            action={
              <Button variant="outline" onClick={() => setSearchQuery('')}>
                ล้างคำค้นหา
              </Button>
            }
          />
        ) : (
          <>
            <p className="mb-3 text-caption text-muted-foreground">{filteredCollections.length.toLocaleString('th-TH')} คอลเลกชัน</p>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredCollections.map((col) => {
                const colId = collectionIdOf(col);
                const perm = String(col.effectivePermission || col.effective_permission || 'read').toLowerCase();
                const canAdmin = perm === 'admin' || isAdmin;
                const itemCount = Number(col.itemCount ?? col.item_count ?? 0);
                return (
                  <li key={colId}>
                    <Card
                      onClick={(e) => {
                        const targetEl = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
                        if (targetEl?.closest?.('button, a, input, select, textarea')) return;
                        setSelectedCollection(col);
                      }}
                      className="group flex h-full cursor-pointer flex-col p-5 transition-colors duration-fast hover:border-input"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground group-hover:text-foreground">
                            <FolderIcon className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <h2 className="truncate text-base font-strong group-hover:underline" title={col.name}>
                              {col.name}
                            </h2>
                            <p className="text-caption text-muted-foreground">
                              {itemCount.toLocaleString('th-TH')} รายการ · สร้างเมื่อ {formatDate(col.created_at)}
                            </p>
                          </div>
                        </div>
                        <Badge variant={PERMISSION_BADGE[perm] || 'outline'}>{PERMISSION_LABELS[perm] || perm}</Badge>
                      </div>

                      <p className={`mt-3 line-clamp-2 flex-1 text-sm ${col.description ? 'text-secondary-foreground' : 'italic text-muted-foreground'}`}>
                        {col.description || 'ไม่มีคำอธิบาย'}
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCollection(col);
                          }}
                        >
                          เปิดดูรายการ
                        </Button>
                        {canAdmin && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                openAccess(col);
                              }}
                            >
                              <ShieldIcon />
                              จัดการสิทธิ์
                            </Button>
                            <div className="ml-auto flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(col);
                                }}
                                aria-label={`แก้ไขคอลเลกชัน ${col.name}`}
                              >
                                <EditIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="hover:bg-error hover:text-error-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget(col);
                                }}
                                aria-label={`ลบคอลเลกชัน ${col.name}`}
                              >
                                <TrashIcon />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
        </>
      )}

      {/* Create / edit */}
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && !saving && setEditor(null)}>
        <DialogContent>
          <form onSubmit={handleSave} noValidate className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{editor?.mode === 'edit' ? 'แก้ไขคอลเลกชัน' : 'สร้างคอลเลกชันใหม่'}</DialogTitle>
              <DialogDescription>
                {editor?.mode === 'edit'
                  ? 'เปลี่ยนชื่อหรือคำอธิบาย สิทธิ์และรายการในคอลเลกชันจะไม่เปลี่ยน'
                  : 'ระบบจะสร้างคีย์เข้ารหัสใหม่สำหรับคอลเลกชันนี้บนเครื่องของคุณ'}
              </DialogDescription>
            </DialogHeader>

            {formErrors.form && <Alert variant="error">{formErrors.form}</Alert>}

            <Field label="ชื่อคอลเลกชัน" required error={formErrors.name}>
              {(props) => (
                <Input
                  {...props}
                  data-autofocus
                  value={formData.name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  placeholder="เช่น ทีมวิศวกรรม — Production"
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
              )}
            </Field>

            <Field
              label="คำอธิบาย"
              error={formErrors.description}
              hint={`${charCount(formData.description).toLocaleString('th-TH')} / ${DESCRIPTION_MAX.toLocaleString('th-TH')} ตัวอักษร`}
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={formData.description}
                  maxLength={DESCRIPTION_MAX}
                  placeholder="ใช้เก็บอะไร ใครควรได้สิทธิ์"
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                />
              )}
            </Field>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
                ยกเลิก
              </Button>
              <Button type="submit" loading={saving}>
                {editor?.mode === 'edit' ? 'บันทึก' : 'สร้างคอลเลกชัน'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`ลบคอลเลกชัน “${deleteTarget?.name || ''}”?`}
        description="สิทธิ์และคีย์ของสมาชิกทุกคนจะถูกลบ รายการรหัสผ่านจะไม่ถูกลบ แต่สมาชิกคนอื่นจะเปิดดูไม่ได้อีก การลบนี้ย้อนกลับไม่ได้"
        confirmLabel="ลบคอลเลกชัน"
        loading={deleting}
        onConfirm={handleDelete}
      />

      {/* Access management */}
      <Dialog open={Boolean(accessCollection)} onOpenChange={(open) => !open && !granting && setAccessCollection(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>จัดการสิทธิ์ · {accessCollection?.name}</DialogTitle>
            <DialogDescription>เมื่อให้สิทธิ์ ระบบจะส่งคีย์ของคอลเลกชันที่เข้ารหัสสำหรับผู้รับแต่ละคนไปด้วย</DialogDescription>
          </DialogHeader>

          {pendingKeys.length > 0 && (
            <Alert
              variant="warning"
              title={`มี ${pendingKeys.length.toLocaleString('th-TH')} คนที่ได้สิทธิ์แล้วแต่ยังไม่ได้รับคีย์`}
              action={
                <Button size="sm" variant="outline" onClick={handleDistributePendingKeys} loading={distributing}>
                  <KeyIcon />
                  ส่งคีย์ให้ทั้งหมด
                </Button>
              }
            >
              {pendingKeys.map((m) => m.full_name || m.username).join(', ')} — จะเปิดรายการในคอลเลกชันไม่ได้จนกว่าจะได้รับคีย์
            </Alert>
          )}

          <section aria-labelledby="grant-heading" className="grid gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 id="grant-heading" className="text-sm">
                ให้สิทธิ์เพิ่ม
              </h3>
              <div role="radiogroup" aria-label="ให้สิทธิ์กับ" className="inline-flex rounded-md border border-border p-0.5">
                {[
                  ['user', 'รายบุคคล'],
                  ['group', 'กลุ่ม'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={targetType === value}
                    onClick={() => {
                      setTargetType(value);
                      setFoundRecipient(null);
                      setLookupError(null);
                    }}
                    className={`rounded px-3 py-1 text-sm font-ui transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      targetType === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {targetType === 'user' ? (
              <form onSubmit={handleLookupRecipient} noValidate className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label="ชื่อผู้ใช้ของผู้รับ" error={lookupError} hint="ค้นหาได้เฉพาะคนที่อยู่กลุ่มเดียวกับคุณ">
                  {(props) => (
                    <Input
                      {...props}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={recipientUsername}
                      placeholder="เช่น somchai"
                      onChange={(e) => {
                        setRecipientUsername(e.target.value);
                        setLookupError(null);
                      }}
                    />
                  )}
                </Field>
                <Button type="submit" variant="outline" loading={lookupLoading} className="sm:mb-6">
                  ค้นหา
                </Button>
              </form>
            ) : userGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">คุณยังไม่ได้เป็นสมาชิกกลุ่มใด สร้างกลุ่มได้ที่เมนู “กลุ่ม”</p>
            ) : (
              <Field label="กลุ่ม">
                {(props) => (
                  <Select {...props} value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
                    {userGroups.map((g) => (
                      <option key={g.group_id || g.id} value={g.group_id || g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}

            {targetType === 'user' && foundRecipient && (
              <div className="flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2">
                <div className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-ui" aria-hidden="true">
                  {(foundRecipient.full_name || foundRecipient.username || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-ui">{foundRecipient.full_name || foundRecipient.username}</p>
                  <p className="truncate text-caption text-muted-foreground">@{foundRecipient.username}</p>
                </div>
              </div>
            )}

            {(targetType === 'group' ? userGroups.length > 0 : Boolean(foundRecipient)) && (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label="ระดับสิทธิ์" hint={PERMISSION_HINTS[selectedPermission]}>
                  {(props) => (
                    <Select {...props} value={selectedPermission} onChange={(e) => setSelectedPermission(e.target.value)}>
                      {['read', 'write', 'admin'].map((p) => (
                        <option key={p} value={p}>
                          {PERMISSION_LABELS[p]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Button onClick={handleGrantAccess} loading={granting} className="sm:mb-6">
                  ให้สิทธิ์
                </Button>
              </div>
            )}
          </section>

          <section aria-labelledby="access-heading" className="grid gap-2">
            <h3 id="access-heading" className="text-sm">
              ผู้ที่มีสิทธิ์ {!loadingAccess && !accessError && `(${accessList.length.toLocaleString('th-TH')})`}
            </h3>
            {loadingAccess ? (
              <div className="grid gap-2" aria-busy="true">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : accessError ? (
              <Alert
                variant="error"
                action={
                  <Button size="sm" variant="outline" onClick={() => loadAccessList(collectionIdOf(accessCollection))}>
                    ลองอีกครั้ง
                  </Button>
                }
              >
                {accessError}
              </Alert>
            ) : accessList.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">ยังไม่มีการให้สิทธิ์</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {accessList.map((entry) => {
                  const type = String(entry.targetType || entry.target_type).toLowerCase();
                  const perm = String(entry.permission || 'read').toLowerCase();
                  const isSelf = type === 'user' && (entry.targetId || entry.target_id) === user?.user_id;
                  const name = entry.targetName || (type === 'group' ? 'กลุ่มที่ถูกลบ' : 'ผู้ใช้ที่ถูกลบ');
                  return (
                    <li key={entry.id || `${type}-${entry.targetId}`} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-ui">
                          {name}
                          {isSelf && <span className="text-muted-foreground"> (คุณ)</span>}
                        </p>
                        <p className="truncate text-caption text-muted-foreground">{type === 'group' ? 'กลุ่ม' : entry.targetEmail || 'ผู้ใช้'}</p>
                      </div>
                      <Badge variant={PERMISSION_BADGE[perm] || 'outline'}>{PERMISSION_LABELS[perm] || perm}</Badge>
                      {!isSelf && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hover:bg-error hover:text-error-foreground"
                          onClick={() => setRevokeTarget({ ...entry, targetName: name })}
                          aria-label={`เพิกถอนสิทธิ์ของ ${name}`}
                        >
                          <TrashIcon />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`เพิกถอนสิทธิ์ของ ${revokeTarget?.targetName || ''}?`}
        description="ผู้นี้จะเปิดคอลเลกชันไม่ได้ทันที และคีย์ที่เก็บไว้บนเซิร์ฟเวอร์จะถูกลบ หากเคยเปิดดูรหัสผ่านไปแล้ว ควรเปลี่ยนรหัสผ่านที่สำคัญ"
        confirmLabel="เพิกถอนสิทธิ์"
        loading={revoking}
        onConfirm={handleRevoke}
      />
    </div>
  );
}

export default CollectionsView;
