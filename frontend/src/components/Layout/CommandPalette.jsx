import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  SearchIcon,
  KeyIcon,
  ShareIcon,
  FolderIcon,
  UsersIcon,
  SparklesIcon,
  ActivityIcon,
  FileTextIcon,
  BarChartIcon,
  LockIcon,
  SunIcon,
  MoonIcon,
  ShieldIcon,
  BellIcon,
  LogOutIcon,
  XIcon,
} from './layoutIcons.jsx';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

export function CommandPalette({
  open = false,
  onOpenChange,
  onSelectTab,
  onLockVault,
  onToggleTheme,
  onOpenMfa,
  onOpenNotifications,
  onLogout,
}) {
  const { isAdmin, isVaultUnlocked } = useAuth();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // All registered commands
  const allCommands = useMemo(() => {
    const navItems = [
      {
        id: 'nav-vault',
        type: 'navigation',
        group: 'Navigation',
        label: 'Vault Items',
        description: 'Passwords, credentials & secure notes',
        keywords: 'passwords logins notes credentials vault secret คลังรหัสผ่าน',
        icon: <KeyIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('vault'),
      },
      {
        id: 'nav-shared',
        type: 'navigation',
        group: 'Navigation',
        label: 'Shared Items',
        description: 'Zero-knowledge shared passwords & items',
        keywords: 'shared share with me items asymmetric rsa แบ่งปัน แชร์',
        icon: <ShareIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('shared'),
      },
      {
        id: 'nav-collections',
        type: 'navigation',
        group: 'Navigation',
        label: 'Collections',
        description: 'Encrypted organizational folders',
        keywords: 'collections folders zk shared keys คอลเลกชัน',
        icon: <FolderIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('collections'),
      },
      {
        id: 'nav-groups',
        type: 'navigation',
        group: 'Navigation',
        label: 'User Groups',
        description: 'Role-based access & team membership',
        keywords: 'groups teams rbac access control members กลุ่มผู้ใช้',
        icon: <UsersIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('groups'),
      },
      {
        id: 'nav-generator',
        type: 'navigation',
        group: 'Navigation',
        label: 'Password Generator',
        description: 'CSPRNG & Diceware passphrase generator',
        keywords: 'generator random password passphrase diceware csprng เครื่องมือสุ่ม',
        icon: <SparklesIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('generator'),
      },
      {
        id: 'nav-activity',
        type: 'navigation',
        group: 'Navigation',
        label: 'Activity Log',
        description: 'Personal authentication and vault audit trail',
        keywords: 'activity log history timeline กิจกรรม',
        icon: <ActivityIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('activity'),
      },
      ...(isAdmin
        ? [
            {
              id: 'nav-audit',
              type: 'navigation',
              group: 'Navigation',
              label: 'Audit Logs',
              description: 'System-wide compliance and security logs',
              keywords: 'audit logs admin compliance security บันทึกระบบ',
              icon: <FileTextIcon className="size-4 shrink-0" />,
              action: () => onSelectTab?.('audit'),
            },
            {
              id: 'nav-monitoring',
              type: 'navigation',
              group: 'Navigation',
              label: 'System Monitoring',
              description: 'Real-time performance and health metrics',
              keywords: 'monitoring metrics latency health sysinfo มอนิเตอร์',
              icon: <BarChartIcon className="size-4 shrink-0" />,
              action: () => onSelectTab?.('monitoring'),
            },
          ]
        : []),
    ];

    const actionItems = [
      {
        id: 'action-lock',
        type: 'action',
        group: 'Quick Actions',
        label: isVaultUnlocked ? 'Lock Vault Now' : 'Vault is Locked',
        description: 'Clear master key from browser memory',
        keywords: 'lock vault secure logout me memory ล็อกคลัง',
        icon: <LockIcon className="size-4 shrink-0 text-amber-500" />,
        action: () => onLockVault?.(),
      },
      {
        id: 'action-theme',
        type: 'action',
        group: 'Quick Actions',
        label: 'Toggle Dark / Light Theme',
        description: 'Switch between dark and light appearance',
        keywords: 'theme appearance mode dark light color ธีม โหมดมืด โหมดสว่าง',
        icon: <SunIcon className="size-4 shrink-0 text-amber-400" />,
        action: () => onToggleTheme?.(),
      },
      {
        id: 'action-mfa',
        type: 'action',
        group: 'Quick Actions',
        label: 'Configure Multi-Factor Authentication (MFA)',
        description: 'Manage 2-factor authenticator app (TOTP)',
        keywords: 'mfa 2fa two factor totp authenticator security ตั้งค่า mfa',
        icon: <ShieldIcon className="size-4 shrink-0 text-emerald-500" />,
        action: () => onOpenMfa?.(),
      },
      {
        id: 'action-notifications',
        type: 'action',
        group: 'Quick Actions',
        label: 'Security Notifications',
        description: 'View security alerts and failed attempts',
        keywords: 'notifications security alerts warning bell แจ้งเตือน',
        icon: <BellIcon className="size-4 shrink-0 text-primary" />,
        action: () => onOpenNotifications?.(),
      },
      {
        id: 'action-logout',
        type: 'action',
        group: 'Quick Actions',
        label: 'Sign Out (Logout)',
        description: 'End current authenticated session',
        keywords: 'logout sign out exit quit ออกจากระบบ',
        icon: <LogOutIcon className="size-4 shrink-0 text-destructive" />,
        action: () => onLogout?.(),
      },
    ];

    return [...navItems, ...actionItems];
  }, [
    isAdmin,
    isVaultUnlocked,
    onSelectTab,
    onLockVault,
    onToggleTheme,
    onOpenMfa,
    onOpenNotifications,
    onLogout,
  ]);

  // Filter commands based on search query
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.keywords.toLowerCase().includes(q)
    );
  }, [allCommands, query]);

  // Group filtered commands
  const groupedCommands = useMemo(() => {
    const groups = {};
    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.group]) {
        groups[cmd.group] = [];
      }
      groups[cmd.group].push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  // Reset query and selected index when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation listener
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange?.(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredCommands.length > 0 ? (prev + 1) % filteredCommands.length : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredCommands.length > 0
            ? (prev - 1 + filteredCommands.length) % filteredCommands.length
            : 0
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands.length > 0 && filteredCommands[selectedIndex]) {
          const selected = filteredCommands[selectedIndex];
          selected.action?.();
          onOpenChange?.(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, filteredCommands, selectedIndex, onOpenChange]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeElem = listRef.current.querySelector('[data-selected="true"]');
    if (activeElem) {
      activeElem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  let flatIndexCounter = 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] sm:pt-[15vh] px-4 bg-background/80 backdrop-blur-sm animate-content-show"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onOpenChange?.(false);
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden flex flex-col max-h-[75vh] animate-content-show">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 border-b border-border gap-3 h-12 shrink-0 bg-transparent">
          <SearchIcon className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vault views or commands..."
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none border-none text-foreground"
            aria-label="Type a command or search"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground p-1 rounded-sm"
              aria-label="Clear search query"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div ref={listRef} className="overflow-y-auto p-2 space-y-3 flex-1">
          {filteredCommands.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No results found for &ldquo;<span className="font-medium text-foreground">{query}</span>&rdquo;
            </div>
          ) : (
            Object.entries(groupedCommands).map(([groupTitle, commands]) => (
              <div key={groupTitle} className="space-y-1">
                <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {groupTitle}
                </div>

                <div className="space-y-0.5">
                  {commands.map((cmd) => {
                    const currentIndex = flatIndexCounter++;
                    const isSelected = currentIndex === selectedIndex;

                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        data-selected={isSelected}
                        onClick={() => {
                          cmd.action?.();
                          onOpenChange?.(false);
                        }}
                        onMouseEnter={() => setSelectedIndex(currentIndex)}
                        className={cn(
                          'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer',
                          isSelected
                            ? 'bg-accent text-accent-foreground font-medium'
                            : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={cn(
                              'p-1.5 rounded-md border',
                              isSelected
                                ? 'bg-background border-border shadow-2xs'
                                : 'bg-muted/50 border-transparent text-muted-foreground'
                            )}
                          >
                            {cmd.icon}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium leading-snug">
                              {cmd.label}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {cmd.description}
                            </div>
                          </div>
                        </div>

                        {isSelected && (
                          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-background border border-border text-muted-foreground shrink-0 shadow-2xs">
                            ↵
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Shortcut Instructions */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 text-[11px] text-muted-foreground flex items-center justify-between shrink-0 font-mono">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="border border-border bg-background px-1 rounded mr-1">↑</kbd>
              <kbd className="border border-border bg-background px-1 rounded mr-1">↓</kbd>
              to navigate
            </span>
            <span>
              <kbd className="border border-border bg-background px-1 rounded mr-1">↵</kbd>
              to select
            </span>
          </div>
          <span>
            <kbd className="border border-border bg-background px-1 rounded mr-1">ESC</kbd>
            to close
          </span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
