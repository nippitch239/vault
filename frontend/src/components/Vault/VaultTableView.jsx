import React from 'react';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '../ui/Table.jsx';
import { Button } from '../ui/Button.jsx';
import {
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
  LockIcon,
} from '../Common/Icons.jsx';
import { CategoryBadge, CollectionBadge, LockedBadge } from './CategoryBadge.jsx';
import { ItemActionDropdown } from './ItemActionDropdown.jsx';
import { FavoriteButton, LOCKED_TITLE } from './VaultGridView.jsx';
import { itemFields } from '../../lib/item-fields.js';

const formatUpdated = (value) =>
  value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const hrefOf = (url) => (url.startsWith('http') ? url : `https://${url}`);
const hostOf = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * Dense table. The dashboard shows it only on wide screens (cards are used below `lg`),
 * so the wrapper does not clip the row action menus.
 */
export function VaultTableView({
  items = [],
  revealedIds = new Set(),
  copiedId = null,
  onToggleReveal,
  onCopyPassword,
  onCopyUsername,
  onCopyNote,
  onToggleFavorite,
  onEdit,
  onShare,
  onHistory,
  onDelete,
  collections = [],
}) {
  return (
    <Table wrapperClassName="overflow-visible bg-card" className="table-fixed">
      <caption className="sr-only">รายการในคลังรหัสผ่าน</caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 w-12 px-2">
            <span className="sr-only">รายการโปรด</span>
          </TableHead>
          <TableHead className="h-9 w-[30%] px-3 text-xs font-ui">ชื่อรายการ</TableHead>
          <TableHead className="h-9 w-[13%] px-3 text-xs font-ui">หมวดหมู่</TableHead>
          <TableHead className="h-9 w-[18%] px-3 text-xs font-ui">ชื่อผู้ใช้</TableHead>
          <TableHead className="h-9 w-[17%] px-3 text-xs font-ui">รหัสผ่าน</TableHead>
          <TableHead className="h-9 w-[13%] px-3 text-xs font-ui">อัปเดตล่าสุด</TableHead>
          <TableHead className="h-9 w-12 px-2">
            <span className="sr-only">ตัวเลือก</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((it) => {
          const id = it.item_id || it.id;
          const meta = it.metadata || {};
          const dec = it._decrypted || {};
          const isRevealed = revealedIds.has(id);
          const isFav = Boolean(meta.favorite);
          const { title, username, url, locked } = itemFields(it);
          const displayTitle = locked ? LOCKED_TITLE : title;
          const password = dec.password || '';
          const colId = it._collectionId || meta.collection_id;
          const matchedCollections = collections.filter((c) => {
            const cid = c.collection_id || c.id;
            return it._collectionIds ? it._collectionIds.has(cid) : cid === colId;
          });
          const collection =
            matchedCollections[0] ||
            it._collection ||
            (colId ? collections.find((c) => (c.collection_id || c.id) === colId) : null);

          return (
            <TableRow
              key={id}
              className={`group hover:bg-accent/60 ${locked ? '' : 'cursor-pointer'}`}
              onClick={() => {
                if (!locked) onEdit(it);
              }}
            >
              <TableCell className="px-2 py-2">
                <FavoriteButton active={isFav} title={displayTitle} onToggle={() => onToggleFavorite(it)} />
              </TableCell>

              <TableCell className="px-3 py-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  {locked ? (
                    <span className="flex items-center gap-1.5 text-sm font-ui text-muted-foreground">
                      <LockIcon className="size-4 shrink-0" />
                      <span className="truncate">{LOCKED_TITLE}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(it);
                      }}
                      className="truncate rounded-sm text-left text-sm font-ui text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={`แก้ไข ${title}`}
                    >
                      {title}
                    </button>
                  )}
                  <div className="flex min-w-0 items-center gap-2">
                    {url && !locked ? (
                      <a
                        href={hrefOf(url)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex min-w-0 items-center gap-1 rounded-sm text-caption text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{hostOf(url)}</span>
                        <ExternalLinkIcon className="size-3 shrink-0" />
                        <span className="sr-only">(เปิดในแท็บใหม่)</span>
                      </a>
                    ) : null}
                    {matchedCollections.length > 0 ? (
                      matchedCollections.map((c) => (
                        <CollectionBadge key={c.collection_id || c.id} name={c.name} className="max-w-[9rem]" />
                      ))
                    ) : collection ? (
                      <CollectionBadge name={collection.name} className="max-w-[9rem]" />
                    ) : null}
                  </div>
                </div>
              </TableCell>

              <TableCell className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  <CategoryBadge category={it.item_type || 'login'} />
                  {locked && <LockedBadge />}
                </div>
              </TableCell>

              <TableCell className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                {username ? (
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate font-mono text-xs">{username}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => onCopyUsername(username)}
                      aria-label={`คัดลอกชื่อผู้ใช้ของ ${title}`}
                    >
                      <CopyIcon />
                    </Button>
                  </div>
                ) : (
                  <span className="text-caption text-muted-foreground">—</span>
                )}
              </TableCell>

              <TableCell className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                {password ? (
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate font-mono text-xs" title={isRevealed ? password : undefined}>
                      {isRevealed ? password : '••••••••'}
                      {!isRevealed && <span className="sr-only">ซ่อนอยู่</span>}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => onToggleReveal(id)}
                      aria-pressed={isRevealed}
                      aria-label={`แสดงรหัสผ่านของ ${title}`}
                    >
                      {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={`shrink-0 ${copiedId === id ? 'text-success-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => onCopyPassword(password, id, title)}
                      aria-label={copiedId === id ? `คัดลอกรหัสผ่านของ ${title} แล้ว` : `คัดลอกรหัสผ่านของ ${title} (ล้างคลิปบอร์ดใน 30 วินาที)`}
                    >
                      {copiedId === id ? <CheckIcon /> : <CopyIcon />}
                    </Button>
                  </div>
                ) : (
                  <span className="text-caption text-muted-foreground">—</span>
                )}
              </TableCell>

              <TableCell className="px-3 py-2 text-caption text-muted-foreground">
                <span className="block truncate">{formatUpdated(it.updated_at || it.created_at)}</span>
                <span className="block">v{it.version || 1}</span>
              </TableCell>

              <TableCell className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                <ItemActionDropdown
                  item={it}
                  isRevealed={isRevealed}
                  onToggleReveal={onToggleReveal}
                  onCopyUsername={onCopyUsername}
                  onCopyPassword={(pw, ttl) => onCopyPassword(pw, id, ttl || title)}
                  onCopyNote={onCopyNote}
                  onEdit={onEdit}
                  onShare={onShare}
                  onHistory={onHistory}
                  onDelete={onDelete}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default VaultTableView;
