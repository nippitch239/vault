import React from 'react';
import { ConfirmDialog } from '../ui/Feedback.jsx';
import { itemFields } from '../../lib/item-fields.js';

export function DeleteConfirmModal({ isOpen, item, onClose, onConfirm, loading }) {
  if (!item) return null;
  const { title, locked } = itemFields(item);
  const name = locked ? 'รายการที่ถอดรหัสไม่ได้' : `“${title}”`;

  return (
    <ConfirmDialog
      open={Boolean(isOpen)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`ลบ ${name}?`}
      description="รายการนี้จะถูกลบอย่างถาวร และการแชร์ทั้งหมดที่เกี่ยวข้องจะถูกยกเลิก การลบนี้ย้อนกลับไม่ได้"
      confirmLabel="ลบรายการ"
      loading={loading}
      onConfirm={() => onConfirm(item)}
    />
  );
}

export default DeleteConfirmModal;
