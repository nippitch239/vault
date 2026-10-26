import React from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu.jsx';
import { Button } from '../ui/Button.jsx';
import {
  KeyIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  EditIcon,
  ShareIcon,
  HistoryIcon,
  TrashIcon,
} from '../Common/Icons.jsx';
import { itemFields } from '../../lib/item-fields.js';

function MoreIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  );
}

function UserIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

/** Menu item that is reachable with Tab and activates with Enter / Space. */
function MenuItem({ children, disabled, ...props }) {
  return (
    <DropdownMenuItem
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
      className="focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0"
      {...props}
    >
      {children}
    </DropdownMenuItem>
  );
}

export function ItemActionDropdown({
  item,
  isRevealed,
  onToggleReveal,
  onCopyUsername,
  onCopyPassword,
  onCopyNote,
  onEdit,
  onShare,
  onHistory,
  onDelete,
}) {
  const dec = item._decrypted || {};
  const itemId = item.item_id || item.id;
  const { username, title, notes, locked } = itemFields(item);
  const password = dec.password || '';
  const displayTitle = locked ? 'รายการที่ถอดรหัสไม่ได้' : title;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`ตัวเลือกเพิ่มเติมของ ${displayTitle}`}
        >
          <MoreIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" aria-label={`ตัวเลือกของ ${displayTitle}`}>
        <p className="truncate px-2 py-1.5 text-caption text-muted-foreground">{displayTitle}</p>
        <DropdownMenuSeparator className="bg-border" />

        {username ? (
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              onCopyUsername(username);
            }}
          >
            <UserIcon className="text-muted-foreground" />
            <span>คัดลอกชื่อผู้ใช้</span>
          </MenuItem>
        ) : null}

        {password ? (
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              onCopyPassword(password, title);
            }}
          >
            <KeyIcon className="text-muted-foreground" />
            <span>คัดลอกรหัสผ่าน</span>
            <span className="ml-auto text-xs text-muted-foreground">ล้างใน 30 วิ</span>
          </MenuItem>
        ) : null}

        {notes && onCopyNote ? (
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              onCopyNote(notes, itemId, title);
            }}
          >
            <CopyIcon className="text-muted-foreground" />
            <span>คัดลอกบันทึก</span>
          </MenuItem>
        ) : null}

        <MenuItem
          disabled={!password}
          onClick={(e) => {
            e.stopPropagation();
            onToggleReveal(itemId);
          }}
        >
          {isRevealed ? <EyeOffIcon className="text-muted-foreground" /> : <EyeIcon className="text-muted-foreground" />}
          <span>{isRevealed ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}</span>
        </MenuItem>

        <DropdownMenuSeparator className="bg-border" />

        <MenuItem
          disabled={locked}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
        >
          <EditIcon className="text-muted-foreground" />
          <span>แก้ไข</span>
        </MenuItem>

        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            onShare(item);
          }}
        >
          <ShareIcon className="text-muted-foreground" />
          <span>แชร์</span>
        </MenuItem>

        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            onHistory(item);
          }}
        >
          <HistoryIcon className="text-muted-foreground" />
          <span>ประวัติเวอร์ชัน</span>
        </MenuItem>

        <DropdownMenuSeparator className="bg-border" />

        <MenuItem
          destructive
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
        >
          <TrashIcon />
          <span>ลบรายการ</span>
        </MenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ItemActionDropdown;
