import React from 'react';
import { Badge } from '../ui/Badge.jsx';
import { KeyIcon, LockIcon } from '../Common/Icons.jsx';

function NoteIcon({ className = 'size-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function CardIcon({ className = 'size-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}

function IdentityIcon({ className = 'size-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
    </svg>
  );
}

function ServerIcon({ className = 'size-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  );
}

function FolderIcon({ className = 'size-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

/**
 * Item types as stored in `item_type` (lowercase). `value` is the upper-case form used by
 * the dashboard filter and the item form.
 */
export const CATEGORY_OPTIONS = [
  { value: 'LOGIN', label: 'เข้าสู่ระบบ' },
  { value: 'SECURE_NOTE', label: 'บันทึกปลอดภัย' },
  { value: 'CARD', label: 'บัตร' },
  { value: 'IDENTITY', label: 'ตัวตน' },
  { value: 'SERVER', label: 'เซิร์ฟเวอร์' },
];

const CATEGORY_STYLES = {
  login: { label: 'เข้าสู่ระบบ', variant: 'secondary', Icon: KeyIcon },
  secure_note: { label: 'บันทึกปลอดภัย', variant: 'outline', Icon: NoteIcon },
  note: { label: 'บันทึกปลอดภัย', variant: 'outline', Icon: NoteIcon },
  card: { label: 'บัตร', variant: 'warning', Icon: CardIcon },
  identity: { label: 'ตัวตน', variant: 'info', Icon: IdentityIcon },
  server: { label: 'เซิร์ฟเวอร์', variant: 'success', Icon: ServerIcon },
};

export function CategoryBadge({ category = 'login', className = '' }) {
  const norm = (category || 'login').toLowerCase();
  const style = CATEGORY_STYLES[norm] || { label: norm, variant: 'outline', Icon: KeyIcon };
  const { Icon } = style;

  return (
    <Badge variant={style.variant} className={className}>
      <span aria-hidden="true" className="inline-flex">
        <Icon className="size-3 shrink-0" />
      </span>
      <span>{style.label}</span>
    </Badge>
  );
}

/** Collection the item belongs to. */
export function CollectionBadge({ name, className = '' }) {
  if (!name) return null;
  return (
    <Badge variant="outline" className={`max-w-[11rem] ${className}`} title={`คอลเลกชัน ${name}`}>
      <FolderIcon className="size-3 shrink-0" />
      <span className="sr-only">คอลเลกชัน </span>
      <span className="truncate">{name}</span>
    </Badge>
  );
}

/** Shown when the item could not be decrypted in this browser. */
export function LockedBadge({ className = '' }) {
  return (
    <Badge variant="warning" className={className}>
      <span aria-hidden="true" className="inline-flex">
        <LockIcon className="size-3 shrink-0" />
      </span>
      <span>ถอดรหัสไม่ได้</span>
    </Badge>
  );
}

export default CategoryBadge;
