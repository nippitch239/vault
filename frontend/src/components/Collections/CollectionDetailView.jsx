import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../Common/Toast.jsx';
import api from '../../services/api.js';
import { decryptVaultItem, fetchCollectionKey } from '../../lib/item-crypto.js';
import { itemFields } from '../../lib/item-fields.js';
import { ItemModal } from '../Vault/ItemModal.jsx';
import { ShareModal } from '../Sharing/ShareModal.jsx';
import { HistoryDrawer } from '../History/HistoryDrawer.jsx';
import { VaultGridView } from '../Vault/VaultGridView.jsx';
import { VaultTableView } from '../Vault/VaultTableView.jsx';
import { CATEGORY_OPTIONS } from '../Vault/CategoryBadge.jsx';
import { PERMISSION_LABELS, PERMISSION_BADGE } from './CollectionsView.jsx';
import {
  Button,
  Badge,
  Card,
  Input,
  Alert,
  Skeleton,
  EmptyState,
  ConfirmDialog,
} from '../ui/index.js';
import {
  PlusIcon,
  SearchIcon,
  RefreshIcon,
  ShieldIcon,
  EditIcon,
  TrashIcon,
  StarIcon,
} from '../Common/Icons.jsx';

function ArrowLeftIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

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

function FolderIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

const VIEW_OPTIONS = [
  { value: 'grid', label: 'การ์ด', Icon: LayoutGridIcon },
  { value: 'table', label: 'ตาราง', Icon: ListIcon },
];

const CATEGORY_FILTERS = [{ value: 'ALL', label: 'ทั้งหมด' }, ...CATEGORY_OPTIONS];

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

