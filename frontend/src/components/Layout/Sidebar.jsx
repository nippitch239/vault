import React, { useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Sheet, SheetContent } from '../ui/Sheet.jsx';
import {
  ShieldIcon,
  KeyIcon,
  ShareIcon,
  FolderIcon,
  UsersIcon,
  SparklesIcon,
  ActivityIcon,
  FileTextIcon,
  BarChartIcon,
  PanelLeftIcon,
  XIcon,
} from './layoutIcons.jsx';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Thai nav labels — shared with AppHeader's breadcrumb so both always match. */
export const NAV_LABELS = {
  vault: 'รายการรหัสผ่าน',
  shared: 'แชร์กับฉัน',
  collections: 'คอลเลกชัน',
  groups: 'กลุ่ม',
  generator: 'สร้างรหัสผ่าน',
  activity: 'กิจกรรมของฉัน',
  audit: 'บันทึกการตรวจสอบ',
  monitoring: 'สถานะระบบ',
};

function BrandMark({ showText, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={showText ? undefined : 'SecureVault — ไปที่รายการรหัสผ่าน'}
      title={showText ? undefined : 'SecureVault'}
      className="flex min-w-0 items-center gap-2.5 rounded-md p-1 text-left transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-foreground">
        <ShieldIcon className="size-4" />
      </span>
      {showText && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-strong leading-tight text-foreground">SecureVault</span>
          <span className="block truncate text-xs text-muted-foreground">คลังรหัสผ่านแบบเข้ารหัส</span>
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  currentTab = 'vault',
  onSelectTab,
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onMobileOpenChange,
}) {
  const { isAdmin } = useAuth();
  const drawerRef = useRef(null);

  const vaultNavItems = [
    { id: 'vault', icon: <KeyIcon className="size-4 shrink-0" /> },
    { id: 'shared', icon: <ShareIcon className="size-4 shrink-0" /> },
    { id: 'collections', icon: <FolderIcon className="size-4 shrink-0" /> },
    { id: 'groups', icon: <UsersIcon className="size-4 shrink-0" /> },
    { id: 'generator', icon: <SparklesIcon className="size-4 shrink-0" /> },
  ];

  const observabilityNavItems = [
    { id: 'activity', icon: <ActivityIcon className="size-4 shrink-0" /> },
    ...(isAdmin
      ? [
          { id: 'audit', icon: <FileTextIcon className="size-4 shrink-0" /> },
          { id: 'monitoring', icon: <BarChartIcon className="size-4 shrink-0" /> },
        ]
      : []),
  ];

  const handleItemClick = (id) => {
    onSelectTab?.(id);
    if (mobileOpen && onMobileOpenChange) {
      onMobileOpenChange(false);
    }
  };

  // Mobile drawer: move focus in on open, trap Tab inside, restore focus on close.
  // (Esc-to-close is handled by the Sheet primitive.)
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const node = drawerRef.current;
      const initial = node?.querySelector('[aria-current="page"]') || node?.querySelector(FOCUSABLE) || node;
      initial?.focus();
    });

    const handleKeyDown = (e) => {
      const node = drawerRef.current;
      if (e.key !== 'Tab' || !node) return;
      const focusables = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!node.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [mobileOpen]);

  const renderNavSection = (key, title, items, isMobile = false) => {
    const isRail = !isMobile && collapsed;
    const headingId = `sidebar-${isMobile ? 'mobile' : 'desktop'}-${key}`;

    return (
      <div role="group" aria-labelledby={isRail ? undefined : headingId} aria-label={isRail ? title : undefined}>
        {isRail ? (
          <div className="mx-2 my-2 h-px bg-border" aria-hidden="true" />
        ) : (
          <p id={headingId} className="px-2.5 pb-1.5 text-xs font-ui text-muted-foreground">
            {title}
          </p>
        )}

        <ul className="space-y-0.5">
          {items.map((item) => {
            const isActive = currentTab === item.id;
            const label = NAV_LABELS[item.id];

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleItemClick(item.id)}
                  title={isRail ? label : undefined}
                  aria-label={isRail ? label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center rounded-md text-sm font-ui transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isRail ? 'mx-auto size-9 justify-center' : 'h-9 w-full gap-2.5 px-2.5 text-left',
                    isActive
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute rounded-full bg-primary',
                        isRail ? '-left-1.5 top-2 bottom-2 w-0.5' : 'left-0 top-2 bottom-2 w-0.5'
                      )}
                    />
                  )}
                  <span className={cn(isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')}>
                    {item.icon}
                  </span>
                  {!isRail && <span className="flex-1 truncate">{label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const sections = (isMobile) => (
    <>
      {renderNavSection('vault', 'คลังรหัสผ่าน', vaultNavItems, isMobile)}
      {renderNavSection('security', 'ความปลอดภัยและการตรวจสอบ', observabilityNavItems, isMobile)}
    </>
  );

  return (
    <>
      {/* Desktop: collapsible rail / sidebar */}
      <aside
        className={cn(
          'relative z-30 hidden h-screen shrink-0 select-none flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-standard lg:flex',
          collapsed ? 'w-14' : 'w-60'
        )}
        aria-label="แถบนำทางหลัก"
      >
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-sidebar-border',
            collapsed ? 'justify-center px-2' : 'px-3'
          )}
        >
          <BrandMark showText={!collapsed} onClick={() => handleItemClick('vault')} />
        </div>

        <nav aria-label="เมนูหลัก" className={cn('flex-1 space-y-5 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
          {sections(false)}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'ขยายแถบด้านข้าง (⌘B / Ctrl+B)' : 'ย่อแถบด้านข้าง (⌘B / Ctrl+B)'}
            aria-label={collapsed ? 'ขยายแถบด้านข้าง' : 'ย่อแถบด้านข้าง'}
            aria-expanded={!collapsed}
            aria-keyshortcuts="Control+B Meta+B"
            className={cn(
              'flex items-center rounded-md text-sm font-ui text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed ? 'mx-auto size-9 justify-center' : 'h-9 w-full justify-between gap-2 px-2.5'
            )}
          >
            <span className="flex items-center gap-2.5">
              <PanelLeftIcon className="size-4 shrink-0" />
              {!collapsed && <span>ย่อแถบด้านข้าง</span>}
            </span>
            {!collapsed && (
              <kbd className="rounded border border-border bg-secondary px-1.5 font-mono text-xs text-muted-foreground">
                ⌘B
              </kbd>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile: navigation drawer */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent manageFocus={false}
          ref={drawerRef}
          side="left"
          hideCloseButton
          aria-label="เมนูนำทาง"
          tabIndex={-1}
          className="z-[60] flex w-72 max-w-[85vw] flex-col gap-0 border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-dialog focus:outline-none"
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3">
            <BrandMark showText onClick={() => handleItemClick('vault')} />
            <button
              type="button"
              onClick={() => onMobileOpenChange?.(false)}
              aria-label="ปิดเมนูนำทาง"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <nav aria-label="เมนูหลัก" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {sections(true)}
          </nav>

          <div className="shrink-0 border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
            ข้อมูลถูกเข้ารหัสบนอุปกรณ์ของคุณก่อนส่งขึ้นระบบ
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default Sidebar;
