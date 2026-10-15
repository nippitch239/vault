import React from 'react';
import { TrashIcon, CloseIcon } from '../Common/Icons.jsx';

export function DeleteConfirmModal({ isOpen, item, onClose, onConfirm, loading }) {
  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <CloseIcon className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <TrashIcon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">ยืนยันการลบรายการรหัสผ่าน</h3>
            <p className="text-xs text-slate-400">Delete Password Confirmation (UC-6)</p>
          </div>
        </div>

        <p className="text-sm text-slate-300 mb-4 leading-relaxed">
          คุณแน่ใจหรือไม่ว่าต้องการลบรายการ{' '}
          <strong className="text-white bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700 font-semibold">
            {item.metadata?.title || item.title || 'Untitled'}
          </strong>{' '}
          นี้ออกจากระบบอย่างถาวร?
        </p>

        <div className="p-3 bg-rose-950/30 border border-rose-500/20 rounded-xl text-xs text-rose-300 mb-6">
          ⚠️ การลบรายการนี้จะยกเลิกการแชร์ทั้งหมดที่เชื่อมโยงกับรายการนี้ และไม่สามารถกู้คืนได้
        </div>

        <div className="flex space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors"
          >
            ยกเลิก (Cancel)
          </button>
          <button
            type="button"
            onClick={() => onConfirm(item)}
            disabled={loading}
            className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center space-x-1 shadow-lg shadow-rose-950/40"
          >
            <TrashIcon className="w-4 h-4" />
            <span>{loading ? 'กำลังลบ...' : 'ยืนยันลบรายการ'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeleteConfirmModal;
