import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { HistoryIcon, CloseIcon, RefreshIcon, EyeIcon, EyeOffIcon, CopyIcon, CheckIcon, LockIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import {
  Button,
  Card,
  Alert,
  Skeleton,
  EmptyState,
  ConfirmDialog,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '../ui/index.js';
import { LockedBadge } from './CategoryBadge.jsx';
import { itemFields } from '../../lib/item-fields.js';

const formatDate = (value) =>
  value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function HistoryDrawer({ isOpen, item, onClose, onRestoreSuccess }) {
  const { mek, privateKey } = useAuth();
  const { addToast, copyPasswordWithAutoClear } = useToast();

  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [revealedVersions, setRevealedVersions] = useState(new Set());
  const [copiedVersion, setCopiedVersion] = useState(null);
  const [restoringVersion, setRestoringVersion] = useState(null);
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const closeButtonRef = useRef(null);

  const loadHistory = useCallback(() => {
    if (!isOpen || !item) return;
    setLoading(true);
    setError(null);
    const itemId = item.item_id || item.id;
    api.history
      .getHistory(itemId, item.vault_id)
      .then(async (res) => {
        const rawHistory = res.history || [];

        // Decrypt snapshots locally. Items in a collection are encrypted with the collection
        // key, older personal versions with the Vault Key — try both.
        let collectionKey = null;
        const collectionId = item._collectionId || item.metadata?.collection_id;
        if (collectionId && privateKey) {
          try {
            const keyRes = await api.collections.getKeys(collectionId);
            collectionKey = await ClientCrypto.unwrapCollectionKey(keyRes?.key?.encryptedKeyForRecipient, privateKey);
          } catch {
            collectionKey = null;
          }
        }
        const decryptedHistory = await Promise.all(
          rawHistory.map(async (h) => {
            let decryptedPayload = null;
            for (const key of [collectionKey, mek].filter(Boolean)) {
              if (decryptedPayload || !h.encrypted_data) break;
              decryptedPayload = await ClientCrypto.decryptItem(h.encrypted_data, key).catch(() => null);
            }
            return {
              ...h,
              _decrypted: decryptedPayload,
            };
          })
        );

        setHistoryList(decryptedHistory);
      })
      .catch((err) => {
        setError(err.message || 'โหลดประวัติเวอร์ชันไม่สำเร็จ ลองอีกครั้ง');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, item, mek, privateKey]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // The Sheet primitive does not move focus itself: start on the close button.
  useEffect(() => {
    if (isOpen) closeButtonRef.current?.focus();
  }, [isOpen]);

  if (!isOpen || !item) return null;

  const { title, locked } = itemFields(item);

  const toggleReveal = (ver) => {
    setRevealedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(ver)) next.delete(ver);
      else next.add(ver);
      return next;
    });
  };

  // Same 30-second clipboard auto-clear as the main list.
  const handleCopy = (ver, password) => {
    if (!password) return;
    if (copyPasswordWithAutoClear) {
      copyPasswordWithAutoClear(password, 30, `${title} (เวอร์ชัน ${ver})`);
    } else {
      navigator.clipboard.writeText(password);
      addToast(`คัดลอกรหัสผ่านของเวอร์ชัน ${ver} แล้ว`, 'success');
    }
    setCopiedVersion(ver);
    setTimeout(() => setCopiedVersion(null), 2500);
  };

  const handleRollback = async (version) => {
    setRestoringVersion(version);
    try {
      const itemId = item.item_id || item.id;
      await api.history.rollback(itemId, version, item.vault_id);
      addToast(`กู้คืนเป็นเวอร์ชัน ${version} แล้ว`, 'success');
      setRollbackTarget(null);
      if (onRestoreSuccess) onRestoreSuccess();
      onClose();
    } catch (err) {
      addToast(err.message || 'กู้คืนเวอร์ชันไม่สำเร็จ ลองอีกครั้ง', 'error');
    } finally {
      setRestoringVersion(null);
    }
  };

  const busy = restoringVersion !== null;

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        // Ignore Esc / overlay while the rollback confirmation is on top or a restore runs.
        if (!open && !rollbackTarget && !busy) onClose();
      }}
    >
      <SheetContent
        hideCloseButton
        aria-labelledby="history-sheet-title"
        aria-describedby="history-sheet-description"
        className="!gap-0 border-border bg-background !p-0 sm:max-w-lg"
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 !space-y-0 border-b border-border px-5 py-4 !text-left">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
              <HistoryIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <SheetTitle id="history-sheet-title" className="text-base !font-strong">
                ประวัติเวอร์ชัน
              </SheetTitle>
              <SheetDescription id="history-sheet-description" className="truncate text-caption">
                {locked ? 'รายการที่ถอดรหัสไม่ได้' : title} · เวอร์ชันปัจจุบัน v{item.version || 1}
              </SheetDescription>
            </div>
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            disabled={busy}
            aria-label="ปิดประวัติเวอร์ชัน"
            className="text-muted-foreground"
          >
            <CloseIcon />
          </Button>
        </SheetHeader>

        <section className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="space-y-3 p-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-8 w-1/2" />
                </Card>
              ))}
              <span className="sr-only">กำลังโหลดประวัติเวอร์ชัน</span>
            </div>
          ) : error ? (
            <Alert
              variant="error"
              title="โหลดประวัติเวอร์ชันไม่สำเร็จ"
              action={
                <Button variant="outline" size="sm" onClick={loadHistory}>
                  ลองอีกครั้ง
                </Button>
              }
            >
              {error}
            </Alert>
          ) : historyList.length === 0 ? (
            <EmptyState
              icon={<HistoryIcon className="size-5" />}
              title="ยังไม่มีประวัติการแก้ไข"
              description="รายการนี้ยังเป็นเวอร์ชันแรก เมื่อมีการแก้ไข เวอร์ชันก่อนหน้าจะแสดงที่นี่"
            />
          ) : (
            <ol className="grid gap-3">
              {historyList.map((hist) => {
                const decrypted = hist._decrypted || {};
                const isRevealed = revealedVersions.has(hist.version);
                const isRestoring = restoringVersion === hist.version;
                const canRead = Boolean(hist._decrypted);

                return (
                  <li key={hist.history_id || hist.version}>
                    <Card className="grid gap-3 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h3 className="text-sm font-strong">เวอร์ชัน {hist.version}</h3>
                        <p className="text-caption text-muted-foreground">{formatDate(hist.created_at)}</p>
                      </div>
                      <p className="-mt-2 text-caption text-muted-foreground">
                        แก้ไขโดย {hist.changed_by_username || hist.changed_by || 'ไม่ทราบผู้แก้ไข'}
                      </p>

                      {canRead ? (
                        <dl className="grid gap-1 rounded-md border border-border bg-secondary px-3 py-2 text-sm">
                          {decrypted.username && (
                            <div className="flex min-h-8 items-center gap-2">
                              <dt className="w-16 shrink-0 text-caption text-muted-foreground">ชื่อผู้ใช้</dt>
                              <dd className="min-w-0 truncate font-mono text-xs">{decrypted.username}</dd>
                            </div>
                          )}
                          <div className="flex min-h-8 items-center gap-2">
                            <dt className="w-16 shrink-0 text-caption text-muted-foreground">รหัสผ่าน</dt>
                            <dd className="flex min-w-0 flex-1 items-center justify-between gap-1">
                              {decrypted.password ? (
                                <>
                                  <span className="min-w-0 break-all font-mono text-xs">
                                    {isRevealed ? decrypted.password : '••••••••••••'}
                                    {!isRevealed && <span className="sr-only">ซ่อนอยู่</span>}
                                  </span>
                                  <span className="flex shrink-0 items-center">
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-muted-foreground hover:text-foreground"
                                      onClick={() => toggleReveal(hist.version)}
                                      aria-pressed={isRevealed}
                                      aria-label={`แสดงรหัสผ่านของเวอร์ชัน ${hist.version}`}
                                    >
                                      {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className={copiedVersion === hist.version ? 'text-success-foreground' : 'text-muted-foreground hover:text-foreground'}
                                      onClick={() => handleCopy(hist.version, decrypted.password)}
                                      aria-label={
                                        copiedVersion === hist.version
                                          ? `คัดลอกรหัสผ่านของเวอร์ชัน ${hist.version} แล้ว`
                                          : `คัดลอกรหัสผ่านของเวอร์ชัน ${hist.version}`
                                      }
                                    >
                                      {copiedVersion === hist.version ? <CheckIcon /> : <CopyIcon />}
                                    </Button>
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </dd>
                          </div>
                          {decrypted.notes && (
                            <div className="border-t border-border pt-1.5">
                              <dt className="sr-only">บันทึก</dt>
                              <dd className="line-clamp-3 whitespace-pre-line text-caption text-secondary-foreground">{decrypted.notes}</dd>
                            </div>
                          )}
                        </dl>
                      ) : (
                        <div className="flex items-start gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-caption text-muted-foreground">
                          <LockIcon className="mt-0.5 size-4 shrink-0" />
                          <div className="grid gap-1.5">
                            <LockedBadge className="w-fit" />
                            <p>ไม่มีคีย์สำหรับเปิดข้อมูลของเวอร์ชันนี้ในเบราว์เซอร์นี้</p>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end border-t border-border pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRollbackTarget(hist.version)}
                          disabled={busy}
                          loading={isRestoring}
                        >
                          {!isRestoring && <RefreshIcon />}
                          กู้คืนเวอร์ชันนี้
                        </Button>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <SheetFooter className="border-t border-border px-5 !py-3">
          <Button variant="outline" onClick={onClose} disabled={busy} className="w-full sm:w-auto">
            ปิด
          </Button>
        </SheetFooter>
      </SheetContent>

      <ConfirmDialog
        open={rollbackTarget !== null}
        onOpenChange={(open) => !open && setRollbackTarget(null)}
        title={`กู้คืนเป็นเวอร์ชัน ${rollbackTarget ?? ''}?`}
        description="ข้อมูลปัจจุบันของรายการนี้จะถูกแทนที่ด้วยข้อมูลจากเวอร์ชันที่เลือก"
        confirmLabel="กู้คืน"
        destructive={false}
        loading={busy}
        onConfirm={() => handleRollback(rollbackTarget)}
      />
    </Sheet>
  );
}

export default HistoryDrawer;
