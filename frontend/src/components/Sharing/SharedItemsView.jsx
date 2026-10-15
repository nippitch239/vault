import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import { ShareIcon, EyeIcon, EyeOffIcon, CopyIcon, CheckIcon, RefreshIcon, EditIcon, LockIcon, ExternalLinkIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { itemFields } from '../../lib/item-fields.js';
import { decryptVaultItem } from '../../lib/item-crypto.js';
import { ItemModal } from '../Vault/ItemModal.jsx';
import { Button, Badge, Card, Alert, Skeleton, EmptyState } from '../ui/index.js';

const SHARE_PERMISSION = {
  modify: { label: 'แก้ไขได้', variant: 'success' },
  read: { label: 'อ่านอย่างเดียว', variant: 'outline' },
};

const isSafeUrl = (url) => /^https?:\/\//i.test(String(url || ''));

export function SharedItemsView() {
  const { mek, privateKey } = useAuth();
  const { addToast } = useToast();

  const [sharedItems, setSharedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revealedIds, setRevealedIds] = useState(new Set());
  const [copied, setCopied] = useState(null); // `${id}:${field}`
  const [editingItem, setEditingItem] = useState(null); // shares with 'modify'
  const copiedTimer = useRef(null);

  const loadSharedItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.sharing.listSharedItems();
      const rawItems = res?.data || [];

      // Decrypt locally: the share carries the item's own key wrapped with our public key.
      const decryptedList = await Promise.all(
        rawItems.map(async (item) => {
          const { payload } = await decryptVaultItem(item, { privateKey });
          return { ...item, _decrypted: payload };
        })
      );

      setSharedItems(decryptedList);
    } catch (err) {
      setError(err.message || 'โหลดรายการที่แชร์กับคุณไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, [privateKey]);

  useEffect(() => {
    loadSharedItems();
  }, [loadSharedItems]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const toggleReveal = (id) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = (key, value, message) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(key);
    addToast(message, 'success');
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 2500);
  };

  const lockedCount = sharedItems.filter((item) => !item._decrypted).length;

  // Editing re-encrypts with the item's own key, so the owner and other recipients still read it.
  if (editingItem) {
    return <ItemModal isOpen={true} item={editingItem} onClose={() => setEditingItem(null)} onSuccess={loadSharedItems} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">แชร์กับฉัน</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            รายการที่ผู้อื่นแชร์ให้คุณ ถอดรหัสบนเครื่องของคุณเท่านั้น เซิร์ฟเวอร์อ่านเนื้อหาไม่ได้
          </p>
        </div>
        <Button variant="outline" onClick={loadSharedItems} disabled={loading} className="w-full sm:w-auto">
          <RefreshIcon className={loading ? 'animate-spin' : ''} />
          โหลดใหม่
        </Button>
      </header>

      <section aria-live="polite" aria-busy={loading} className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-16 w-full" />
              </Card>
            ))}
            <span className="sr-only">กำลังโหลดและถอดรหัสรายการที่แชร์</span>
          </div>
        ) : error ? (
          <Alert
            variant="error"
            title="โหลดรายการที่แชร์ไม่สำเร็จ"
            action={
              <Button variant="outline" size="sm" onClick={loadSharedItems}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {error}
          </Alert>
        ) : sharedItems.length === 0 ? (
          <EmptyState
            icon={<ShareIcon className="size-5" />}
            title="ยังไม่มีรายการที่แชร์กับคุณ"
            description="เมื่อมีคนแชร์รหัสผ่านให้บัญชีของคุณ รายการจะแสดงที่นี่ ลองโหลดใหม่หากเพิ่งได้รับแจ้ง"
            action={
              <Button variant="outline" onClick={loadSharedItems}>
                <RefreshIcon />
                โหลดใหม่
              </Button>
            }
          />
        ) : (
          <>
            {lockedCount > 0 && (
              <Alert variant="warning" title={`ยังถอดรหัสไม่ได้ ${lockedCount.toLocaleString('th-TH')} รายการ`}>
                {!mek
                  ? 'คลังรหัสผ่านถูกล็อกอยู่ ปลดล็อกแล้วโหลดใหม่เพื่อดูรายละเอียด'
                  : 'คีย์ของรายการเหล่านี้เปิดด้วยบัญชีนี้ไม่ได้ ขอให้ผู้แชร์ส่งรายการให้อีกครั้ง'}
              </Alert>
            )}

            <p className="text-caption text-muted-foreground">{sharedItems.length.toLocaleString('th-TH')} รายการ</p>

            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sharedItems.map((item) => {
                const id = item.item_id || item.share_id;
                const fields = itemFields(item);
                const locked = fields.locked;
                const isRevealed = revealedIds.has(id);
                const canModify = item.permission_level === 'modify';
                const perm = SHARE_PERMISSION[canModify ? 'modify' : 'read'];
                const sharedBy = item.shared_by || item.shared_by_email || 'เจ้าของรายการ';
                const title = locked ? 'รายการที่แชร์' : fields.title;

                return (
                  <li key={id}>
                    <Card className="flex h-full flex-col p-5 transition-colors duration-fast hover:border-input">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
                            {locked ? <LockIcon className="size-4" /> : <ShareIcon className="size-4" />}
                          </div>
                          <div className="min-w-0">
                            <h2 className="truncate text-base" title={title}>
                              {title}
                            </h2>
                            <p className="truncate text-caption text-muted-foreground">แชร์โดย {sharedBy}</p>
                          </div>
                        </div>
                        <Badge variant={perm.variant}>{perm.label}</Badge>
                      </div>

                      {locked ? (
                        <div className="mt-4 flex flex-1 items-start gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-3 text-sm">
                          <LockIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                          <div>
                            <p className="font-ui text-foreground">ยังถอดรหัสรายการนี้ไม่ได้</p>
                            <p className="mt-0.5 text-caption text-muted-foreground">
                              {!mek ? 'ปลดล็อกคลังแล้วโหลดใหม่' : 'ขอให้ผู้แชร์ส่งรายการนี้ให้อีกครั้ง'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <dl className="mt-4 grid flex-1 content-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm">
                          {fields.username && (
                            <div className="flex items-center gap-2">
                              <dt className="w-20 shrink-0 text-caption text-muted-foreground">ชื่อผู้ใช้</dt>
                              <dd className="min-w-0 flex-1 truncate font-mono text-foreground">{fields.username}</dd>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleCopy(`${id}:username`, fields.username, 'คัดลอกชื่อผู้ใช้แล้ว')}
                                aria-label={copied === `${id}:username` ? 'คัดลอกชื่อผู้ใช้แล้ว' : `คัดลอกชื่อผู้ใช้ของ ${title}`}
                              >
                                {copied === `${id}:username` ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
                              </Button>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <dt className="w-20 shrink-0 text-caption text-muted-foreground">รหัสผ่าน</dt>
                            <dd className="min-w-0 flex-1 truncate font-mono text-foreground">
                              {!fields.password ? (
                                <span className="font-sans text-muted-foreground">ไม่มีรหัสผ่าน</span>
                              ) : isRevealed ? (
                                fields.password
                              ) : (
                                <><span aria-hidden="true">••••••••••••</span><span className="sr-only">ซ่อนอยู่</span></>
                              )}
                            </dd>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => toggleReveal(id)}
                              disabled={!fields.password}
                              aria-label={isRevealed ? `ซ่อนรหัสผ่านของ ${title}` : `แสดงรหัสผ่านของ ${title}`}
                              aria-pressed={isRevealed}
                            >
                              {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleCopy(`${id}:password`, fields.password, 'คัดลอกรหัสผ่านแล้ว')}
                              disabled={!fields.password}
                              aria-label={copied === `${id}:password` ? 'คัดลอกรหัสผ่านแล้ว' : `คัดลอกรหัสผ่านของ ${title}`}
                            >
                              {copied === `${id}:password` ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
                            </Button>
                          </div>
                          {fields.url && (
                            <div className="flex items-center gap-2">
                              <dt className="w-20 shrink-0 text-caption text-muted-foreground">เว็บไซต์</dt>
                              <dd className="min-w-0 flex-1 truncate">
                                {isSafeUrl(fields.url) ? (
                                  <a
                                    href={fields.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex max-w-full items-center gap-1 text-ring underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                                  >
                                    <span className="truncate">{fields.url}</span>
                                    <ExternalLinkIcon className="size-3.5 shrink-0" />
                                    <span className="sr-only">(เปิดในแท็บใหม่)</span>
                                  </a>
                                ) : (
                                  <span className="text-secondary-foreground">{fields.url}</span>
                                )}
                              </dd>
                            </div>
                          )}
                        </dl>
                      )}

                      {canModify && !locked && (
                        <div className="mt-4 flex justify-end border-t border-border pt-4">
                          <Button variant="secondary" size="sm" onClick={() => setEditingItem(item)}>
                            <EditIcon />
                            แก้ไข
                          </Button>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

export default SharedItemsView;
