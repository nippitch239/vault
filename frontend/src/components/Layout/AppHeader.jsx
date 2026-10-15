import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button } from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu.jsx';
import { NAV_LABELS } from './Sidebar.jsx';
import {
  SearchIcon,
  PanelLeftIcon,
  MenuIcon,
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

export function AppHeader({
  currentTab = 'vault',
  onToggleSidebar,
  isSidebarCollapsed = false,
  onOpenMobileNav,
  onOpenCommandPalette,
  onOpenSecurityNotifications,
  onOpenMfaModal,
  notificationCount = 0,
}) {
  const { user, isVaultUnlocked, lockVault, logout, isAdmin } = useAuth();

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
  const pageLabel = NAV_LABELS[currentTab] || NAV_LABELS.vault;
  const bellLabel =
    notificationCount > 0
      ? `การแจ้งเตือนความปลอดภัย (${notificationCount} รายการ)`
      : 'การแจ้งเตือนความปลอดภัย';

  return (
    <header className="sticky top-0 z-40 flex h-14 w-full shrink-0 select-none items-center justify-between gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-sm sm:px-6">
      {/* Left: nav toggles + breadcrumb */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenMobileNav}
          className="lg:hidden"
          aria-label="เปิดเมนูนำทาง"
          aria-haspopup="dialog"
        >
          <MenuIcon className="size-5" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="hidden text-muted-foreground hover:text-foreground lg:inline-flex"
          aria-label={isSidebarCollapsed ? 'ขยายแถบด้านข้าง' : 'ย่อแถบด้านข้าง'}
          aria-expanded={!isSidebarCollapsed}
          aria-keyshortcuts="Control+B Meta+B"
          title={isSidebarCollapsed ? 'ขยายแถบด้านข้าง (⌘B / Ctrl+B)' : 'ย่อแถบด้านข้าง (⌘B / Ctrl+B)'}
        >
          <PanelLeftIcon className="size-4" />
        </Button>

        <nav aria-label="ตำแหน่งปัจจุบัน" className="hidden sm:block">
          <ol className="flex items-center gap-2 text-sm">
            <li className="text-muted-foreground">SecureVault</li>
            <li aria-hidden="true" className="text-muted-foreground">
              /
            </li>
            <li aria-current="page" className="max-w-[12rem] truncate font-ui text-foreground">
              {pageLabel}
            </li>
          </ol>
        </nav>
      </div>

      {/* Center: command palette trigger */}
      <div className="mx-1 min-w-0 max-w-md flex-1 sm:mx-4">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="ค้นหาและคำสั่ง (⌘K / Ctrl+K)"
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K Meta+K"
          className="group flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-secondary px-2.5 text-sm text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 items-center gap-2">
            <SearchIcon className="size-4 shrink-0" />
            <span className="hidden truncate min-[400px]:inline">ค้นหาหรือสั่งงาน…</span>
          </span>
          <kbd className="hidden shrink-0 items-center rounded border border-border bg-background px-1.5 font-mono text-xs text-muted-foreground sm:inline-flex">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: lock status, notifications, user menu */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => {
            if (isVaultUnlocked) {
              lockVault();
            }
          }}
          aria-disabled={!isVaultUnlocked || undefined}
          aria-label={isVaultUnlocked ? 'คลังปลดล็อกอยู่ — กดเพื่อล็อกคลัง' : 'คลังล็อกอยู่'}
          title={isVaultUnlocked ? 'คลังปลดล็อกอยู่ — กดเพื่อล็อกคลัง' : 'คลังล็อกอยู่'}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-ui transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isVaultUnlocked
              ? 'border-success-foreground/25 bg-success text-success-foreground hover:border-success-foreground/50'
              : 'cursor-default border-warning-foreground/25 bg-warning text-warning-foreground'
          )}
        >
          {isVaultUnlocked ? <UnlockIcon className="size-3.5" /> : <LockIcon className="size-3.5" />}
          <span className="hidden md:inline">{isVaultUnlocked ? 'ปลดล็อกอยู่' : 'ล็อกอยู่'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSecurityNotifications}
          aria-label={bellLabel}
          aria-haspopup="dialog"
          title={bellLabel}
          className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BellIcon className="size-4" />
          {notificationCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 size-2 rounded-full bg-destructive ring-2 ring-background"
            />
          )}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`เมนูผู้ใช้: ${user?.username || 'ผู้ใช้'}`}
            className="flex h-9 items-center gap-2 rounded-md border border-transparent pl-1 pr-1.5 text-left transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-strong text-foreground"
            >
              {userInitial}
            </span>
            <span className="hidden min-w-0 max-w-[8rem] flex-col md:flex">
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
      </div>
    </header>
  );
}

export default AppHeader;
