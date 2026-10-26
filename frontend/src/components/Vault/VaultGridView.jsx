import React from 'react';
import { Card } from '../ui/Card.jsx';
import { Button } from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';
import {
  StarIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
  EditIcon,
  LockIcon,
} from '../Common/Icons.jsx';
import { CategoryBadge, CollectionBadge, LockedBadge } from './CategoryBadge.jsx';
import { ItemActionDropdown } from './ItemActionDropdown.jsx';
import { itemFields } from '../../lib/item-fields.js';

export const LOCKED_TITLE = 'ถอดรหัสไม่ได้';

/** Favourite toggle shared by the card and table views. */
export function FavoriteButton({ active, title, onToggle, className = '' }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={active}
      aria-label={`รายการโปรด: ${title}`}
      title={active ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`${active ? 'text-warning-foreground' : 'text-muted-foreground hover:text-foreground'} ${className}`}
    >
      <StarIcon filled={active} />
    </Button>
  );
}

const formatUpdated = (value) =>
  value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : null;

const hrefOf = (url) => (url.startsWith('http') ? url : `https://${url}`);
const hostOf = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function VaultGridView({
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
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((it) => {
        const id = it.item_id || it.id;
        const meta = it.metadata || {};
        const dec = it._decrypted || {};
        const isRevealed = revealedIds.has(id);
        const isFav = Boolean(meta.favorite);
        const { title, username, url, notes, tags, locked } = itemFields(it);
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
        const updated = formatUpdated(it.updated_at || it.created_at);

        return (
          <li key={id}>
            <Card className="flex h-full flex-col p-4 transition-colors duration-fast hover:border-input">
              {/* Title row */}
              <div className="flex items-start gap-3">
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-sm font-ui text-secondary-foreground"
                  aria-hidden="true"
                >
                  {locked ? <LockIcon className="size-4 text-muted-foreground" /> : title.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  {locked ? (
                    <h3 className="truncate text-sm font-strong text-muted-foreground" title={displayTitle}>
                      {displayTitle}
                    </h3>
                  ) : (
                    <h3 className="truncate text-sm font-strong">
                      <button
                        type="button"
                        onClick={() => onEdit(it)}
                        className="truncate max-w-full text-left font-strong text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={`ดูรายละเอียด ${displayTitle}`}
                      >
                        {displayTitle}
                      </button>
                    </h3>
                  )}
                  {url && !locked ? (
                    <a
                      href={hrefOf(url)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 rounded-sm text-caption text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate">{hostOf(url)}</span>
                      <ExternalLinkIcon className="size-3 shrink-0" />
                      <span className="sr-only">(เปิดในแท็บใหม่)</span>
                    </a>
                  ) : (
                    <p className="text-caption text-muted-foreground">{locked ? 'เปิดรายการนี้ในเบราว์เซอร์นี้ไม่ได้' : 'ไม่มีเว็บไซต์'}</p>
                  )}
                </div>
                <FavoriteButton active={isFav} title={displayTitle} onToggle={() => onToggleFavorite(it)} className="-mr-1 -mt-1" />
              </div>

              {/* Credentials */}
              {locked ? (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-caption text-muted-foreground">
                  <LockIcon className="mt-0.5 size-4 shrink-0" />
                  <p>ไม่มีคีย์สำหรับถอดรหัสรายการนี้ หรือข้อมูลเสียหาย ขอสิทธิ์คอลเลกชันจากผู้ดูแล หรือดูประวัติเวอร์ชัน</p>
                </div>
              ) : (
                <dl className="mt-3 grid gap-1 rounded-md border border-border bg-secondary px-3 py-2 text-sm">
                  <div className="flex min-h-8 items-center gap-2">
                    <dt className="w-16 shrink-0 text-caption text-muted-foreground">ชื่อผู้ใช้</dt>
                    <dd className="flex min-w-0 flex-1 items-center justify-between gap-1">
                      <span className={`truncate ${username ? 'font-mono text-xs' : 'text-muted-foreground'}`}>{username || '—'}</span>
                      {username && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => onCopyUsername(username)}
                          aria-label={`คัดลอกชื่อผู้ใช้ของ ${title}`}
                        >
                          <CopyIcon />
                        </Button>
                      )}
                    </dd>
                  </div>
                  <div className="flex min-h-8 items-center gap-2">
                    <dt className="w-16 shrink-0 text-caption text-muted-foreground">รหัสผ่าน</dt>
                    <dd className="flex min-w-0 flex-1 items-center justify-between gap-1">
                      {password ? (
                        <>
                          <span className="min-w-0 break-all font-mono text-xs">
                            {isRevealed ? password : '••••••••••••'}
                            {!isRevealed && <span className="sr-only">ซ่อนอยู่</span>}
                          </span>
                          <span className="flex shrink-0 items-center">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => onToggleReveal(id)}
                              aria-pressed={isRevealed}
                              aria-label={`แสดงรหัสผ่านของ ${title}`}
                            >
                              {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className={copiedId === id ? 'text-success-foreground' : 'text-muted-foreground hover:text-foreground'}
                              onClick={() => onCopyPassword(password, id, title)}
                              aria-label={copiedId === id ? `คัดลอกรหัสผ่านของ ${title} แล้ว` : `คัดลอกรหัสผ่านของ ${title} (ล้างคลิปบอร์ดใน 30 วินาที)`}
                            >
                              {copiedId === id ? <CheckIcon /> : <CopyIcon />}
                            </Button>
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </dd>
                  </div>
                  {notes ? (
                    <div className="flex min-h-8 items-start gap-2 pt-1 border-t border-border/40">
                      <dt className="w-16 shrink-0 text-caption text-muted-foreground pt-0.5">บันทึก</dt>
                      <dd className="flex min-w-0 flex-1 items-start justify-between gap-1">
                        <span className="line-clamp-2 text-xs text-secondary-foreground break-words">{notes}</span>
                        {onCopyNote && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                            onClick={() => onCopyNote(notes, id, title)}
                            aria-label={`คัดลอกบันทึกของ ${title}`}
                          >
                            <CopyIcon />
                          </Button>
                        )}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}

              {/* Badges */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <CategoryBadge category={it.item_type || 'login'} />
                {matchedCollections.length > 0 ? (
                  matchedCollections.map((c) => (
                    <CollectionBadge key={c.collection_id || c.id} name={c.name} />
                  ))
                ) : collection ? (
                  <CollectionBadge name={collection.name} />
                ) : null}
                {locked && <LockedBadge />}
                {tags.slice(0, 3).map((tag, i) => (
                  <Badge key={`${tag}-${i}`} variant="outline" className="max-w-[8rem]">
                    <span className="truncate">#{tag}</span>
                  </Badge>
                ))}
                {tags.length > 3 && (
                  <Badge variant="outline" title={tags.slice(3).join(', ')}>
                    +{tags.length - 3}
                  </Badge>
                )}
              </div>

              <div className="flex-1" aria-hidden="true" />

              {/* Footer */}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <p className="min-w-0 truncate text-caption text-muted-foreground">
                  {updated ? `อัปเดต ${updated}` : 'ยังไม่มีวันที่'} · v{it.version || 1}
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => onEdit(it)}
                    disabled={locked}
                    title={locked ? 'แก้ไขไม่ได้เพราะถอดรหัสรายการนี้ไม่ได้' : undefined}
                    aria-label={`แก้ไข ${displayTitle}`}
                  >
                    <EditIcon />
                    แก้ไข
                  </Button>
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
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export default VaultGridView;