export function CollectionDetailView({
  collection,
  onBack,
  onEditCollection,
  onDeleteCollection,
  onManageAccess,
}) {
  const { mek, privateKey, isAdmin } = useAuth();
  const { addToast, copyPasswordWithAutoClear } = useToast();

  const colId = collection.collection_id || collection.id;
  const perm = String(collection.effectivePermission || collection.effective_permission || 'read').toLowerCase();
  const canAdmin = perm === 'admin' || isAdmin;
  const canWrite = perm === 'write' || canAdmin;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('securevault_collection_view_mode') || 'grid';
    } catch {
      return 'grid';
    }
  });

  const handleViewChange = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('securevault_collection_view_mode', mode);
    } catch {}
  };

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [filterFavorites, setFilterFavorites] = useState(false);

  // Modals
  const [activeModal, setActiveModal] = useState(null); // 'add' | 'edit' | 'remove' | 'share' | 'history'
  const [selectedItem, setSelectedItem] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Password reveal & copy tracking
  const [revealedIds, setRevealedIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);

  const loadSeqRef = useRef(0);
  useEffect(() => () => {
    loadSeqRef.current += 1;
  }, []);

  const loadItems = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const isStale = () => seq !== loadSeqRef.current;

    setLoading(true);
    setError(null);
    try {
      const [itemsRes, colKey] = await Promise.all([
        api.collections.listItems(colId),
        fetchCollectionKey(colId, privateKey),
      ]);

      const rawItems = itemsRes?.items || [];
      const decrypted = await Promise.all(
        rawItems.map(async (it) => {
          const { payload } = await decryptVaultItem(it, {
            mek,
            collectionKey: colKey,
            privateKey,
          });
          return {
            ...it,
            _decrypted: payload,
            _collection: collection,
            _collectionId: colId,
            _collectionIds: new Set([colId]),
          };
        })
      );

      if (!isStale()) setItems(decrypted);
    } catch (err) {
      if (!isStale()) setError(err.message || 'ไม่สามารถโหลดรหัสผ่านในคอลเลกชันได้');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [colId, privateKey, mek, collection]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleToggleReveal = (id) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyPassword = (password, itemTitle) => {
    copyPasswordWithAutoClear(password, itemTitle);
  };

  const handleCopyUsername = (username) => {
    if (!username) return;
    navigator.clipboard.writeText(username).then(() => {
      addToast('คัดลอกชื่อผู้ใช้แล้ว', 'info');
    });
  };

  const handleCopyNote = (notes, itemId, itemTitle) => {
    if (!notes) return;
    navigator.clipboard.writeText(notes).then(() => {
      addToast(`คัดลอกบันทึกของ “${itemTitle}” แล้ว`, 'info');
      setCopiedId(itemId);
      setTimeout(() => setCopiedId((curr) => (curr === itemId ? null : curr)), 2000);
    });
  };

  const handleToggleFavorite = async (itemId) => {
    const currentItem = items.find((i) => (i.item_id || i.id) === itemId);
    if (!currentItem) return;

    const currentFav = Boolean(currentItem.metadata?.favorite);
    const updatedFav = !currentFav;

    setItems((prev) =>
      prev.map((i) =>
        (i.id === itemId || i.item_id === itemId)
          ? { ...i, metadata: { ...i.metadata, favorite: updatedFav } }
          : i
      )
    );

    try {
      const res = await api.vault.updateItem(
        itemId,
        {
          metadata: { ...(currentItem.metadata || {}), favorite: updatedFav },
          version: currentItem.version,
        },
        currentItem.vault_id
      );

      setItems((prev) =>
        prev.map((i) =>
          (i.id === itemId || i.item_id === itemId)
            ? {
                ...i,
                version: res?.data?.version || res?.version || (i.version + 1),
                metadata: { ...i.metadata, favorite: updatedFav },
              }
            : i
        )
      );

      addToast(updatedFav ? 'เพิ่มในรายการโปรดแล้ว' : 'นำออกจากรายการโปรดแล้ว', 'success');
    } catch (err) {
      setItems((prev) =>
        prev.map((it) =>
          (it.item_id || it.id) === itemId
            ? { ...it, metadata: { ...(it.metadata || {}), favorite: currentFav } }
            : it
        )
      );
      addToast(err.message || 'อัปเดตรายการโปรดไม่สำเร็จ', 'error');
    }
  };

  const handleRemoveFromCollection = async () => {
    if (!selectedItem) return;
    setActionLoading(true);
    try {
      const itemId = selectedItem.item_id || selectedItem.id;
      await api.collections.removeItem(colId, itemId);
      addToast('นำรหัสผ่านออกจากคอลเลกชันแล้ว', 'success');
      setActiveModal(null);
      setSelectedItem(null);
      loadItems();
    } catch (err) {
      addToast(err.message || 'นำรหัสผ่านออกจากคอลเลกชันไม่สำเร็จ', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const meta = it.metadata || {};
      const type = (it.item_type || 'login').toUpperCase();

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

      if (filterFavorites && !meta.favorite) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
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
  }, [items, searchQuery, selectedCategory, filterFavorites]);

  const selectedItemTitle = selectedItem ? itemFields(selectedItem).title : '';

  return (
    <div className="space-y-6">
      {/* Back button & Collection info header */}
      <div className="space-y-4 border-b border-border pb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-2 text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeftIcon />
          กลับไปคอลเลกชันทั้งหมด
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-foreground">
              <FolderIcon className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl tracking-tight truncate">{collection.name}</h1>
                <Badge variant={PERMISSION_BADGE[perm] || 'outline'}>
                  {PERMISSION_LABELS[perm] || perm}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {collection.description || 'ไม่มีคำอธิบายสำหรับคอลเลกชันนี้'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {items.length.toLocaleString('th-TH')} รายการในคอลเลกชันนี้
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <Button onClick={() => setActiveModal('add')} className="w-full sm:w-auto">
                <PlusIcon />
                เพิ่มรหัสผ่านในคอลเลกชัน
              </Button>
            )}

            {canAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={() => onManageAccess?.(collection)}>
                  <ShieldIcon />
                  จัดการสิทธิ์
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEditCollection?.(collection)}
                  aria-label="แก้ไขคอลเลกชัน"
                >
                  <EditIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:bg-error hover:text-error-foreground"
                  onClick={() => onDeleteCollection?.(collection)}
                  aria-label="ลบคอลเลกชัน"
                >
                  <TrashIcon />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar: Search, Filters, View mode */}
      <div className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <label htmlFor="collection-item-search" className="sr-only">
              ค้นหารหัสผ่านในคอลเลกชัน
            </label>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="collection-item-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหารหัสผ่านในคอลเลกชันนี้..."
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
                    aria-checked={checked}
                    onClick={() => handleViewChange(value)}
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
            <Button
              variant="outline"
              size="icon"
              onClick={loadItems}
              disabled={loading}
              aria-label="โหลดรายการใหม่"
            >
              <RefreshIcon className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="กรองตามหมวดหมู่">
          {CATEGORY_FILTERS.map((cat) => (
            <FilterPill
              key={cat.value}
              pressed={selectedCategory === cat.value}
              onClick={() => setSelectedCategory(cat.value)}
            >
              {cat.label}
            </FilterPill>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <FilterPill pressed={filterFavorites} onClick={() => setFilterFavorites(!filterFavorites)}>
            <StarIcon filled={filterFavorites} />
            รายการโปรด
          </FilterPill>
        </div>
      </div>

      {/* Content Area */}
      <section aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-8 w-full" />
              </Card>
            ))}
            <span className="sr-only">กำลังโหลดรายการรหัสผ่านในคอลเลกชัน</span>
          </div>
        ) : error ? (
          <Alert
            variant="error"
            title="โหลดรายการไม่สำเร็จ"
            action={
              <Button variant="outline" size="sm" onClick={loadItems}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {error}
          </Alert>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FolderIcon className="size-6" />}
            title="ยังไม่มีรหัสผ่านในคอลเลกชันนี้"
            description="รหัสผ่านที่เพิ่มลงในคอลเลกชันนี้จะถูกแชร์กับสมาชิกที่ได้รับสิทธิ์อย่างปลอดภัย"
            action={
              canWrite ? (
                <Button onClick={() => setActiveModal('add')}>
                  <PlusIcon />
                  เพิ่มรหัสผ่านแรกในคอลเลกชัน
                </Button>
              ) : null
            }
          />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={<SearchIcon className="size-5" />}
            title="ไม่พบรหัสผ่านที่ตรงกับเงื่อนไข"
            description="ลองเปลี่ยนคำค้นหาหรือตัวกรองหมวดหมู่"
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                  setFilterFavorites(false);
                }}
              >
                ล้างตัวกรอง
              </Button>
            }
          />
        ) : viewMode === 'table' ? (
          <VaultTableView
            items={filteredItems}
            revealedIds={revealedIds}
            copiedId={copiedId}
            onToggleReveal={handleToggleReveal}
            onCopyPassword={handleCopyPassword}
            onCopyUsername={handleCopyUsername}
            onCopyNote={handleCopyNote}
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
              setActiveModal('remove');
            }}
            collections={[collection]}
          />
        ) : (
          <VaultGridView
            items={filteredItems}
            revealedIds={revealedIds}
            copiedId={copiedId}
            onToggleReveal={handleToggleReveal}
            onCopyPassword={handleCopyPassword}
            onCopyUsername={handleCopyUsername}
            onCopyNote={handleCopyNote}
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
              setActiveModal('remove');
            }}
            collections={[collection]}
          />
        )}
      </section>

      {/* Item Modal: Add new or edit existing in this collection */}
      <ItemModal
        isOpen={activeModal === 'add' || activeModal === 'edit'}
        item={activeModal === 'edit' ? selectedItem : null}
        defaultCollectionId={colId}
        onClose={() => {
          setActiveModal(null);
          setSelectedItem(null);
        }}
        onSuccess={() => {
          setActiveModal(null);
          setSelectedItem(null);
          loadItems();
        }}
      />

      {/* Remove Item from Collection Confirmation */}
      <ConfirmDialog
        open={activeModal === 'remove'}
        onOpenChange={(open) => {
          if (!open) {
            setActiveModal(null);
            setSelectedItem(null);
          }
        }}
        title={`นำ “${selectedItemTitle}” ออกจากคอลเลกชัน?`}
        description="รหัสผ่านนี้จะไม่แสดงในคอลเลกชันนี้อีกต่อไป และสมาชิกคนอื่นจะไม่สามารถเข้าถึงได้ แต่ข้อมูลในคลังส่วนตัวของเจ้าของจะยังคงอยู่"
        confirmLabel="นำออกจากคอลเลกชัน"
        loading={actionLoading}
        onConfirm={handleRemoveFromCollection}
      />

      {/* Share Modal */}
      {activeModal === 'share' && selectedItem && (
        <ShareModal
          isOpen={true}
          item={selectedItem}
          onClose={() => {
            setActiveModal(null);
            setSelectedItem(null);
          }}
        />
      )}

      {/* History Drawer */}
      {activeModal === 'history' && selectedItem && (
        <HistoryDrawer
          isOpen={true}
          item={selectedItem}
          onClose={() => {
            setActiveModal(null);
            setSelectedItem(null);
          }}
          onRollbackSuccess={() => {
            setActiveModal(null);
            setSelectedItem(null);
            loadItems();
          }}
        />
      )}
    </div>
  );
}

export default CollectionDetailView;
