import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button } from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu.jsx';
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

  const tabTitles = {
    vault: 'Vault Items',
    shared: 'Shared Items',
    collections: 'Collections',
    groups: 'User Groups',
    generator: 'Password Generator',
    activity: 'Activity Log',
    audit: 'Audit Logs',
    monitoring: 'System Monitoring',
  };

  const userInitial = user?.username ? user.username.charAt(0).toUpperCase() : 'U';

  return (
    <header className="sticky top-0 z-40 h-14 w-full bg-background/80 backdrop-blur-sm border-b border-border px-3 sm:px-6 flex items-center justify-between gap-2 select-none">
      {/* Left: Toggles & Title */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Mobile menu trigger */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenMobileNav}
          className="lg:hidden size-9"
          aria-label="Open navigation menu"
        >
          <MenuIcon className="size-5" />
        </Button>

        {/* Desktop sidebar rail toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className="hidden lg:flex size-9 text-muted-foreground hover:text-foreground"
          aria-label="Toggle sidebar (⌘B)"
          title={isSidebarCollapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
        >
          <PanelLeftIcon className="size-4" />
        </Button>

        {/* Current Tab Title Breadcrumb */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-mono">/</span>
          <h1 className="text-sm font-semibold text-foreground tracking-tight">
            {tabTitles[currentTab] || 'SecureVault'}
          </h1>
        </div>
      </div>

      {/* Center: Command Palette Trigger Button */}
      <div className="flex-1 max-w-md mx-2 sm:mx-4">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs sm:text-sm rounded-lg border border-input bg-muted/50 text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:border-muted-foreground/30 transition-all shadow-2xs cursor-pointer group"
          aria-label="Search and commands (⌘K / Ctrl+K)"
          title="Search vault or commands (⌘K / Ctrl+K)"
        >
          <span className="flex items-center gap-2 truncate">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="truncate">Search vault...</span>
          </span>
          <kbd className="inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground shrink-0 shadow-2xs">
            <span className="text-[11px]">⌘</span>K
          </kbd>
        </button>
      </div>

      {/* Right: Actions & User Dropdown */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Vault Lock Status Indicator */}
        <button
          type="button"
          onClick={() => {
            if (isVaultUnlocked) {
              lockVault();
            }
          }}
          title={
            isVaultUnlocked
              ? 'คลังรหัสผ่านปลดล็อกอยู่ (คลิกเพื่อล็อก)'
              : 'คลังรหัสผ่านถูกล็อกอยู่'
          }
          className={cn(
            'px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer shadow-2xs',
            isVaultUnlocked
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
          )}
        >
          {isVaultUnlocked ? (
            <UnlockIcon className="size-3.5" />
          ) : (
            <LockIcon className="size-3.5" />
          )}
          <span className="hidden md:inline font-mono text-[11px]">
            {isVaultUnlocked ? 'Unlocked' : 'Locked'}
          </span>
        </button>

        {/* Security Notification Bell */}
        <button
          type="button"
          onClick={onOpenSecurityNotifications}
          className="relative size-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors shrink-0"
          title="การแจ้งเตือนความปลอดภัย (Security Alerts)"
          aria-label="Security Notifications"
        >
          <BellIcon className="size-4" />
          {notificationCount > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 bg-destructive rounded-full ring-2 ring-background animate-pulse" />
          )}
        </button>

        {/* User Avatar Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-lg hover:bg-accent transition-colors border border-transparent hover:border-border text-left"
            aria-label="User profile menu"
          >
            <div className="size-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold uppercase shadow-2xs shrink-0">
              {userInitial}
            </div>
            <div className="hidden md:flex flex-col min-w-0 max-w-[120px] text-left">
              <span className="text-xs font-semibold text-foreground truncate leading-tight">
                {user?.username || 'User'}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider truncate">
                {user?.role || 'user'}
              </span>
            </div>
            <ChevronDownIcon className="size-3 text-muted-foreground hidden sm:block shrink-0" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-60 p-1.5 z-50">
            {/* User Profile Summary */}
            <DropdownMenuLabel className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground text-sm truncate">
                  {user?.full_name || user?.username}
                </p>
                <Badge
                  variant={isAdmin ? 'default' : 'secondary'}
                  className="text-[10px] font-mono uppercase px-1.5 py-0"
                >
                  {user?.role || 'user'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5 font-normal">
                {user?.email}
              </p>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            {/* Quick Theme Toggle */}
            <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer">
              {isDark ? (
                <SunIcon className="size-4 text-amber-500 dark:text-amber-400 shrink-0" />
              ) : (
                <MoonIcon className="size-4 text-slate-700 dark:text-slate-200 shrink-0" />
              )}
              <span className="flex-1">
                {isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
              </span>
            </DropdownMenuItem>

            {/* MFA Security Setup */}
            <DropdownMenuItem
              onClick={onOpenMfaModal}
              className="cursor-pointer"
            >
              <ShieldIcon className="size-4 text-emerald-500 shrink-0" />
              <span>ตั้งค่า MFA (2-Factor Auth)</span>
            </DropdownMenuItem>

            {/* Vault Lock Action */}
            <DropdownMenuItem
              onClick={lockVault}
              className="cursor-pointer"
            >
              <LockIcon className="size-4 text-amber-500 shrink-0" />
              <span>ล็อกคลังรหัสผ่าน (Lock Vault)</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Sign Out Action */}
            <DropdownMenuItem
              destructive
              onClick={logout}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOutIcon className="size-4 shrink-0" />
              <span className="font-medium">ออกจากระบบ (Sign Out)</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default AppHeader;
