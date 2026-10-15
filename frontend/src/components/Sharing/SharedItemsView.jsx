import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import ClientCrypto from '../../services/crypto.js';
import { ShareIcon, EyeIcon, EyeOffIcon, CopyIcon, CheckIcon, RefreshIcon, EditIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';

export function SharedItemsView({ onEditItem }) {
  const { mek, privateKey } = useAuth();
  const { addToast } = useToast();

  const [sharedItems, setSharedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revealedIds, setRevealedIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);

  const loadSharedItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.sharing.listSharedItems();
      const rawItems = res?.data || [];

      // Decrypt items locally
      const decryptedList = await Promise.all(
        rawItems.map(async (item) => {
          try {
            // If item has encrypted_data and MEK or unwrapped key
            let decryptedData = null;
            if (item.encrypted_data && mek) {
              try {
                decryptedData = await ClientCrypto.decryptItem(item.encrypted_data, mek);
              } catch (e) {
                // If encrypted with itemKey instead of MEK, unwrap key first
                if (item.encrypted_key_for_recipient && privateKey) {
                  try {
                    const unwrappedKey = await ClientCrypto.unwrapItemKey(
                      item.encrypted_key_for_recipient,
                      privateKey
                    );
                    decryptedData = await ClientCrypto.decryptItem(item.encrypted_data, unwrappedKey);
                  } catch (err) {
                    console.warn('Could not unwrap item key:', err);
                  }
                }
              }
            }
            return {
              ...item,
              _decrypted: decryptedData,
            };
          } catch {
            return item;
          }
        })
      );

      setSharedItems(decryptedList);
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดรายการรหัสผ่านที่แชร์ได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSharedItems();
  }, [mek, privateKey]);

  const toggleReveal = (id) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = (id, password) => {
    if (!password) return;
    navigator.clipboard.writeText(password);
    setCopiedId(id);
    addToast('คัดลอกรหัสผ่านแล้ว!', 'success');
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center space-x-2.5">
            <ShareIcon className="w-7 h-7 text-blue-400" />
            <span>รหัสผ่านที่แชร์กับคุณ (Shared with Me)</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            รายการรหัสผ่านที่สมาชิกคนอื่นในทีมแชร์มาให้คุณแบบปลอดภัยผ่าน Zero-Knowledge
          </p>
        </div>

        <button
          type="button"
          onClick={loadSharedItems}
          disabled={loading}
          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors flex items-center space-x-2 self-start"
        >
          <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          <span>รีเฟรชข้อมูล</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-2xl text-rose-200 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400">
          <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm">กำลังถอดรหัสและโหลดรายการที่แชร์...</p>
        </div>
      ) : sharedItems.length === 0 ? (
        <div className="py-16 text-center bg-slate-800/40 border border-slate-700/50 rounded-3xl p-8">
          <div className="w-16 h-16 rounded-3xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto mb-4">
            <ShareIcon className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-white">ยังไม่มีรายการที่แชร์กับคุณ</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            เมื่อมีผู้ใช้คนอื่นแชร์รหัสผ่านให้บัญชีของคุณ รายการจะปรากฏที่นี่โดยอัตโนมัติ
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sharedItems.map((item) => {
            const id = item.item_id || item.share_id;
            const meta = item.metadata || {};
            const decrypted = item._decrypted || {};
            const isRevealed = revealedIds.has(id);
            const canModify = item.permission_level === 'modify';

            return (
              <div
                key={id}
                className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 hover:border-blue-500/50 transition-all flex flex-col justify-between shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-base font-bold text-white tracking-tight">
                        {meta.title || item.title || 'Untitled'}
                      </h3>
                      <span className="text-xs text-slate-400">
                        แชร์โดย: <strong className="text-slate-300">{item.shared_by || item.shared_by_email || 'Owner'}</strong>
                      </span>
                    </div>
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
                        canModify
                          ? 'bg-purple-950/80 text-purple-300 border border-purple-500/40'
                          : 'bg-blue-950/80 text-blue-300 border border-blue-500/40'
                      }`}
                    >
                      {canModify ? 'Modify (แก้ไขได้)' : 'Read (อ่านอย่างเดียว)'}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-800 mb-4">
                    {decrypted.username && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Username:</span>
                        <span className="font-mono text-slate-200 select-all">{decrypted.username}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Password:</span>
                      <span className="font-mono text-emerald-400">
                        {isRevealed
                          ? decrypted.password || '••••••••'
                          : '••••••••••••'}
                      </span>
                    </div>
                    {decrypted.url && (
                      <div className="flex justify-between items-center truncate">
                        <span className="text-slate-500">URL:</span>
                        <a
                          href={decrypted.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:underline truncate max-w-[160px]"
                        >
                          {decrypted.url}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-700/60 text-xs">
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => toggleReveal(id)}
                      className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-700/60 transition-colors"
                      title={isRevealed ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    >
                      {isRevealed ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(id, decrypted.password)}
                      disabled={!decrypted.password}
                      className="p-2 text-slate-400 hover:text-emerald-400 rounded-lg hover:bg-slate-700/60 transition-colors"
                      title="คัดลอกรหัสผ่าน"
                    >
                      {copiedId === id ? <CheckIcon className="w-4 h-4 text-emerald-400" /> : <CopyIcon className="w-4 h-4" />}
                    </button>
                  </div>

                  {canModify && onEditItem && (
                    <button
                      type="button"
                      onClick={() => onEditItem(item)}
                      className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600 text-purple-300 hover:text-white rounded-lg transition-colors flex items-center space-x-1 font-medium"
                    >
                      <EditIcon className="w-3.5 h-3.5" />
                      <span>แก้ไข</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SharedItemsView;
