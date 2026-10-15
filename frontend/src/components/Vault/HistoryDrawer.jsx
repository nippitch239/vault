import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { HistoryIcon, CloseIcon, RefreshIcon, EyeIcon, EyeOffIcon, CopyIcon, CheckIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import { Button } from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';
import { itemFields } from '../../lib/item-fields.js';

export function HistoryDrawer({ isOpen, item, onClose, onRestoreSuccess }) {
  const { mek } = useAuth();
  const { addToast } = useToast();

  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [revealedVersions, setRevealedVersions] = useState(new Set());
  const [copiedVersion, setCopiedVersion] = useState(null);
  const [restoringVersion, setRestoringVersion] = useState(null);

  useEffect(() => {
    if (isOpen && item) {
      setLoading(true);
      setError(null);
      const itemId = item.item_id || item.id;
      api.history
        .getHistory(itemId, item.vault_id)
        .then(async (res) => {
          const rawHistory = res.history || [];

          // Decrypt historical snapshots locally in browser
          const decryptedHistory = await Promise.all(
            rawHistory.map(async (h) => {
              let decryptedPayload = null;
              if (h.encrypted_data && mek) {
                try {
                  decryptedPayload = await ClientCrypto.decryptItem(h.encrypted_data, mek);
                } catch (e) {
                  console.warn(`Could not decrypt version ${h.version}:`, e);
                }
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
          setError(err.message || 'ไม่สามารถโหลดประวัติเวอร์ชันได้');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, item, mek]);

  if (!isOpen || !item) return null;

  const toggleReveal = (ver) => {
    setRevealedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(ver)) next.delete(ver);
      else next.add(ver);
      return next;
    });
  };

  const handleCopy = (ver, password) => {
    if (!password) return;
    navigator.clipboard.writeText(password);
    setCopiedVersion(ver);
    addToast(`คัดลอกรหัสผ่านจากเวอร์ชัน ${ver} แล้ว!`, 'success');
    setTimeout(() => setCopiedVersion(null), 2500);
  };

  const handleRollback = async (version) => {
    setRestoringVersion(version);
    try {
      const itemId = item.item_id || item.id;
      await api.history.rollback(itemId, version, item.vault_id);
      addToast(`กู้คืนข้อมูลกลับไปยังเวอร์ชัน ${version} สำเร็จ!`, 'success');
      if (onRestoreSuccess) onRestoreSuccess();
      onClose();
    } catch (err) {
      addToast(err.message || 'เกิดข้อผิดพลาดในการกู้คืนเวอร์ชัน', 'error');
    } finally {
      setRestoringVersion(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex justify-end"
    >
      {/* Backdrop Overlay */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm transition-opacity duration-300 animate-content-show"
      />

      {/* Slide-over Sheet Content */}
      <div className="relative z-[60] inset-y-0 right-0 h-full w-full sm:max-w-md md:max-w-lg border-l border-border bg-background text-foreground p-6 shadow-2xl max-h-screen overflow-y-auto flex flex-col duration-300 animate-slide-in-from-right">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <HistoryIcon className="size-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-foreground">
                ประวัติการแก้ไขรหัสผ่าน
              </h3>
              <p className="text-xs text-muted-foreground truncate max-w-[240px]">
                {itemFields(item).title} (ปัจจุบัน v{item.version || 1})
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

        {error && (
          <div className="mt-4 p-3 bg-destructive/15 border border-destructive/30 rounded-lg text-destructive text-xs font-medium">
            {error}
          </div>
        )}

        {/* Scrollable Versions List */}
        <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1">
          {loading ? (
            <div className="py-20 text-center text-muted-foreground">
              <div className="inline-block size-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm">กำลังถอดรหัสประวัติเวอร์ชันย้อนหลัง...</p>
            </div>
          ) : historyList.length === 0 ? (
            <div className="py-16 text-center bg-muted/30 rounded-xl border border-border p-6 text-muted-foreground text-sm">
              ยังไม่มีประวัติการเปลี่ยนแปลงของรายการนี้ (รายการนี้ยังอยู่ในเวอร์ชันแรก)
            </div>
          ) : (
            historyList.map((hist) => {
              const decrypted = hist._decrypted || {};
              const isRevealed = revealedVersions.has(hist.version);
              const isRestoring = restoringVersion === hist.version;

              return (
                <div
                  key={hist.history_id || hist.version}
                  className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-mono font-bold">
                      เวอร์ชัน {hist.version}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(hist.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    แก้ไขโดย: <strong className="text-foreground">{hist.changed_by || hist.changed_by_username || 'ผู้ใช้'}</strong>
                  </div>

                  {decrypted.password ? (
                    <div className="p-3 bg-muted/40 rounded-lg border border-border space-y-2 text-xs">
                      {decrypted.username && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Username:</span>
                          <span className="text-foreground font-mono select-all">{decrypted.username}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Password:</span>
                        <span className="font-mono text-primary font-medium">
                          {isRevealed ? decrypted.password : '••••••••••••'}
                        </span>
                      </div>
                      {decrypted.notes && (
                        <div className="pt-1 border-t border-border text-muted-foreground italic">
                          “{decrypted.notes}”
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic p-2 bg-muted/20 rounded-md">
                      (ไม่สามารถถอดรหัสข้อมูลภาพรวมของเวอร์ชันนี้ได้)
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
                    <div className="flex space-x-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleReveal(hist.version)}
                        disabled={!decrypted.password}
                        className="size-8 text-muted-foreground hover:text-foreground"
                        title={isRevealed ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                      >
                        {isRevealed ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(hist.version, decrypted.password)}
                        disabled={!decrypted.password}
                        className="size-8 text-muted-foreground hover:text-foreground"
                        title="คัดลอกรหัสผ่าน"
                      >
                        {copiedVersion === hist.version ? (
                          <CheckIcon className="size-4 text-success" />
                        ) : (
                          <CopyIcon className="size-4" />
                        )}
                      </Button>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRollback(hist.version)}
                      disabled={isRestoring}
                      className="text-xs flex items-center space-x-1"
                    >
                      <RefreshIcon className={`size-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
                      <span>{isRestoring ? 'กำลังกู้คืน...' : 'กู้คืนเวอร์ชันนี้ (Restore)'}</span>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-border flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            ปิด (Close)
          </Button>
        </div>
      </div>
    </div>
  );
}

export default HistoryDrawer;
