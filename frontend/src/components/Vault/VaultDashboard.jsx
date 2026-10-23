import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { ItemModal } from './ItemModal.jsx';
import { DeleteConfirmModal } from './DeleteConfirmModal.jsx';
import { ShareModal } from '../Sharing/ShareModal.jsx';
import { HistoryDrawer } from '../History/HistoryDrawer.jsx';
import { Button } from '../ui/Button.jsx';
import { Input } from '../ui/Input.jsx';
import {
  KeyIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  RefreshIcon,
  LockIcon,
  UnlockIcon,
} from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { VaultGridView } from './VaultGridView.jsx';
import { VaultTableView } from './VaultTableView.jsx';

// Guarantee getMyKey alias
if (api.collections && !api.collections.getMyKey) {
  api.collections.getMyKey = api.collections.getKeys;
}

function LayoutGridIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function ListIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function VaultDashboard() {
  const { mek, privateKey, isVaultUnlocked, unlockVault } = useAuth();
  const { addToast, copyPasswordWithAutoClear } = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // View mode state (persisted in localStorage)
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('securevault_view_mode') || 'grid';
    } catch {
      return 'grid';
    }
  });

  const handleViewChange = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('securevault_view_mode', mode);
    } catch {}
  };

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [collections, setCollections] = useState([]);
  const [selectedCollectionFilter, setSelectedCollectionFilter] = useState('ALL');

  // Modals state
  const [activeModal, setActiveModal] = useState(null); // 'add' | 'edit' | 'delete' | 'share' | 'history'
  const [selectedItem, setSelectedItem] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Master password unlock state if locked
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState(null);

  // Password reveal & copy tracking
  const [revealedIds, setRevealedIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);

  const loadItems = useCallback(async () => {
    if (!mek) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch personal vault items
      const res = await api.vault.listItems();
      const rawPersonal = res?.data || [];

      // 2. Fetch accessible collections
      let loadedCollections = [];
      try {
        const colRes = await api.collections.list();
        loadedCollections = colRes?.collections || [];
        setCollections(loadedCollections);
      } catch (e) {
        console.warn('Could not load collections:', e);
      }

      // 3. For each accessible collection, unwrap key & fetch collection items
      const collectionItemsMap = new Map();
      const collectionKeyCache = new Map();

      for (const col of loadedCollections) {
        const cid = col.collection_id || col.id;
        try {
          // Retrieve wrapped key and unwrap if privateKey available
          let colKey = collectionKeyCache.get(cid);
          if (!colKey && privateKey) {
            try {
              const getKeyFn = api.collections.getMyKey || api.collections.getKeys;
              const keyRes = await getKeyFn(cid);
              const wrappedPayload =
                keyRes?.key?.encrypted_key_for_recipient ||
                keyRes?.key?.encryptedKeyForRecipient ||
                keyRes?.encrypted_key_for_recipient ||
                keyRes?.encryptedKeyForRecipient ||
                keyRes?.key ||
                keyRes;

              colKey = await ClientCrypto.unwrapCollectionKey(wrappedPayload, privateKey);
              collectionKeyCache.set(cid, colKey);
            } catch {
              // could not unwrap key
            }
          }

          // Fetch items in this collection
          const itemsRes = await api.collections.listItems(cid);
          const cItems = itemsRes?.items || [];

          for (const it of cItems) {
            const iid = it.item_id || it.id;
            let decryptedPayload = it._decrypted || null;
            if (!decryptedPayload && it.encrypted_data) {
              if (colKey) {
                try {
                  decryptedPayload = await ClientCrypto.decryptCollectionItem(it.encrypted_data, colKey);
                } catch {
                  // fallback
                }
              }
              if (!decryptedPayload && mek) {
                try {
                  decryptedPayload = await ClientCrypto.decryptVaultItem(it.encrypted_data, { mek });
                } catch {
                  // fallback
                }
              }
            }
            collectionItemsMap.set(iid, {
              ...it,
              _decrypted: decryptedPayload,
              _collection: col,
              _collectionId: cid,
            });
          }
        } catch (colErr) {
          console.warn(`Could not load items for collection ${cid}:`, colErr);
        }
      }

      // 4. Decrypt personal items with MEK or collection key
      const decryptedPersonal = await Promise.all(
        rawPersonal.map(async (it) => {
          const iid = it.item_id || it.id;
          if (collectionItemsMap.has(iid)) {
            return collectionItemsMap.get(iid);
          }

          let decryptedPayload = null;
          if (it.encrypted_data) {
            const metaColId = it.metadata?.collection_id;
            if (metaColId && collectionKeyCache.has(metaColId)) {
              try {
                decryptedPayload = await ClientCrypto.decryptCollectionItem(
                  it.encrypted_data,
                  collectionKeyCache.get(metaColId)
                );
              } catch {
                // fallback
              }
            }

            if (!decryptedPayload) {
              try {
                decryptedPayload = await ClientCrypto.decryptVaultItem(it.encrypted_data, { mek });
              } catch (e) {
                console.warn(`Failed to decrypt item ${it.item_id}:`, e);
              }
            }
          }

          const metaColId = it.metadata?.collection_id;
          const associatedCol = metaColId
            ? loadedCollections.find((c) => (c.collection_id || c.id) === metaColId)
            : null;

          return {
            ...it,
            _decrypted: decryptedPayload,
            ...(associatedCol ? { _collection: associatedCol, _collectionId: metaColId } : {}),
          };
        })
      );

      // 5. Combine personal + collection items
      const seenIds = new Set(decryptedPersonal.map((it) => it.item_id || it.id));
      const allCombined = [...decryptedPersonal];
      for (const [iid, cItem] of collectionItemsMap.entries()) {
        if (!seenIds.has(iid)) {
          seenIds.add(iid);
          allCombined.push(cItem);
        }
      }

      setItems(allCombined);
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดรายการรหัสผ่านได้');
    } finally {
      setLoading(false);
    }
  }, [mek, privateKey]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!unlockPassword) return;
    setUnlockLoading(true);
    setUnlockError(null);
    try {
      await unlockVault(unlockPassword);
      setUnlockPassword('');
      addToast('ปลดล็อกคลังรหัสผ่านสำเร็จ!', 'success');
    } catch (err) {
      setUnlockError(err.message || 'รหัสผ่านหลักไม่ถูกต้อง');
    } finally {
      setUnlockLoading(false);
    }
  };

  const toggleReveal = (id) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Copy password with 30s auto-clearing clipboard toast
  const handleCopyPassword = (password, itemId = null, itemTitle = '') => {
    if (!password) return;
    if (copyPasswordWithAutoClear) {
      copyPasswordWithAutoClear(password, 30, itemTitle);
    } else {
      navigator.clipboard.writeText(password);
      addToast('คัดลอกรหัสผ่านแล้ว!', 'success');
    }
    const resolvedId = typeof itemId === 'object' && itemId !== null
      ? (itemId.item_id || itemId.id)
      : itemId;
    if (resolvedId && resolvedId !== password) {
      setCopiedId(resolvedId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Copy username with toast feedback
  const handleCopyUsername = (username) => {
    if (!username) return;
    navigator.clipboard.writeText(username);
    addToast('คัดลอกชื่อผู้ใช้แล้ว (Username copied to clipboard)', 'info');
  };

  // Interactive favorite star button toggling with optimistic update & API sync
  const handleToggleFavorite = async (item) => {
    const itemId = item.item_id || item.id;
    const currentItem = items.find((it) => (it.item_id || it.id) === itemId) || item;
    const currentFav = Boolean(currentItem.metadata?.favorite);
    const updatedFav = !currentFav;
    const updatedMetadata = {
      ...(currentItem.metadata || {}),
      favorite: updatedFav,
    };

    // Optimistically update in memory state
    setItems((prev) =>
      prev.map((it) => {
        if ((it.item_id || it.id) === itemId) {
          return {
            ...it,
            metadata: updatedMetadata,
          };
        }
        return it;
      })
    );

    try {
      const res = await api.vault.updateItem(
        itemId,
        {
          item_type: currentItem.item_type || 'login',
          encrypted_data: currentItem.encrypted_data,
          metadata: updatedMetadata,
          version: currentItem.version,
        },
        currentItem.vault_id
      );

      // Update item version from server response to prevent 409 Conflict on repeated toggles
      setItems((prev) =>
        prev.map((i) =>
          (i.id === itemId || i.item_id === itemId)
            ? {
                ...i,
                version: (res?.data?.version || res?.version || (i.version + 1)),
                metadata: { ...i.metadata, favorite: updatedFav },
              }
            : i
        )
      );

      addToast(
        updatedFav ? 'เพิ่มในรายการโปรดแล้ว (Added to favorites)' : 'นำออกจากรายการโปรดแล้ว (Removed from favorites)',
        'info'
      );
    } catch (err) {
      // Revert state if failed
      setItems((prev) =>
        prev.map((it) => {
          if ((it.item_id || it.id) === itemId) {
            return {
              ...it,
              metadata: { ...(it.metadata || {}), favorite: currentFav },
            };
          }
          return it;
        })
      );
      addToast(err.message || 'ไม่สามารถอัปเดตรายการโปรดได้', 'error');
    }
  };

  const handleDeleteItem = async (itemToDelete) => {
    setActionLoading(true);
    try {
      const itemId = itemToDelete.item_id || itemToDelete.id;
      await api.vault.deleteItem(itemId, itemToDelete.vault_id);
      addToast('ลบรายการรหัสผ่านสำเร็จ (Deleted)', 'success');
      setActiveModal(null);
      setSelectedItem(null);
      loadItems();
    } catch (err) {
      addToast(err.message || 'ไม่สามารถลบรายการได้', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered and searched items
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const meta = it.metadata || {};
      const dec = it._decrypted || {};
      const type = (it.item_type || 'login').toUpperCase();

      // Category filter
      if (selectedCategory !== 'ALL') {
        const catNorm = selectedCategory.toUpperCase();
        if (catNorm === 'NOTE' && (type === 'SECURE_NOTE' || type === 'NOTE')) {
          // match
        } else if (catNorm === 'SECURE_NOTE' && (type === 'SECURE_NOTE' || type === 'NOTE')) {
          // match
        } else if (type !== catNorm) {
          return false;
        }
      }

      // Favorite filter
      if (filterFavorites && !meta.favorite) {
        return false;
      }

      // Collection filter
      if (selectedCollectionFilter === 'PERSONAL') {
        if (it._collectionId || it.metadata?.collection_id) {
          return false;
        }
      } else if (selectedCollectionFilter !== 'ALL') {
        const itemColId = it._collectionId || it.metadata?.collection_id;
        if (itemColId !== selectedCollectionFilter) {
          return false;
        }
      }

      // Query search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (meta.title || it.title || '').toLowerCase().includes(q);
        const matchUser = (dec.username || meta.username_preview || '').toLowerCase().includes(q);
        const matchUrl = (dec.url || meta.url || '').toLowerCase().includes(q);
        const matchTags = Array.isArray(meta.tags) && meta.tags.some((t) => t.toLowerCase().includes(q));
        const matchNotes = (dec.notes || '').toLowerCase().includes(q);

        return matchTitle || matchUser || matchUrl || matchTags || matchNotes;
      }

      return true;
    });
  }, [items, searchQuery, selectedCategory, filterFavorites, selectedCollectionFilter]);

  // If vault is locked in current session
  if (!isVaultUnlocked) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 bg-card text-card-foreground border border-border rounded-2xl shadow-2xl text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
          <LockIcon className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">คลังรหัสผ่านถูกล็อกอยู่ (Vault Locked)</h2>
        <p className="text-sm text-muted-foreground mb-6">
          กรุณากรอกรหัสผ่านหลักของคุณเพื่อคำนวณคีย์ถอดรหัส (MEK) ในหน่วยความจำชั่วคราว
        </p>

        {unlockError && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-xs">
            {unlockError}
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <Input
            type="password"
            value={unlockPassword}
            onChange={(e) => setUnlockPassword(e.target.value)}
            placeholder="รหัสผ่านหลัก (Master Password)"
            autoFocus
            required
          />
          <Button
            type="submit"
            disabled={unlockLoading || !unlockPassword}
            className="w-full flex items-center justify-center space-x-2"
          >
            <UnlockIcon className="w-4 h-4" />
            <span>{unlockLoading ? 'กำลังปลดล็อก...' : 'ปลดล็อกคลังรหัสผ่าน'}</span>
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center space-x-2.5">
            <KeyIcon className="w-7 h-7 text-emerald-400" />
            <span>คลังรหัสผ่านของฉัน (My Vault)</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ข้อมูลทั้งหมดเข้ารหัสลับด้วย AES-256-GCM (Zero-Knowledge) ฝั่งไคลเอนต์
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* View Toggle: Card Grid vs Table */}
          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => handleViewChange('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                viewMode === 'grid'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="มุมมองแบบการ์ด (Card Grid View)"
              aria-label="มุมมองแบบการ์ด"
            >
              <LayoutGridIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Grid</span>
            </button>
            <button
              type="button"
              onClick={() => handleViewChange('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                viewMode === 'table'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="มุมมองแบบตาราง (Accessible Table View)"
              aria-label="มุมมองแบบตาราง"
            >
              <ListIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Table</span>
            </button>
          </div>

          {/* Refresh Button */}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={loadItems}
            disabled={loading}
            title="รีเฟรชข้อมูล"
          >
            <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </Button>

          {/* Add Item Button */}
          <Button
            type="button"
            onClick={() => {
              setSelectedItem(null);
              setActiveModal('add');
            }}
            className="flex items-center space-x-2 shadow-sm"
          >
            <PlusIcon className="w-4 h-4" />
            <span>เพิ่มรหัสผ่าน (Add Item)</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        {/* Search */}
        <div className="md:col-span-5 relative">
          <SearchIcon className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อรายการ, บัญชี, เว็บไซต์, หรือแท็ก..."
            className="pl-10"
          />
        </div>

        {/* Category Filter Tabs */}
        <div className="md:col-span-5 flex items-center overflow-x-auto space-x-1.5 py-1 text-xs">
          {[
            { id: 'ALL', label: 'ทั้งหมด' },
            { id: 'LOGIN', label: 'Logins' },
            { id: 'SECURE_NOTE', label: 'Notes' },
            { id: 'CARD', label: 'Cards' },
            { id: 'IDENTITY', label: 'Identities' },
            { id: 'SERVER', label: 'Servers' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border border-border'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Favorite Toggle */}
        <div className="md:col-span-2 flex justify-end">
          <Button
            type="button"
            variant={filterFavorites ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setFilterFavorites(!filterFavorites)}
            className={`flex items-center space-x-1.5 ${
              filterFavorites ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' : ''
            }`}
          >
            <StarIcon className="w-4 h-4" filled={filterFavorites} />
            <span>รายการโปรด</span>
          </Button>
        </div>
      </div>

      {/* Collection Filter Row */}
      <div className="flex items-center space-x-2 overflow-x-auto py-1 text-xs">
        <span className="text-muted-foreground font-semibold whitespace-nowrap">📁 คอลเลกชัน:</span>
        <button
          type="button"
          onClick={() => setSelectedCollectionFilter('ALL')}
          className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
            selectedCollectionFilter === 'ALL'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border border-border'
          }`}
        >
          ทั้งหมด (All)
        </button>
        <button
          type="button"
          onClick={() => setSelectedCollectionFilter('PERSONAL')}
          className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
            selectedCollectionFilter === 'PERSONAL'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border border-border'
          }`}
        >
          🔒 คลังส่วนตัว (Personal)
        </button>
        {collections.map((col) => {
          const cid = col.collection_id || col.id;
          return (
            <button
              key={cid}
              type="button"
              onClick={() => setSelectedCollectionFilter(cid)}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
                selectedCollectionFilter === cid
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border border-border'
              }`}
            >
              📁 {col.name}
            </button>
          );
        })}
      </div>

      {/* Items Display: Grid View vs Table View */}
      {loading ? (
        <div className="py-20 text-center text-muted-foreground">
          <div className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm">กำลังถอดรหัสข้อมูลคลังรหัสผ่านของคุณ...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-16 text-center bg-card text-card-foreground border border-border rounded-2xl p-8 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto mb-4">
            <KeyIcon className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">ไม่พบรายการรหัสผ่าน</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto mb-5">
            {searchQuery || selectedCategory !== 'ALL' || filterFavorites
              ? 'ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหาของคุณ ลองเปลี่ยนตัวกรอง'
              : 'เริ่มต้นบันทึกรหัสผ่านแรกของคุณไว้ในคลังข้อมูลที่ปลอดภัย'}
          </p>
          <Button
            type="button"
            onClick={() => {
              setSelectedItem(null);
              setActiveModal('add');
            }}
            className="inline-flex items-center space-x-2"
          >
            <PlusIcon className="w-4 h-4" />
            <span>เพิ่มรหัสผ่านใหม่ (Add Password)</span>
          </Button>
        </div>
      ) : viewMode === 'table' ? (
        <VaultTableView
          items={filteredItems}
          revealedIds={revealedIds}
          copiedId={copiedId}
          onToggleReveal={toggleReveal}
          onCopyPassword={handleCopyPassword}
          onCopyUsername={handleCopyUsername}
          onToggleFavorite={handleToggleFavorite}
          onEdit={(it) => {
            setSelectedItem(it);
            setActiveModal('edit');
          }}
          onShare={(it) => {
            setSelectedItem(it);
            setActiveModal('share');
          }}
          onHistory={(it) => {
            setSelectedItem(it);
            setActiveModal('history');
          }}
          onDelete={(it) => {
            setSelectedItem(it);
            setActiveModal('delete');
          }}
          collections={collections}
        />
      ) : (
        <VaultGridView
          items={filteredItems}
          revealedIds={revealedIds}
          copiedId={copiedId}
          onToggleReveal={toggleReveal}
          onCopyPassword={handleCopyPassword}
          onCopyUsername={handleCopyUsername}
          onToggleFavorite={handleToggleFavorite}
          onEdit={(it) => {
            setSelectedItem(it);
            setActiveModal('edit');
          }}
          onShare={(it) => {
            setSelectedItem(it);
            setActiveModal('share');
          }}
          onHistory={(it) => {
            setSelectedItem(it);
            setActiveModal('history');
          }}
          onDelete={(it) => {
            setSelectedItem(it);
            setActiveModal('delete');
          }}
          collections={collections}
        />
      )}

      {/* Add / Edit Modal (UC-4 / UC-5) */}
      {(activeModal === 'add' || activeModal === 'edit') && (
        <ItemModal
          isOpen={true}
          item={selectedItem}
          onClose={() => {
            setActiveModal(null);
            setSelectedItem(null);
          }}
          onSuccess={loadItems}
        />
      )}

      {/* Delete Confirmation Modal (UC-6) */}
      {activeModal === 'delete' && selectedItem && (
        <DeleteConfirmModal
          isOpen={true}
          item={selectedItem}
          loading={actionLoading}
          onClose={() => {
            setActiveModal(null);
            setSelectedItem(null);
          }}
          onConfirm={handleDeleteItem}
        />
      )}

      {/* Share Modal (UC-10) */}
      {activeModal === 'share' && selectedItem && (
        <ShareModal
          isOpen={true}
          item={selectedItem}
          onClose={() => {
            setActiveModal(null);
            setSelectedItem(null);
          }}
          onSuccess={loadItems}
        />
      )}

      {/* History Drawer (UC-11) */}
      {activeModal === 'history' && selectedItem && (
        <HistoryDrawer
          isOpen={true}
          item={selectedItem}
          onClose={() => {
            setActiveModal(null);
            setSelectedItem(null);
          }}
          onRestoreSuccess={loadItems}
        />
      )}
    </div>
  );
}

export default VaultDashboard;
