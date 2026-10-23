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
  StarIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
  EditIcon,
  KeyIcon,
} from '../Common/Icons.jsx';
import { CategoryBadge } from './CategoryBadge.jsx';
import { ItemActionDropdown } from './ItemActionDropdown.jsx';

export function VaultTableView({
  items = [],
  revealedIds = new Set(),
  copiedId = null,
  onToggleReveal,
  onCopyPassword,
  onCopyUsername,
  onToggleFavorite,
  onEdit,
  onShare,
  onHistory,
  onDelete,
  collections = [],
}) {
  return (
    <Table className="min-w-full">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[30%]">Title / Item</TableHead>
          <TableHead className="w-[15%]">Category</TableHead>
          <TableHead className="w-[22%]">Username / Preview</TableHead>
          <TableHead className="w-[8%] text-center">Favorite</TableHead>
          <TableHead className="w-[12%]">Updated</TableHead>
          <TableHead className="w-[13%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((it) => {
          const id = it.item_id || it.id;
          const meta = it.metadata || {};
          const dec = it._decrypted || {};
          const isRevealed = revealedIds.has(id);
          const isFav = Boolean(meta.favorite);
          const title = meta.title || it.title || 'Untitled';
          const username = dec.username || meta.username_preview || '';
          const password = dec.password || '';
          const url = dec.url || meta.url || '';
          const colId = it._collectionId || meta.collection_id;
          const collection =
            it._collection ||
            (colId ? collections.find((c) => (c.collection_id || c.id) === colId) : null);

          // Format updated date
          const updatedDate = it.updated_at || it.created_at;
          const formattedDate = updatedDate
            ? new Date(updatedDate).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : '—';

          return (
            <TableRow
              key={id}
              className="cursor-pointer group hover:bg-muted/40 transition-colors"
              onClick={() => onEdit(it)}
            >
              {/* Column 1: Title / Item */}
              <TableCell className="font-medium">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm truncate max-w-[220px]">
                      {title}
                    </span>
                    {it.version > 1 && (
                      <span className="text-[10px] font-mono px-1 py-0.2 bg-muted text-muted-foreground rounded border border-border">
                        v{it.version}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {url ? (
                      <a
                        href={url.startsWith('http') ? url : `https://${url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline hover:text-foreground text-muted-foreground truncate max-w-[180px] flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
                        <ExternalLinkIcon className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <span>—</span>
                    )}
                    {collection && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 truncate max-w-[110px]">
                        📁 {collection.name}
                      </span>
                    )}
                  </div>
                </div>
              </TableCell>

              {/* Column 2: Category */}
              <TableCell>
                <CategoryBadge category={it.item_type || 'login'} />
              </TableCell>

              {/* Column 3: Username / Preview */}
              <TableCell>
                {username ? (
                  <div
                    className="flex items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="font-mono text-xs text-foreground truncate max-w-[160px] select-all">
                      {username}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCopyUsername(username)}
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                      title="คัดลอกชื่อผู้ใช้"
                    >
                      <CopyIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* Column 4: Favorite */}
              <TableCell className="text-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(it);
                  }}
                  className={`p-1.5 rounded-lg transition-colors inline-flex items-center justify-center ${
                    isFav
                      ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-400/10'
                      : 'text-muted-foreground hover:text-amber-400 hover:bg-accent'
                  }`}
                  title={isFav ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
                  aria-label={isFav ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
                >
                  <StarIcon className="w-4 h-4" filled={isFav} />
                </button>
              </TableCell>

              {/* Column 5: Updated */}
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {formattedDate}
              </TableCell>

              {/* Column 6: Actions */}
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-1">
                  {/* Quick Reveal Password */}
                  {password && (
                    <button
                      type="button"
                      onClick={() => onToggleReveal(id)}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
                      title={isRevealed ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    >
                      {isRevealed ? (
                        <EyeOffIcon className="w-4 h-4" />
                      ) : (
                        <EyeIcon className="w-4 h-4" />
                      )}
                    </button>
                  )}

                  {/* Quick Copy Password */}
                  {password && (
                    <button
                      type="button"
                      onClick={() => onCopyPassword(password, id, title)}
                      className="p-1.5 text-muted-foreground hover:text-emerald-400 rounded-lg hover:bg-accent transition-colors"
                      title="คัดลอกรหัสผ่าน (Auto-clear 30s)"
                    >
                      {copiedId === id ? (
                        <CheckIcon className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <CopyIcon className="w-4 h-4" />
                      )}
                    </button>
                  )}

                  {/* Contextual Dropdown */}
                  <ItemActionDropdown
                    item={it}
                    isRevealed={isRevealed}
                    onToggleReveal={onToggleReveal}
                    onCopyUsername={onCopyUsername}
                    onCopyPassword={(pw, ttl) => onCopyPassword(pw, id, ttl || title)}
                    onEdit={onEdit}
                    onShare={onShare}
                    onHistory={onHistory}
                    onDelete={onDelete}
                  />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default VaultTableView;
