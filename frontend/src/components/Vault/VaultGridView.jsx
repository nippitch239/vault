import React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../ui/Card.jsx';
import { Button } from '../ui/Button.jsx';
import {
  StarIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
  EditIcon,
} from '../Common/Icons.jsx';
import { CategoryBadge } from './CategoryBadge.jsx';
import { ItemActionDropdown } from './ItemActionDropdown.jsx';

export function VaultGridView({
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
        const tags = Array.isArray(meta.tags) ? meta.tags : [];
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
          : null;

        return (
          <Card
            key={id}
            className="flex flex-col justify-between hover:border-primary/40 hover:shadow-md transition-all duration-200 group bg-card"
          >
            <div>
              {/* Card Header */}
              <CardHeader className="p-5 pb-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CategoryBadge category={it.item_type || 'login'} />
                    {collection && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium truncate max-w-[130px]">
                        <span>📁</span>
                        <span className="truncate">{collection.name}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(it);
                      }}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isFav
                          ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-400/10'
                          : 'text-muted-foreground hover:text-amber-400 hover:bg-accent'
                      }`}
                      title={isFav ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
                      aria-label={isFav ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
                    >
                      <StarIcon className="w-4 h-4" filled={isFav} />
                    </button>

                    <span className="text-[11px] font-mono px-1.5 py-0.5 bg-muted rounded text-muted-foreground border border-border">
                      v{it.version || 1}
                    </span>
                  </div>
                </div>

                <div>
                  <CardTitle className="text-base font-bold tracking-tight text-foreground truncate max-w-full">
                    {title}
                  </CardTitle>
                  {url && (
                    <CardDescription className="truncate text-xs mt-0.5 flex items-center gap-1">
                      <a
                        href={url.startsWith('http') ? url : `https://${url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline hover:text-foreground text-muted-foreground truncate flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
                        <ExternalLinkIcon className="w-3 h-3 shrink-0" />
                      </a>
                    </CardDescription>
                  )}
                </div>
              </CardHeader>

              {/* Card Content: Credentials Preview */}
              <CardContent className="p-5 pt-0 space-y-3">
                <div className="space-y-2 text-xs bg-muted/40 p-3 rounded-lg border border-border">
                  {username && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground shrink-0">Username:</span>
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-mono text-foreground truncate max-w-[150px] select-all">
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
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">Password:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-medium text-emerald-400 tracking-wider">
                        {isRevealed ? password || '••••••••' : '••••••••••••'}
                      </span>
                      {password && (
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => onToggleReveal(id)}
                            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                            title={isRevealed ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                          >
                            {isRevealed ? (
                              <EyeOffIcon className="w-3.5 h-3.5" />
                            ) : (
                              <EyeIcon className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onCopyPassword(password, id, title)}
                            className="p-1 text-muted-foreground hover:text-emerald-400 rounded transition-colors"
                            title="คัดลอกรหัสผ่าน (Auto-clear 30s)"
                          >
                            {copiedId === id ? (
                              <CheckIcon className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <CopyIcon className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground rounded border border-border font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </div>

            {/* Card Footer: Metadata & Contextual Actions */}
            <CardFooter className="p-4 pt-3 border-t border-border flex items-center justify-between bg-muted/20">
              <span className="text-[11px] text-muted-foreground">
                {formattedDate ? `อัปเดต ${formattedDate}` : `v${it.version || 1}`}
              </span>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onEdit(it)}
                  title="แก้ไขข้อมูล"
                >
                  <EditIcon className="w-3.5 h-3.5 mr-1" />
                  <span>แก้ไข</span>
                </Button>

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
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}

export default VaultGridView;
