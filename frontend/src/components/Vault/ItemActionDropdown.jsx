import React from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu.jsx';
import { Button } from '../ui/Button.jsx';
import {
  CopyIcon,
  KeyIcon,
  EyeIcon,
  EyeOffIcon,
  EditIcon,
  ShareIcon,
  HistoryIcon,
  TrashIcon,
} from '../Common/Icons.jsx';

function MoreVerticalIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
  );
}

function UserIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

export function ItemActionDropdown({
  item,
  isRevealed,
  onToggleReveal,
  onCopyUsername,
  onCopyPassword,
  onEdit,
  onShare,
  onHistory,
  onDelete,
}) {
  const meta = item.metadata || {};
  const dec = item._decrypted || {};
  const itemId = item.item_id || item.id;
  const username = dec.username || meta.username_preview || '';
  const password = dec.password || '';
  const title = meta.title || item.title || 'Untitled';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60"
          title="การดำเนินการเพิ่มเติม (Item Actions)"
        >
          <MoreVerticalIcon className="w-4 h-4" />
          <span className="sr-only">ตัวเลือก</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate max-w-[200px]">
          {title}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Copy Username */}
        {username ? (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onCopyUsername(username);
            }}
          >
            <UserIcon className="w-4 h-4 mr-2 text-sky-400 shrink-0" />
            <span>คัดลอกชื่อผู้ใช้</span>
          </DropdownMenuItem>
        ) : null}

        {/* Copy Password */}
        {password ? (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onCopyPassword(password, title);
            }}
          >
            <KeyIcon className="w-4 h-4 mr-2 text-emerald-400 shrink-0" />
            <span>คัดลอกรหัสผ่าน (30s)</span>
          </DropdownMenuItem>
        ) : null}

        {/* Reveal / Mask Password */}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onToggleReveal(itemId);
          }}
        >
          {isRevealed ? (
            <>
              <EyeOffIcon className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
              <span>ซ่อนรหัสผ่าน</span>
            </>
          ) : (
            <>
              <EyeIcon className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
              <span>แสดงรหัสผ่าน</span>
            </>
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Edit */}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
        >
          <EditIcon className="w-4 h-4 mr-2 text-primary shrink-0" />
          <span>แก้ไขข้อมูล (Edit)</span>
        </DropdownMenuItem>

        {/* Share */}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onShare(item);
          }}
        >
          <ShareIcon className="w-4 h-4 mr-2 text-blue-400 shrink-0" />
          <span>แชร์รหัสผ่าน (Share)</span>
        </DropdownMenuItem>

        {/* History */}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onHistory(item);
          }}
        >
          <HistoryIcon className="w-4 h-4 mr-2 text-amber-400 shrink-0" />
          <span>ประวัติเวอร์ชัน (History)</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Delete */}
        <DropdownMenuItem
          destructive
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
        >
          <TrashIcon className="w-4 h-4 mr-2 text-destructive shrink-0" />
          <span>ลบรายการ (Delete)</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ItemActionDropdown;
