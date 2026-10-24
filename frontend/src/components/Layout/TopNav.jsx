import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/Sheet.jsx';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/DropdownMenu.jsx';
import { NAV_LABELS, SECURITY_TABS, ADMIN_ONLY_TABS } from './navConfig.js';
import { BrandMark, SearchButton, LockStatusPill, NotificationBell, UserMenu } from './HeaderControls.jsx';
import {
  KeyIcon,
  ShareIcon,
  FolderIcon,
  UsersIcon,
  SparklesIcon,
  ActivityIcon,
  FileTextIcon,
  BarChartIcon,
  ShieldIcon,
  MenuIcon,
  ChevronDownIcon,
} from './layoutIcons.jsx';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

const NAV_ICONS = {
  vault: KeyIcon,
  shared: ShareIcon,
  collections: FolderIcon,
  groups: UsersIcon,
  generator: SparklesIcon,
  activity: ActivityIcon,
  audit: FileTextIcon,
  monitoring: BarChartIcon,
};

const MAIN_TABS = ['vault', 'shared', 'collections', 'groups', 'generator'];
const SECURITY_LABEL = 'ความปลอดภัย';

const linkBase =
  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full text-sm font-ui transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const linkActive = 'bg-primary/15 text-foreground shadow-glow-sm';
const linkInactive = 'text-muted-foreground hover:text-foreground';

/**
 * Logged-in top navigation bar: brand, main links (+ "ความปลอดภัย" menu), search,
 * lock status, notifications (admins) and the user menu. Below lg the links move
 * into a right-side Sheet drawer opened by the hamburger button.
 */
export function TopNav({
  currentTab = 'vault',
  onSelectTab,
  onOpenCommandPalette,
  onOpenSecurityNotifications,
  onOpenMfaModal,
  notificationCount = 0,
}) {
  const { isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const securityTabs = SECURITY_TABS.filter((id) => isAdmin || !ADMIN_ONLY_TABS.includes(id));
  const isSecurityActive = securityTabs.includes(currentTab);

  const selectTab = (id) => {
    onSelectTab?.(id);
    setMobileOpen(false);
  };

  const renderDrawerSection = (key, title, ids) => (
    <div role="group" aria-labelledby={`topnav-drawer-${key}`}>
      <p id={`topnav-drawer-${key}`} className="px-3 pb-1.5 text-xs font-ui text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-1">
        {ids.map((id) => {
          const Icon = NAV_ICONS[id];
          const isActive = currentTab === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => selectTab(id)}
                aria-current={isActive ? 'page' : undefined}
                data-autofocus={isActive ? true : undefined}
                className={cn(linkBase, 'h-10 w-full gap-2.5 px-3 text-left', isActive ? linkActive : cn(linkInactive, 'hover:bg-accent'))}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{NAV_LABELS[id]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:px-6">
          {/* Left: brand */}
          <BrandMark onClick={() => selectTab('vault')} textClassName="hidden min-[400px]:inline" />

          {/* Center: main links (desktop) */}
          <nav aria-label="เมนูหลัก" className="hidden min-w-0 flex-1 justify-center lg:flex">
            <ul className="flex items-center gap-0.5 xl:gap-1">
              {MAIN_TABS.map((id) => {
                const isActive = currentTab === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => selectTab(id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(linkBase, 'px-2.5 xl:px-3.5', isActive ? linkActive : linkInactive)}
                    >
                      {NAV_LABELS[id]}
                    </button>
                  </li>
                );
              })}
              <li>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(linkBase, 'px-2.5 xl:px-3.5', isSecurityActive ? linkActive : linkInactive)}
                  >
                    {SECURITY_LABEL}
                    {isSecurityActive && <span className="sr-only">{`(หน้าปัจจุบัน: ${NAV_LABELS[currentTab]})`}</span>}
                    <ChevronDownIcon className="size-3.5 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" sideOffset={8} className="w-56">
                    {securityTabs.map((id) => {
                      const Icon = NAV_ICONS[id];
                      const isActive = currentTab === id;
                      return (
                        <DropdownMenuItem
                          key={id}
                          onClick={() => selectTab(id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn('h-9', isActive && 'bg-primary/15 text-foreground')}
                        >
                          <Icon className={cn('size-4 shrink-0', isActive ? 'text-primary-glow' : 'text-muted-foreground')} />
                          <span className="flex-1">{NAV_LABELS[id]}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            </ul>
          </nav>

          {/* Right: search, lock status, notifications, user menu, hamburger */}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:ml-0">
            <SearchButton onClick={onOpenCommandPalette} />
            <LockStatusPill textClassName="hidden sm:inline lg:hidden xl:inline" />
            {isAdmin && <NotificationBell count={notificationCount} onClick={onOpenSecurityNotifications} />}
            <UserMenu onOpenMfaModal={onOpenMfaModal} nameClassName="hidden md:flex lg:hidden xl:flex" />
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="เปิดเมนูนำทาง"
              aria-haspopup="dialog"
              aria-expanded={mobileOpen}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <MenuIcon className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile / tablet navigation drawer — rendered outside the header because its
          backdrop-filter would otherwise become the containing block for the fixed Sheet. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="right"
          aria-labelledby="topnav-drawer-title"
          closeLabel="ปิดเมนูนำทาง"
          className="!w-72 max-w-[85vw] gap-6 p-4 sm:p-5"
        >
          <SheetHeader>
            <SheetTitle id="topnav-drawer-title" className="flex items-center gap-2 text-base">
              <ShieldIcon className="size-4 text-primary-glow" />
              เมนูนำทาง
            </SheetTitle>
          </SheetHeader>

          <nav aria-label="เมนูหลัก" className="flex-1 space-y-5">
            {renderDrawerSection('vault', 'คลังรหัสผ่าน', MAIN_TABS)}
            {renderDrawerSection('security', SECURITY_LABEL, securityTabs)}
          </nav>

          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            ข้อมูลถูกเข้ารหัสบนอุปกรณ์ของคุณก่อนส่งขึ้นระบบ
          </p>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default TopNav;
