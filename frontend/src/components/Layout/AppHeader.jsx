import React from 'react';
import { Button } from '../ui/Button.jsx';
import { NAV_LABELS } from './navConfig.js';
import { LockStatusPill, NotificationBell, UserMenu } from './HeaderControls.jsx';
import { SearchIcon, PanelLeftIcon, MenuIcon } from './layoutIcons.jsx';

// NOTE: the app shell now uses TopNav.jsx; this header is kept but no longer rendered.

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
  const pageLabel = NAV_LABELS[currentTab] || NAV_LABELS.vault;

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
        <LockStatusPill textClassName="hidden md:inline" />
        <NotificationBell count={notificationCount} onClick={onOpenSecurityNotifications} />
        <UserMenu onOpenMfaModal={onOpenMfaModal} />
      </div>
    </header>
  );
}

export default AppHeader;
