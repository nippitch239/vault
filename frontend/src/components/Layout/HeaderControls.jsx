import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Badge } from '../ui/Badge.jsx';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu.jsx';
import {
  SearchIcon,
  BellIcon,
  LockIcon,
  UnlockIcon,
  SunIcon,
  MoonIcon,
  LogOutIcon,
  ShieldIcon,
  ChevronDownIcon,
} from './layoutIcons.jsx';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

// The DropdownMenuItem primitive renders a <div role="menuitem">; make each item
// keyboard reachable and activatable with Enter / Space.
const menuItemKeyboardProps = {
  tabIndex: 0,
  onKeyDown: (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.currentTarget.click();
    }
  },
};

/** Our own mark: a vault door (outer ring, bolts, inner door) with a keyhole. */
export function VaultMark({ className = 'size-8' }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="16" cy="16" r="14" />
      <circle cx="16" cy="16" r="9.5" />
      <path d="M16 2v3.5M16 26.5V30M2 16h3.5M26.5 16H30M6.1 6.1l2.4 2.4M23.5 23.5l2.4 2.4M25.9 6.1l-2.4 2.4M8.5 23.5l-2.4 2.4" />
      <circle cx="16" cy="14.25" r="2.25" />
      <path d="M16 16.5v4" />
    </svg>
  );
}

/** Brand button: mark + "SecureVault" wordmark; clicking goes to the vault list. */
export function BrandMark({ onClick, textClassName }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="SecureVault — ไปที่รายการรหัสผ่าน"
      className="flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 text-foreground transition-colors duration-fast hover:text-primary-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <VaultMark className="size-8 shrink-0" />
      <span aria-hidden="true" className={cn('text-lg font-strong tracking-tight', textClassName)}>
        SecureVault
      </span>
    </button>
  );
}

/** Opens the ⌘K command palette. Icon-only on small screens, icon + ⌘K hint from sm up. */
export function SearchButton({ onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="ค้นหาและคำสั่ง (⌘K / Ctrl+K)"
      title="ค้นหาและคำสั่ง (⌘K / Ctrl+K)"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(
        'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-border px-2.5 text-muted-foreground transition-colors duration-fast hover:border-primary-glow/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      <SearchIcon className="size-4 shrink-0" />
      <kbd className="hidden shrink-0 items-center rounded-sm border border-border bg-secondary px-1.5 font-mono text-xs text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  );
}

/** Lock status pill: shows whether the vault is unlocked; clicking locks it. */
export function LockStatusPill({ textClassName = 'hidden sm:inline' }) {
  const { isVaultUnlocked, lockVault } = useAuth();
  const label = isVaultUnlocked ? 'คลังปลดล็อกอยู่ — กดเพื่อล็อกคลัง' : 'คลังล็อกอยู่';

  return (
    <button
      type="button"
      onClick={() => {
        if (isVaultUnlocked) {
          lockVault();
        }
      }}
      aria-disabled={!isVaultUnlocked || undefined}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-ui transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isVaultUnlocked
          ? 'border-success-foreground/25 bg-success text-success-foreground hover:border-success-foreground/50'
          : 'cursor-default border-warning-foreground/25 bg-warning text-warning-foreground'
      )}
    >
      {isVaultUnlocked ? <UnlockIcon className="size-3.5" /> : <LockIcon className="size-3.5" />}
      <span className={textClassName}>{isVaultUnlocked ? 'ปลดล็อกอยู่' : 'ล็อกอยู่'}</span>
    </button>
  );
}

/** Security notifications bell with an unread count. */
export function NotificationBell({ count = 0, onClick }) {
  const bellLabel = count > 0 ? `การแจ้งเตือนความปลอดภัย (${count} รายการ)` : 'การแจ้งเตือนความปลอดภัย';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={bellLabel}
      aria-haspopup="dialog"
      title={bellLabel}
      className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <BellIcon className="size-4" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none text-destructive-foreground ring-2 ring-background"
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

/** User menu: profile summary, theme toggle, 2FA, lock vault, sign out. */
export function UserMenu({ onOpenMfaModal, nameClassName = 'hidden md:flex' }) {
  const { user, lockVault, logout, isAdmin } = useAuth();

  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return true;
  });

  useEffect(() => {
    // Sync theme on mount if saved in localStorage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.documentElement.classList.remove('dark');
      setIsDark(false);
    } else if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    }

    // Keep the menu label in sync when the theme is toggled elsewhere (e.g. the ⌘K palette).
    if (typeof MutationObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(root.classList.contains('dark')));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    const nextDark = !root.classList.contains('dark');
    if (nextDark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
    setIsDark(nextDark);
  };

  const userInitial = user?.username ? user.username.charAt(0).toUpperCase() : 'U';
  const roleLabel = isAdmin ? 'ผู้ดูแลระบบ' : 'ผู้ใช้';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`เมนูผู้ใช้: ${user?.username || 'ผู้ใช้'}`}
        className="flex h-9 items-center gap-2 rounded-full border border-transparent pl-0.5 pr-1.5 text-left transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary-glow/40 bg-primary/15 text-xs font-strong text-foreground"
        >
          {userInitial}
        </span>
        <span className={cn('min-w-0 max-w-[8rem] flex-col', nameClassName)}>
          <span className="truncate text-xs font-ui leading-tight text-foreground">{user?.username || 'ผู้ใช้'}</span>
          <span className="truncate text-xs leading-tight text-muted-foreground">{roleLabel}</span>
        </span>
        <ChevronDownIcon className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="z-50 w-64 rounded-lg p-1">
        <div className="px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-ui text-foreground">{user?.full_name || user?.username}</p>
            <Badge variant={isAdmin ? 'info' : 'secondary'}>{roleLabel}</Badge>
          </div>
          {user?.email && <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>}
        </div>

        <DropdownMenuSeparator className="bg-border" />

        <DropdownMenuItem onClick={toggleTheme} className="h-9 rounded-md" {...menuItemKeyboardProps}>
          {isDark ? (
            <SunIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <MoonIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex-1">{isDark ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด'}</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onOpenMfaModal} className="h-9 rounded-md" {...menuItemKeyboardProps}>
          <ShieldIcon className="size-4 shrink-0 text-muted-foreground" />
          <span>การยืนยันตัวตนสองขั้นตอน (2FA)</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={lockVault} className="h-9 rounded-md" {...menuItemKeyboardProps}>
          <LockIcon className="size-4 shrink-0 text-muted-foreground" />
          <span>ล็อกคลัง</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-border" />

        <DropdownMenuItem destructive onClick={logout} className="h-9 rounded-md" {...menuItemKeyboardProps}>
          <LogOutIcon className="size-4 shrink-0" />
          <span className="font-ui">ออกจากระบบ</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
