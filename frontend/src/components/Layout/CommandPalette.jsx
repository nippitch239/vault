import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/Dialog.jsx';
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
  ShieldIcon,
  BellIcon,
  LogOutIcon,
  XIcon,
} from './layoutIcons.jsx';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

const GROUP_NAV = 'ไปที่';
const GROUP_ACTIONS = 'คำสั่งด่วน';

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
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (cmdId) => `${baseId}-${cmdId}`;

  // All registered commands (English keywords kept so either language finds them)
  const allCommands = useMemo(() => {
    const navItems = [
      {
        id: 'nav-vault',
        group: GROUP_NAV,
        label: 'รายการรหัสผ่าน',
        description: 'รหัสผ่าน บันทึก และข้อมูลเข้าสู่ระบบ',
        keywords: 'passwords logins notes credentials vault secret items คลังรหัสผ่าน รายการ',
        icon: <KeyIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('vault'),
      },
      {
        id: 'nav-shared',
        group: GROUP_NAV,
        label: 'แชร์กับฉัน',
        description: 'รายการที่ผู้อื่นแชร์ให้คุณ',
        keywords: 'shared share with me items แบ่งปัน แชร์',
        icon: <ShareIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('shared'),
      },
      {
        id: 'nav-collections',
        group: GROUP_NAV,
        label: 'คอลเลกชัน',
        description: 'โฟลเดอร์ที่ใช้ร่วมกันแบบเข้ารหัส',
        keywords: 'collections folders shared คอลเลกชัน โฟลเดอร์',
        icon: <FolderIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('collections'),
      },
      {
        id: 'nav-groups',
        group: GROUP_NAV,
        label: 'กลุ่ม',
        description: 'สมาชิกและสิทธิ์การเข้าถึงของทีม',
        keywords: 'groups teams rbac access control members กลุ่ม สมาชิก',
        icon: <UsersIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('groups'),
      },
      {
        id: 'nav-generator',
        group: GROUP_NAV,
        label: 'สร้างรหัสผ่าน',
        description: 'สุ่มรหัสผ่านหรือวลีรหัสผ่านที่คาดเดายาก',
        keywords: 'generator random password passphrase diceware สุ่ม สร้างรหัสผ่าน',
        icon: <SparklesIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('generator'),
      },
      {
        id: 'nav-activity',
        group: GROUP_NAV,
        label: 'กิจกรรมของฉัน',
        description: 'ประวัติการเข้าสู่ระบบและการใช้งานคลัง',
        keywords: 'activity log history timeline กิจกรรม ประวัติ',
        icon: <ActivityIcon className="size-4 shrink-0" />,
        action: () => onSelectTab?.('activity'),
      },
      ...(isAdmin
        ? [
            {
              id: 'nav-audit',
              group: GROUP_NAV,
              label: 'บันทึกการตรวจสอบ',
              description: 'บันทึกเหตุการณ์ด้านความปลอดภัยทั้งระบบ',
              keywords: 'audit logs admin compliance security บันทึกการตรวจสอบ',
              icon: <FileTextIcon className="size-4 shrink-0" />,
              action: () => onSelectTab?.('audit'),
            },
            {
              id: 'nav-monitoring',
              group: GROUP_NAV,
              label: 'สถานะระบบ',
              description: 'ประสิทธิภาพและสุขภาพของระบบแบบเรียลไทม์',
              keywords: 'monitoring metrics latency health มอนิเตอร์ สถานะระบบ',
              icon: <BarChartIcon className="size-4 shrink-0" />,
              action: () => onSelectTab?.('monitoring'),
            },
          ]
        : []),
    ];

    const actionItems = [
      {
        id: 'action-lock',
        group: GROUP_ACTIONS,
        label: isVaultUnlocked ? 'ล็อกคลัง' : 'คลังล็อกอยู่แล้ว',
        description: 'ล้างกุญแจถอดรหัสออกจากหน่วยความจำของเบราว์เซอร์',
        keywords: 'lock vault secure ล็อกคลัง ล็อก',
        icon: <LockIcon className="size-4 shrink-0" />,
        action: () => onLockVault?.(),
      },
      {
        id: 'action-theme',
        group: GROUP_ACTIONS,
        label: 'สลับธีมมืด / สว่าง',
        description: 'เปลี่ยนรูปลักษณ์ของแอป',
        keywords: 'theme appearance mode dark light ธีม โหมดมืด โหมดสว่าง',
        icon: <SunIcon className="size-4 shrink-0" />,
        action: () => onToggleTheme?.(),
      },
      {
        id: 'action-mfa',
        group: GROUP_ACTIONS,
        label: 'การยืนยันตัวตนสองขั้นตอน (2FA)',
        description: 'ตั้งค่าแอปยืนยันตัวตนสำหรับบัญชีนี้',
        keywords: 'mfa 2fa two factor totp authenticator security ยืนยันตัวตน',
        icon: <ShieldIcon className="size-4 shrink-0" />,
        action: () => onOpenMfa?.(),
      },
      {
        id: 'action-notifications',
        group: GROUP_ACTIONS,
        label: 'การแจ้งเตือนความปลอดภัย',
        description: 'ดูกิจกรรมผิดปกติที่ระบบตรวจพบ',
        keywords: 'notifications security alerts warning bell แจ้งเตือน',
        icon: <BellIcon className="size-4 shrink-0" />,
        action: () => onOpenNotifications?.(),
      },
      {
        id: 'action-logout',
        group: GROUP_ACTIONS,
        label: 'ออกจากระบบ',
        description: 'จบเซสชันการใช้งานปัจจุบัน',
        keywords: 'logout sign out exit quit ออกจากระบบ',
        icon: <LogOutIcon className="size-4 shrink-0" />,
        action: () => onLogout?.(),
      },
    ];

    return [...navItems, ...actionItems];
  }, [isAdmin, isVaultUnlocked, onSelectTab, onLockVault, onToggleTheme, onOpenMfa, onOpenNotifications, onLogout]);

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

  // Reset query and selected index when opened (initial focus comes from data-autofocus)
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeElem = listRef.current.querySelector('[data-selected="true"]');
    if (activeElem) {
      activeElem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const runCommand = (cmd) => {
    cmd?.action?.();
    onOpenChange?.(false);
  };

  // Combobox keyboard handling (Esc is handled by the Dialog primitive)
  const handleInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredCommands.length > 0 ? (prev + 1) % filteredCommands.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredCommands.length > 0 ? (prev - 1 + filteredCommands.length) % filteredCommands.length : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) runCommand(filteredCommands[selectedIndex]);
    }
  };

  const activeCommand = filteredCommands[selectedIndex];
  let flatIndexCounter = 0;

  return (
    <Dialog open={open} onOpenChange={(v) => onOpenChange?.(v)}>
      <DialogContent
        hideCloseButton
        className="max-w-xl gap-0 overflow-hidden p-0 sm:mb-auto sm:mt-[12vh] grid-rows-[auto_minmax(0,1fr)_auto]"
      >
        <DialogTitle className="sr-only">ค้นหาและคำสั่ง</DialogTitle>
        <DialogDescription className="sr-only">
          พิมพ์เพื่อค้นหา ใช้ปุ่มลูกศรขึ้นลงเพื่อเลือก กด Enter เพื่อเปิด และกด Esc เพื่อปิด
        </DialogDescription>

        {/* Search input */}
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-3 sm:px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            data-autofocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="ค้นหาหน้าหรือคำสั่ง…"
            aria-label="ค้นหาหน้าหรือคำสั่ง"
            role="combobox"
            aria-expanded={filteredCommands.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeCommand ? optionId(activeCommand.id) : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="ล้างคำค้นหา"
            >
              <XIcon className="size-4" />
            </button>
          ) : (
            <>
              <kbd className="hidden shrink-0 rounded border border-border bg-secondary px-1.5 font-mono text-xs text-muted-foreground sm:inline-flex">
                Esc
              </kbd>
              <button
                type="button"
                onClick={() => onOpenChange?.(false)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
                aria-label="ปิดการค้นหา"
              >
                <XIcon className="size-4" />
              </button>
            </>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="min-h-0 overflow-y-auto p-2">
          <p className="sr-only" aria-live="polite">
            {filteredCommands.length > 0 ? `พบ ${filteredCommands.length} รายการ` : 'ไม่พบผลลัพธ์'}
          </p>

          {filteredCommands.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-ui text-foreground">ไม่พบผลลัพธ์สำหรับ “{query}”</p>
              <p className="mt-1 text-xs text-muted-foreground">ลองพิมพ์ชื่อหน้า เช่น “คอลเลกชัน” หรือ “ล็อกคลัง”</p>
            </div>
          ) : (
            <div id={listboxId} role="listbox" aria-label="ผลการค้นหา" className="space-y-3">
              {Object.entries(groupedCommands).map(([groupTitle, commands]) => {
                const groupLabelId = `${baseId}-group-${groupTitle === GROUP_NAV ? 'nav' : 'actions'}`;
                return (
                  <div key={groupTitle} role="group" aria-labelledby={groupLabelId}>
                    <p id={groupLabelId} className="px-2 pb-1 text-xs font-ui text-muted-foreground">
                      {groupTitle}
                    </p>
                    <div className="space-y-0.5">
                      {commands.map((cmd) => {
                        const currentIndex = flatIndexCounter++;
                        const isSelected = currentIndex === selectedIndex;

                        return (
                          <div
                            key={cmd.id}
                            id={optionId(cmd.id)}
                            role="option"
                            aria-selected={isSelected}
                            data-selected={isSelected}
                            onClick={() => runCommand(cmd)}
                            onMouseMove={() => setSelectedIndex(currentIndex)}
                            className={cn(
                              'flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-fast',
                              isSelected ? 'bg-accent text-foreground' : 'text-secondary-foreground'
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                className={cn(
                                  'flex size-8 shrink-0 items-center justify-center rounded-md border border-border',
                                  isSelected ? 'bg-background text-foreground' : 'bg-secondary text-muted-foreground'
                                )}
                              >
                                {cmd.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-ui">{cmd.label}</div>
                                <div className="truncate text-xs text-muted-foreground">{cmd.description}</div>
                              </div>
                            </div>
                            {isSelected && (
                              <kbd
                                aria-hidden="true"
                                className="hidden shrink-0 rounded border border-border bg-background px-1.5 font-mono text-xs text-muted-foreground sm:inline-flex"
                              >
                                ↵
                              </kbd>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Shortcut hints */}
        <div
          aria-hidden="true"
          className="hidden items-center justify-between gap-3 border-t border-border bg-secondary px-4 py-2 text-xs text-muted-foreground sm:flex"
        >
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1 font-mono">↑</kbd>
              <kbd className="rounded border border-border bg-background px-1 font-mono">↓</kbd>
              เลือก
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1 font-mono">↵</kbd>
              เปิด
            </span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-background px-1 font-mono">Esc</kbd>
            ปิด
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CommandPalette;
