import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import {
  PlusIcon,
  SearchIcon,
  EditIcon,
  TrashIcon,
  CloseIcon,
  CheckIcon,
  RefreshIcon,
  ShieldIcon,
} from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';

function CollectionIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  );
}

function LockKeyIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  );
}

export function CollectionsView() {
  const { user, privateKey, isAdmin } = useAuth();
  const { addToast } = useToast();

  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state: 'create' | 'edit' | 'delete' | 'access' | null
  const [activeModal, setActiveModal] = useState(null);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state for Create / Edit
  const [formData, setFormData] = useState({ name: '', description: '' });

  // Access modal state
  const [accessList, setAccessList] = useState([]);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [targetType, setTargetType] = useState('user'); // 'user' | 'group'
  const [recipientEmail, setRecipientEmail] = useState('');
  const [foundRecipient, setFoundRecipient] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [selectedPermission, setSelectedPermission] = useState('read'); // 'read' | 'write' | 'admin'
  const [userGroups, setUserGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const loadCollections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.collections.list();
      setCollections(res?.collections || []);
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดรายการคอลเลกชันได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  // Load access entries for selected collection
  const loadAccessList = useCallback(async (collectionId) => {
    if (!collectionId) return;
    setLoadingAccess(true);
    try {
      const res = await api.collections.listAccess(collectionId);
      setAccessList(res?.access || []);
    } catch (err) {
      addToast(err.message || 'ไม่สามารถโหลดสิทธิ์การเข้าถึงได้', 'error');
    } finally {
      setLoadingAccess(false);
    }
  }, [addToast]);

  // Load user groups for group assignment
  const loadUserGroups = useCallback(async () => {
    try {
      const res = await api.groups.list();
      const grps = res?.groups || [];
      setUserGroups(grps);
      if (grps.length > 0) {
        setSelectedGroupId(grps[0].group_id || grps[0].id);
      }
    } catch {
      // non-blocking
    }
  }, []);

  const handleOpenCreateModal = () => {
    setSelectedCollection(null);
    setFormData({ name: '', description: '' });
    setActiveModal('create');
  };

  const handleOpenEditModal = (col) => {
    setSelectedCollection(col);
    setFormData({
      name: col.name || '',
      description: col.description || '',
    });
    setActiveModal('edit');
  };

  const handleOpenDeleteModal = (col) => {
    setSelectedCollection(col);
    setActiveModal('delete');
  };

  const handleOpenAccessModal = (col) => {
    setSelectedCollection(col);
    setTargetType('user');
    setRecipientEmail('');
    setFoundRecipient(null);
    setLookupError(null);
    setSelectedPermission('read');
    setActiveModal('access');
    loadAccessList(col.collection_id || col.id);
    loadUserGroups();
  };

  // Helper to obtain user's public key
  const getUserPublicKey = async () => {
    let pubKey = user?.public_key || user?.publicKey;
    if (!pubKey && user?.email) {
      try {
        const lookup = await api.sharing.lookupUser(user.email);
        pubKey = lookup?.data?.public_key;
      } catch {
        // fallback
      }
    }
    return pubKey;
  };

  // Helper to get unwrapped collection key for the current user
  const getUnwrappedCollectionKey = async (collectionId) => {
    if (!privateKey) {
      throw new Error('คีย์ส่วนตัวถูกล็อกอยู่ กรุณาปลดล็อกคลังรหัสผ่านก่อนดำเนินการ');
    }
    const keyRes = await api.collections.getKeys(collectionId);
    const wrappedObj =
      keyRes?.key?.encrypted_key_for_recipient ||
      keyRes?.key?.encryptedKeyForRecipient ||
      keyRes?.encrypted_key_for_recipient ||
      keyRes?.encryptedKeyForRecipient ||
      keyRes?.key ||
      keyRes;

    return await ClientCrypto.unwrapCollectionKey(wrappedObj, privateKey);
  };

  const handleSaveCollection = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      addToast('กรุณาระบุชื่อคอลเลกชัน (Collection name is required)', 'error');
      return;
    }
    if ([...formData.name.trim()].length > 255) {
      addToast('ชื่อคอลเลกชันยาวได้ไม่เกิน 255 ตัวอักษร', 'error');
      return;
    }
    if ([...formData.description.trim()].length > 2000) {
      addToast('คำอธิบายยาวได้ไม่เกิน 2,000 ตัวอักษร', 'error');
      return;
    }

    setActionLoading(true);
    try {
      if (activeModal === 'edit' && selectedCollection) {
        const colId = selectedCollection.collection_id || selectedCollection.id;
        await api.collections.update(colId, {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
        });
        addToast('แก้ไขข้อมูลคอลเลกชันสำเร็จ', 'success');
      } else {
        // Zero-Knowledge Collection Creation:
        // 1. Generate fresh 32-byte symmetric collection key
        const collectionKey = ClientCrypto.generateCollectionKey();

        // 2. Obtain creator public key
        const creatorPubKey = await getUserPublicKey();
        if (!creatorPubKey) {
          throw new Error('ไม่พบคีย์สาธารณะของผู้สร้างบัญชี กรุณาเข้าสู่ระบบใหม่');
        }

        // 3. Wrap collection key using RSA-OAEP
        const wrappedKey = await ClientCrypto.wrapCollectionKey(collectionKey, creatorPubKey);

        // 4. Create collection on server
        await api.collections.create({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          encryptedKeyForRecipient: wrappedKey,
        });

        addToast('สร้างคอลเลกชันใหม่พร้อมเข้ารหัส Zero-Knowledge สำเร็จ', 'success');
      }

      setActiveModal(null);
      setSelectedCollection(null);
      loadCollections();
    } catch (err) {
      addToast(err.message || 'เกิดข้อผิดพลาดในการบันทึกคอลเลกชัน', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteCollection = async () => {
    if (!selectedCollection) return;
    setActionLoading(true);
    try {
      const colId = selectedCollection.collection_id || selectedCollection.id;
      await api.collections.delete(colId);
      addToast('ลบคอลเลกชันสำเร็จ', 'success');
      setActiveModal(null);
      setSelectedCollection(null);
      loadCollections();
    } catch (err) {
      addToast(err.message || 'ไม่สามารถลบคอลเลกชันได้', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLookupRecipient = async (e) => {
    e.preventDefault();
    if (!recipientEmail.trim()) {
      setLookupError('กรุณากรอกอีเมลผู้รับ');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    setFoundRecipient(null);

    try {
      const res = await api.sharing.lookupUser(recipientEmail.trim().toLowerCase());
      if (res?.data && res.data.public_key) {
        setFoundRecipient(res.data);
      } else if (res?.data) {
        setLookupError('ผู้ใช้นี้ยังไม่มีคีย์สาธารณะในระบบ');
      } else {
        setLookupError('ไม่พบผู้ใช้ที่มีอีเมลนี้ในระบบ');
      }
    } catch (err) {
      setLookupError(err.message || 'ไม่พบผู้ใช้ที่มีอีเมลนี้ในระบบ');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleGrantAccess = async () => {
    if (!selectedCollection) return;
    const colId = selectedCollection.collection_id || selectedCollection.id;

    if (targetType === 'user' && !foundRecipient) {
      addToast('กรุณาค้นหาและเลือกผู้รับก่อนมอบสิทธิ์', 'error');
      return;
    }
    if (targetType === 'user' && !foundRecipient.public_key) {
      addToast('ผู้รับยังไม่มีคีย์สาธารณะ จึงไม่สามารถส่งคีย์คอลเลกชันให้ได้', 'error');
      return;
    }
    if (targetType === 'group' && !selectedGroupId) {
      addToast('กรุณาเลือกกลุ่มที่ต้องการมอบสิทธิ์', 'error');
      return;
    }

    setActionLoading(true);
    try {
      // Without the collection key the recipients could not decrypt anything, so stop
      // before granting access instead of granting "empty" access.
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
        // Grant first: the server only accepts keys for users who are members.
        await api.collections.grantAccess(colId, {
          targetType: 'user',
          targetId: foundRecipient.user_id,
          permission: selectedPermission,
        });
        const wrappedForRecipient = await ClientCrypto.wrapCollectionKey(collectionKey, foundRecipient.public_key);
        await api.collections.storeKey(colId, {
          userId: foundRecipient.user_id,
          encryptedKeyForRecipient: wrappedForRecipient,
        });

        addToast(`มอบสิทธิ์ให้ ${foundRecipient.username || foundRecipient.email} สำเร็จ`, 'success');
        setFoundRecipient(null);
        setRecipientEmail('');
      } else {
        await api.collections.grantAccess(colId, {
          targetType: 'group',
          targetId: selectedGroupId,
          permission: selectedPermission,
        });

        // Distribute the wrapped key to every current member and report who missed out.
        const mbrRes = await api.groups.listMembers(selectedGroupId);
        const members = mbrRes?.members || [];
        const results = await Promise.allSettled(
          members.map(async (mbr) => {
            const memberUserId = mbr.user_id || mbr.userId;
            let pubKey = mbr.public_key || mbr.publicKey;
            if (!pubKey && mbr.email) {
              pubKey = (await api.sharing.lookupUser(mbr.email))?.data?.public_key;
            }
            if (!pubKey) throw new Error(`no public key for ${memberUserId}`);
            const wrapped = await ClientCrypto.wrapCollectionKey(collectionKey, pubKey);
            await api.collections.storeKey(colId, { userId: memberUserId, encryptedKeyForRecipient: wrapped });
          })
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          addToast(
            `มอบสิทธิ์ให้กลุ่มแล้ว แต่ส่งคีย์ไม่สำเร็จ ${failed} จาก ${members.length} คน สมาชิกเหล่านี้จะยังเปิดรายการในคอลเลกชันไม่ได้ กรุณาลองมอบสิทธิ์ใหม่อีกครั้ง`,
            'error',
            8000
          );
        } else {
          addToast(`มอบสิทธิ์และส่งคีย์ให้สมาชิกกลุ่ม ${members.length} คนสำเร็จ`, 'success');
        }
      }

      loadAccessList(colId);
    } catch (err) {
      addToast(err.message || 'ไม่สามารถมอบสิทธิ์ได้', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeAccess = async (entry) => {
    if (!selectedCollection) return;
    const colId = selectedCollection.collection_id || selectedCollection.id;
    const tType = entry.target_type || entry.targetType;
    const tId = entry.target_id || entry.targetId;

    try {
      await api.collections.revokeAccess(colId, tType, tId);
      addToast('เพิกถอนสิทธิ์สำเร็จ', 'success');
      loadAccessList(colId);
    } catch (err) {
      addToast(err.message || 'ไม่สามารถเพิกถอนสิทธิ์ได้', 'error');
    }
  };

  const filteredCollections = collections.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchName = (c.name || '').toLowerCase().includes(q);
    const matchDesc = (c.description || '').toLowerCase().includes(q);
    return matchName || matchDesc;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center space-x-2.5">
            <CollectionIcon className="w-7 h-7 text-emerald-400" />
            <span>คอลเลกชัน (Collections)</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            แบ่งปันรหัสผ่านแบบกลุ่มและรายบุคคลด้วยสถาปัตยกรรม Zero-Knowledge (AES-256 + RSA-OAEP)
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={loadCollections}
            disabled={loading}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl text-sm transition-all shadow-lg shadow-emerald-950/40 flex items-center space-x-2"
          >
            <PlusIcon className="w-4 h-4" />
            <span>สร้างคอลเลกชัน (Create Collection)</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-2xl text-rose-200 text-sm">
          {error}
        </div>
      )}

      {/* Search Bar */}
      <div className="relative max-w-md">
        <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ค้นหาชื่อคอลเลกชัน หรือคำอธิบาย..."
          className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
        />
      </div>

      {/* Collections List */}
      {loading ? (
        <div className="py-20 text-center text-slate-400">
          <div className="inline-block w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm">กำลังโหลดรายการคอลเลกชัน...</p>
        </div>
      ) : filteredCollections.length === 0 ? (
        <div className="py-16 text-center bg-slate-800/40 border border-slate-700/50 rounded-3xl p-8">
          <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-4">
            <CollectionIcon className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-white">ไม่พบคอลเลกชัน</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto mb-5">
            {searchQuery
              ? 'ไม่พบคอลเลกชันที่ตรงกับคำค้นหาของคุณ'
              : 'สร้างคอลเลกชันเพื่อแชร์รหัสผ่านอย่างปลอดภัยให้กับทีมหรือผู้ใช้เฉพาะกลุ่ม'}
          </p>
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl text-sm transition-colors inline-flex items-center space-x-2 shadow-lg shadow-emerald-950/40"
          >
            <PlusIcon className="w-4 h-4" />
            <span>สร้างคอลเลกชัน (Create Collection)</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCollections.map((col) => {
            const id = col.collection_id || col.id;
            const perm = (col.effective_permission || col.effectivePermission || 'read').toLowerCase();
            const canAdmin = perm === 'admin' || isAdmin;

            const permBadgeStyle =
              perm === 'admin'
                ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                : perm === 'write'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-blue-500/10 text-blue-400 border-blue-500/30';

            return (
              <div
                key={id}
                className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 hover:border-slate-600 transition-all flex flex-col justify-between shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                        <CollectionIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white tracking-tight truncate max-w-[180px]">
                          {col.name}
                        </h3>
                        <span className="text-[11px] text-slate-400 block">
                          สร้างเมื่อ {col.created_at ? new Date(col.created_at).toLocaleDateString() : '-'}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full border ${permBadgeStyle}`}
                    >
                      {perm}
                    </span>
                  </div>

                  {col.description ? (
                    <p className="text-xs text-slate-300 mb-4 line-clamp-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-800">
                      {col.description}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 italic mb-4">ไม่มีคำอธิบาย</p>
                  )}
                </div>

                {/* Card Action Buttons */}
                <div className="pt-3 border-t border-slate-700/60 flex items-center justify-between">
                  {canAdmin ? (
                    <button
                      type="button"
                      onClick={() => handleOpenAccessModal(col)}
                      className="px-3 py-1.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors flex items-center space-x-1.5"
                    >
                      <ShieldIcon className="w-3.5 h-3.5 text-emerald-400" />
                      <span>จัดการสิทธิ์ (Access)</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500 flex items-center space-x-1">
                      <LockKeyIcon className="w-3 h-3" />
                      <span>เข้าถึงแบบ {perm}</span>
                    </span>
                  )}

                  {canAdmin && (
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(col)}
                        className="p-1.5 text-slate-400 hover:text-emerald-400 rounded-lg hover:bg-slate-700/60 transition-colors"
                        title="แก้ไขคอลเลกชัน"
                      >
                        <EditIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenDeleteModal(col)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-700/60 transition-colors"
                        title="ลบคอลเลกชัน"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create / Edit Collection */}
      {(activeModal === 'create' || activeModal === 'edit') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="absolute right-5 top-5 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CollectionIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  {activeModal === 'edit' ? 'แก้ไขคอลเลกชัน' : 'สร้างคอลเลกชันใหม่'}
                </h3>
                <p className="text-xs text-slate-400">
                  {activeModal === 'edit'
                    ? 'อัปเดตชื่อหรือคำอธิบายคอลเลกชัน'
                    : 'สร้างคีย์สมมาตร 256 บิตและห่อหุ้มด้วย RSA-OAEP อัตโนมัติ'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveCollection} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  ชื่อคอลเลกชัน (Collection Name) *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="เช่น Engineering Production, IT Passwords"
                  maxLength={255}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  คำอธิบาย (Description)
                </label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="รายละเอียดหรือวัตถุประสงค์ของคอลเลกชัน..."
                  maxLength={2000}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              </div>

              <div className="flex space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-950/40"
                >
                  <CheckIcon className="w-4 h-4" />
                  <span>{actionLoading ? 'กำลังบันทึก...' : 'บันทึก'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Collection */}
      {activeModal === 'delete' && selectedCollection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
              <TrashIcon className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white text-center mb-1">ยืนยันการลบคอลเลกชัน</h3>
            <p className="text-xs text-slate-300 text-center mb-6">
              คุณแน่ใจหรือไม่ว่าต้องการลบคอลเลกชัน{' '}
              <span className="font-semibold text-rose-300">“{selectedCollection.name}”</span>?
              สิทธิ์การเข้าถึงทั้งหมดจะถูกยกเลิก (Admin Only)
            </p>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleDeleteCollection}
                disabled={actionLoading}
                className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {actionLoading ? 'กำลังลบ...' : 'ลบคอลเลกชัน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Manage Access (RBAC + Key Wrapping) */}
      {activeModal === 'access' && selectedCollection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl relative my-8">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="absolute right-5 top-5 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <ShieldIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  จัดการสิทธิ์: {selectedCollection.name}
                </h3>
                <p className="text-xs text-slate-400">
                  มอบสิทธิ์ให้กับบุคคลหรือกลุ่มผู้ใช้ พร้อมส่งต่อคีย์แบบ Zero-Knowledge
                </p>
              </div>
            </div>

            {/* Grant Access Section */}
            <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                  มอบสิทธิ์การเข้าถึงใหม่
                </h4>

                {/* Target Type Toggle */}
                <div className="flex bg-slate-950 rounded-xl p-0.5 border border-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setTargetType('user');
                      setFoundRecipient(null);
                      setLookupError(null);
                    }}
                    className={`px-3 py-1 rounded-lg transition-colors ${
                      targetType === 'user' ? 'bg-emerald-600 text-white font-medium' : 'text-slate-400'
                    }`}
                  >
                    รายบุคคล (User)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetType('group');
                      setFoundRecipient(null);
                      setLookupError(null);
                    }}
                    className={`px-3 py-1 rounded-lg transition-colors ${
                      targetType === 'group' ? 'bg-emerald-600 text-white font-medium' : 'text-slate-400'
                    }`}
                  >
                    กลุ่มผู้ใช้ (Group)
                  </button>
                </div>
              </div>

              {targetType === 'user' ? (
                <>
                  <form onSubmit={handleLookupRecipient} className="flex gap-2 mb-3">
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="กรอกอีเมลผู้รับสิทธิ์..."
                      className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={lookupLoading}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors whitespace-nowrap"
                    >
                      {lookupLoading ? 'กำลังค้นหา...' : 'ค้นหาผู้ใช้'}
                    </button>
                  </form>

                  {lookupError && <p className="text-xs text-rose-400 mb-2">{lookupError}</p>}

                  {foundRecipient && (
                    <div className="p-3 bg-slate-950/80 border border-emerald-500/30 rounded-xl flex items-center justify-between gap-3 animate-fadeIn">
                      <div>
                        <p className="text-xs font-semibold text-white">
                          {foundRecipient.full_name || foundRecipient.username}
                        </p>
                        <p className="text-[11px] text-slate-400">{foundRecipient.email}</p>
                      </div>

                      <div className="flex items-center space-x-2">
                        <select
                          value={selectedPermission}
                          onChange={(e) => setSelectedPermission(e.target.value)}
                          className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-xs focus:outline-none"
                        >
                          <option value="read">Read (อ่านอย่างเดียว)</option>
                          <option value="write">Write (เพิ่ม/แก้ไข)</option>
                          <option value="admin">Admin (จัดการสิทธิ์)</option>
                        </select>

                        <button
                          type="button"
                          onClick={handleGrantAccess}
                          disabled={actionLoading}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center space-x-1"
                        >
                          <CheckIcon className="w-3.5 h-3.5" />
                          <span>{actionLoading ? 'กำลังมอบ...' : 'มอบสิทธิ์'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    {userGroups.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">ไม่พบกลุ่มผู้ใช้ที่คุณเป็นสมาชิก</p>
                    ) : (
                      <select
                        value={selectedGroupId}
                        onChange={(e) => setSelectedGroupId(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        {userGroups.map((g) => (
                          <option key={g.group_id || g.id} value={g.group_id || g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <select
                    value={selectedPermission}
                    onChange={(e) => setSelectedPermission(e.target.value)}
                    className="px-2 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 text-xs focus:outline-none"
                  >
                    <option value="read">Read (อ่านอย่างเดียว)</option>
                    <option value="write">Write (เพิ่ม/แก้ไข)</option>
                    <option value="admin">Admin (จัดการสิทธิ์)</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleGrantAccess}
                    disabled={actionLoading || userGroups.length === 0}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors flex items-center space-x-1 whitespace-nowrap"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                    <span>{actionLoading ? 'กำลังมอบ...' : 'มอบสิทธิ์ให้กลุ่ม'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Existing Access Entries List */}
            <div>
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                รายการสิทธิ์ที่กำหนดไว้ ({accessList.length} รายการ)
              </h4>

              {loadingAccess ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  กำลังโหลดรายการสิทธิ์...
                </div>
              ) : accessList.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
                  ยังไม่มีการมอบสิทธิ์เพิ่มเติมในคอลเลกชันนี้
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {accessList.map((entry) => {
                    const tType = (entry.target_type || entry.targetType || 'user').toLowerCase();
                    const tId = entry.target_id || entry.targetId;
                    const perm = (entry.permission || 'read').toLowerCase();

                    const permBadgeStyle =
                      perm === 'admin'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                        : perm === 'write'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/30';

                    return (
                      <div
                        key={entry.id || entry.access_id || `${tType}-${tId}`}
                        className="p-3 bg-slate-900/60 border border-slate-700/60 rounded-xl flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-2.5">
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 uppercase font-mono border border-slate-700">
                            {tType}
                          </span>
                          <span className="text-xs font-mono text-slate-200 truncate max-w-[200px]">
                            {tId}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <span
                            className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border ${permBadgeStyle}`}
                          >
                            {perm}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRevokeAccess(entry)}
                            className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                            title="เพิกถอนสิทธิ์"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-5 mt-4 border-t border-slate-700 text-right">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="py-2 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-xl transition-colors"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CollectionsView;
