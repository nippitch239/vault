import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { ItemModal } from './ItemModal.jsx';
import { DeleteConfirmModal } from './DeleteConfirmModal.jsx';
import { ShareModal } from '../Sharing/ShareModal.jsx';
import { HistoryDrawer } from '../History/HistoryDrawer.jsx';
import { Button, Card, Input, Field, Alert, Skeleton, EmptyState } from '../ui/index.js';
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
import { CATEGORY_OPTIONS } from './CategoryBadge.jsx';
import { itemFields, buildMetadata } from '../../lib/item-fields.js';

function LayoutGridIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function ListIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function FolderIcon({ className = 'size-3.5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

const VIEW_OPTIONS = [
  { value: 'grid', label: 'การ์ด', Icon: LayoutGridIcon },
  { value: 'table', label: 'ตาราง', Icon: ListIcon },
];

const CATEGORY_FILTERS = [{ value: 'ALL', label: 'ทั้งหมด' }, ...CATEGORY_OPTIONS];

/** Pill toggle used by every filter in the toolbar. */
function FilterPill({ pressed, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-8 max-w-[14rem] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-ui transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0 ${
        pressed
          ? 'border-input bg-accent text-foreground'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

export function VaultDashboard({ initialCollectionFilter = null } = {}) {
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
  const [selectedCollectionFilter, setSelectedCollectionFilter] = useState(initialCollectionFilter || 'ALL');
  useEffect(() => {
    if (initialCollectionFilter) setSelectedCollectionFilter(initialCollectionFilter);
  }, [initialCollectionFilter]);

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

  // Each load gets an id; results of an older (or unmounted) load are discarded so a slow
  // response can never overwrite newer state.
  const loadSeqRef = useRef(0);
  useEffect(() => () => {
    loadSeqRef.current += 1;
  }, []);

  const loadItems = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const isStale = () => seq !== loadSeqRef.current;
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
        if (!isStale()) setCollections(loadedCollections);
      } catch (e) {
        console.warn('Could not load collections:', e);
      }

      // 3. For each accessible collection, unwrap key & fetch collection items
      const collectionItemsMap = new Map();
      const collectionKeyCache = new Map();

      const failedCollections = [];
      await Promise.all(
        loadedCollections.map(async (col) => {
          const cid = col.collection_id || col.id;
          try {
            let colKey = null;
            if (privateKey) {
              try {
                const keyRes = await api.collections.getKeys(cid);
                colKey = await ClientCrypto.unwrapCollectionKey(keyRes?.key?.encryptedKeyForRecipient, privateKey);
                collectionKeyCache.set(cid, colKey);
              } catch {
                // No key for this collection yet: its items are listed but stay locked.
              }
            }

            const itemsRes = await api.collections.listItems(cid);
            for (const it of itemsRes?.items || []) {
              const iid = it.item_id || it.id;
              let decryptedPayload = null;
              if (it.encrypted_data && colKey) {
                try {
                  decryptedPayload = await ClientCrypto.decryptCollectionItem(it.encrypted_data, colKey);
                } catch {
                  decryptedPayload = null;
                }
              }
              if (!decryptedPayload && it.encrypted_data) {
                // The owner's own item may still be encrypted with their Vault Key.
                decryptedPayload = await ClientCrypto.decryptItem(it.encrypted_data, mek).catch(() => null);
              }
              collectionItemsMap.set(iid, { ...it, _decrypted: decryptedPayload, _collection: col, _collectionId: cid });
            }
          } catch (colErr) {
            failedCollections.push(col.name || cid);
            console.warn(`Could not load items for collection ${cid}:`, colErr);
          }
        })
      );
      if (failedCollections.length && !isStale()) {
        addToast(`โหลดรายการจากคอลเลกชันไม่สำเร็จ: ${failedCollections.join(', ')} ลองโหลดใหม่อีกครั้ง`, 'error', 6000);
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
                decryptedPayload = await ClientCrypto.decryptItem(it.encrypted_data, mek);
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

      if (!isStale()) setItems(allCombined);
    } catch (err) {
      if (!isStale()) setError(err.message || 'โหลดรายการไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [mek, privateKey, addToast]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!unlockPassword) {
      setUnlockError('กรุณากรอกรหัสผ่านหลัก');
      return;
    }
    setUnlockLoading(true);
    setUnlockError(null);
    try {
      await unlockVault(unlockPassword);
      setUnlockPassword('');
      addToast('ปลดล็อกคลังรหัสผ่านแล้ว', 'success');
    } catch (err) {
      setUnlockError(err.message || 'รหัสผ่านหลักไม่ถูกต้อง ลองอีกครั้ง');
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
      addToast('คัดลอกรหัสผ่านแล้ว', 'success');
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
    addToast('คัดลอกชื่อผู้ใช้แล้ว', 'success');
  };

  // Interactive favorite star button toggling with optimistic update & API sync
  const handleToggleFavorite = async (item) => {
    const itemId = item.item_id || item.id;
    const currentItem = items.find((it) => (it.item_id || it.id) === itemId) || item;
    const currentFav = Boolean(currentItem.metadata?.favorite);
    const updatedFav = !currentFav;
    const updatedMetadata = buildMetadata({
      favorite: updatedFav,
      collectionId: currentItem.metadata?.collection_id,
    });

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
        updatedFav ? 'เพิ่มในรายการโปรดแล้ว' : 'นำออกจากรายการโปรดแล้ว',
        'success'
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
      addToast(err.message || 'อัปเดตรายการโปรดไม่สำเร็จ ลองอีกครั้ง', 'error');
    }
  };

  const handleDeleteItem = async (itemToDelete) => {
    setActionLoading(true);
    try {
      const itemId = itemToDelete.item_id || itemToDelete.id;
      await api.vault.deleteItem(itemId, itemToDelete.vault_id);
      addToast('ลบรายการแล้ว', 'success');
      setActiveModal(null);
      setSelectedItem(null);
      loadItems();
    } catch (err) {
      addToast(err.message || 'ลบรายการไม่สำเร็จ ลองอีกครั้ง', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered and searched items
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const meta = it.metadata || {};
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
        // Search runs on decrypted fields only (nothing searchable is stored in plaintext).
        const f = itemFields(it);
        const matchTitle = f.title.toLowerCase().includes(q);
        const matchUser = f.username.toLowerCase().includes(q);
        const matchUrl = f.url.toLowerCase().includes(q);
        const matchTags = f.tags.some((t) => String(t).toLowerCase().includes(q));
        const matchNotes = f.notes.toLowerCase().includes(q);

        return matchTitle || matchUser || matchUrl || matchTags || matchNotes;
      }

      return true;
    });
  }, [items, searchQuery, selectedCategory, filterFavorites, selectedCollectionFilter]);

  const hasFilters =
    Boolean(searchQuery.trim()) || selectedCategory !== 'ALL' || filterFavorites || selectedCollectionFilter !== 'ALL';

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('ALL');
    setFilterFavorites(false);
    setSelectedCollectionFilter('ALL');
  };

  const openAdd = () => {
    setSelectedItem(null);
    setActiveModal('add');
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelectedItem(null);
  };

  // Radiogroup keyboard support: arrow keys move the selection between the two views.
  const handleViewKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = viewMode === 'grid' ? 'table' : 'grid';
    handleViewChange(next);
    e.currentTarget.parentElement?.querySelector(`[data-view="${next}"]`)?.focus();
  };

  // If vault is locked in current session
  if (!isVaultUnlocked) {
    return (
      <Card className="mx-auto mt-6 max-w-md p-6 sm:mt-12 sm:p-8">
        <div className="mb-5 flex size-10 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground" aria-hidden="true">
          <LockIcon className="size-5" />
        </div>
        <h1 className="text-2xl tracking-tight">คลังรหัสผ่านถูกล็อก</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          กรอกรหัสผ่านหลักเพื่อเปิดคลัง คีย์สำหรับถอดรหัสจะอยู่เฉพาะในแท็บเบราว์เซอร์นี้เท่านั้น
          และจะหายไปเมื่อปิดแท็บหรือออกจากระบบ
        </p>

        <form onSubmit={handleUnlock} noValidate className="mt-6 grid gap-4">
          <Field label="รหัสผ่านหลัก" required error={unlockError}>
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="current-password"
                value={unlockPassword}
                onChange={(e) => {
                  setUnlockPassword(e.target.value);
                  if (unlockError) setUnlockError(null);
                }}
                autoFocus
              />
            )}
          </Field>
          <Button type="submit" loading={unlockLoading} className="w-full">
            {!unlockLoading && <UnlockIcon />}
            {unlockLoading ? 'กำลังปลดล็อก…' : 'ปลดล็อก'}
          </Button>
        </form>
      </Card>
    );
  }

  // Add / edit form replaces the list (UC-4 / UC-5)
  if (activeModal === 'add' || activeModal === 'edit') {
    return <ItemModal isOpen={true} item={selectedItem} onClose={closeModal} onSuccess={loadItems} />;
  }

  const viewProps = {
    items: filteredItems,
    revealedIds,
    copiedId,
    onToggleReveal: toggleReveal,
    onCopyPassword: handleCopyPassword,
    onCopyUsername: handleCopyUsername,
    onToggleFavorite: handleToggleFavorite,
    onEdit: (it) => {
      setSelectedItem(it);
      setActiveModal('edit');
    },
    onShare: (it) => {
      setSelectedItem(it);
      setActiveModal('share');
    },
    onHistory: (it) => {
      setSelectedItem(it);
      setActiveModal('history');
    },
    onDelete: (it) => {
      setSelectedItem(it);
      setActiveModal('delete');
    },
    collections,
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">คลังรหัสผ่าน</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            ทุกรายการถูกเข้ารหัสบนเครื่องของคุณก่อนบันทึก เซิร์ฟเวอร์อ่านรหัสผ่านของคุณไม่ได้
          </p>
        </div>
        <Button onClick={openAdd} className="w-full sm:w-auto">
          <PlusIcon />
          เพิ่มรายการ
        </Button>
      </header>

      {/* Toolbar */}
      <div className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <label htmlFor="vault-search" className="sr-only">
              ค้นหารายการ
            </label>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="vault-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาจากชื่อ ชื่อผู้ใช้ เว็บไซต์ แท็ก หรือบันทึก"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <div role="radiogroup" aria-label="รูปแบบการแสดงผล" className="inline-flex rounded-md border border-border p-0.5">
              {VIEW_OPTIONS.map(({ value, label, Icon }) => {
                const checked = viewMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    data-view={value}
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    onClick={() => handleViewChange(value)}
                    onKeyDown={handleViewKeyDown}
                    className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm font-ui transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      checked ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon />
                    {label}
                  </button>
                );
              })}
            </div>
            <Button variant="outline" size="icon" onClick={loadItems} disabled={loading} aria-label="โหลดรายการใหม่">
              <RefreshIcon className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="กรองตามหมวดหมู่">
          {CATEGORY_FILTERS.map((cat) => (
            <FilterPill key={cat.value} pressed={selectedCategory === cat.value} onClick={() => setSelectedCategory(cat.value)}>
              {cat.label}
            </FilterPill>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <FilterPill pressed={filterFavorites} onClick={() => setFilterFavorites(!filterFavorites)}>
            <StarIcon filled={filterFavorites} />
            รายการโปรด
          </FilterPill>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="vault-collection-filter-label">
          <span id="vault-collection-filter-label" className="text-caption text-muted-foreground">
            คอลเลกชัน
          </span>
          <FilterPill pressed={selectedCollectionFilter === 'ALL'} onClick={() => setSelectedCollectionFilter('ALL')}>
            ทั้งหมด
          </FilterPill>
          <FilterPill pressed={selectedCollectionFilter === 'PERSONAL'} onClick={() => setSelectedCollectionFilter('PERSONAL')}>
            <LockIcon />
            คลังส่วนตัว
          </FilterPill>
          {collections.map((col) => {
            const cid = col.collection_id || col.id;
            return (
              <FilterPill key={cid} pressed={selectedCollectionFilter === cid} onClick={() => setSelectedCollectionFilter(cid)}>
                <FolderIcon />
                <span className="truncate">{col.name}</span>
              </FilterPill>
            );
          })}
        </div>
      </div>

      <section aria-live="polite" aria-busy={loading} aria-label="รายการในคลัง">
        {error && (
          <Alert
            variant="error"
            title="โหลดรายการไม่สำเร็จ"
            className="mb-4"
            action={
              <Button variant="outline" size="sm" onClick={loadItems} disabled={loading}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Card key={i} className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-5 w-1/3" />
              </Card>
            ))}
            <span className="sr-only">กำลังโหลดและถอดรหัสรายการ</span>
          </div>
        ) : error && items.length === 0 ? null : items.length === 0 ? (
          <EmptyState
            icon={<KeyIcon className="size-5" />}
            title="ยังไม่มีรายการในคลัง"
            description="เก็บรหัสผ่าน บัตร หรือบันทึกสำคัญไว้ที่นี่ ทุกอย่างถูกเข้ารหัสบนเครื่องของคุณก่อนบันทึก"
            action={
              <Button onClick={openAdd}>
                <PlusIcon />
                เพิ่มรายการแรก
              </Button>
            }
          />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={<SearchIcon className="size-5" />}
            title="ไม่พบรายการที่ตรงกับตัวกรอง"
            description={
              searchQuery.trim()
                ? `ไม่มีรายการที่ตรงกับ “${searchQuery.trim()}” ในตัวกรองที่เลือก`
                : 'ลองเปลี่ยนหมวดหมู่ คอลเลกชัน หรือปิดตัวกรองรายการโปรด'
            }
            action={
              hasFilters && (
                <Button variant="outline" onClick={clearFilters}>
                  ล้างตัวกรอง
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
              <p className="text-caption text-muted-foreground">
                {hasFilters
                  ? `แสดง ${filteredItems.length.toLocaleString('th-TH')} จาก ${items.length.toLocaleString('th-TH')} รายการ`
                  : `${items.length.toLocaleString('th-TH')} รายการ`}
              </p>
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
                  ล้างตัวกรอง
                </Button>
              )}
            </div>
            {viewMode === 'table' ? (
              <>
                {/* Narrow screens get cards; the table needs room for its columns. */}
                <div className="lg:hidden">
                  <VaultGridView {...viewProps} />
                </div>
                <div className="hidden lg:block">
                  <VaultTableView {...viewProps} />
                </div>
              </>
            ) : (
              <VaultGridView {...viewProps} />
            )}
          </>
        )}
      </section>

      {/* Delete Confirmation (UC-6) */}
      {activeModal === 'delete' && selectedItem && (
        <DeleteConfirmModal
          isOpen={true}
          item={selectedItem}
          loading={actionLoading}
          onClose={closeModal}
          onConfirm={handleDeleteItem}
        />
      )}

      {/* Share (UC-10) */}
      {activeModal === 'share' && selectedItem && (
        <ShareModal isOpen={true} item={selectedItem} onClose={closeModal} onSuccess={loadItems} />
      )}

      {/* History (UC-11) */}
      {activeModal === 'history' && selectedItem && (
        <HistoryDrawer isOpen={true} item={selectedItem} onClose={closeModal} onRestoreSuccess={loadItems} />
      )}
    </div>
  );
}

export default VaultDashboard;
