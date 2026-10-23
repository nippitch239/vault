import React from 'react';
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
  ChevronRightIcon,
  PanelLeftIcon,
} from './layoutIcons.jsx';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
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

  const vaultNavItems = [
    {
      id: 'vault',
      label: 'Vault Items',
      description: 'Passwords, notes & credentials',
      icon: <KeyIcon className="size-4 shrink-0" />,
    },
    {
      id: 'shared',
      label: 'Shared with Me',
      description: 'Items shared by others',
      icon: <ShareIcon className="size-4 shrink-0" />,
    },
    {
      id: 'collections',
      label: 'Collections',
      description: 'Zero-knowledge shared folders',
      icon: <FolderIcon className="size-4 shrink-0" />,
    },
    {
      id: 'groups',
      label: 'User Groups',
      description: 'Access control & memberships',
      icon: <UsersIcon className="size-4 shrink-0" />,
    },
    {
      id: 'generator',
      label: 'Password Generator',
      description: 'CSPRNG & Diceware passphrases',
      icon: <SparklesIcon className="size-4 shrink-0" />,
    },
  ];

  const observabilityNavItems = [
    {
      id: 'activity',
      label: 'Activity Log',
      description: 'Personal audit trail',
      icon: <ActivityIcon className="size-4 shrink-0" />,
    },
    ...(isAdmin
      ? [
          {
            id: 'audit',
            label: 'Audit Logs',
            description: 'System-wide compliance logs',
            icon: <FileTextIcon className="size-4 shrink-0" />,
          },
          {
            id: 'monitoring',
            label: 'System Monitoring',
            description: 'Live performance & health',
            icon: <BarChartIcon className="size-4 shrink-0" />,
          },
        ]
      : []),
  ];

  const handleItemClick = (id) => {
    onSelectTab?.(id);
    if (mobileOpen && onMobileOpenChange) {
      onMobileOpenChange(false);
    }
  };

  const renderNavSection = (title, items, isMobile = false) => {
    const isRail = !isMobile && collapsed;

    return (
      <div className="space-y-1">
        {!isRail ? (
          <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {title}
          </div>
        ) : (
          <div className="h-px bg-sidebar-border my-2 mx-2" />
        )}

        <div className="space-y-0.5">
          {items.map((item) => {
            const isActive = currentTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleItemClick(item.id)}
                title={isRail ? item.label : undefined}
                aria-label={item.label}
                className={cn(
                  'group relative flex items-center rounded-lg text-sm font-medium transition-all duration-150',
                  isRail
                    ? 'justify-center size-10 mx-auto'
                    : 'w-full gap-3 px-3 py-2 text-left',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-xs'
                    : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                {isActive && (
                  <span
                    className={cn(
                      'absolute bg-primary rounded-full transition-all duration-200',
                      isRail
                        ? 'left-0.5 top-2 bottom-2 w-1'
                        : 'left-0 top-1.5 bottom-1.5 w-1 rounded-r-full'
                    )}
                  />
                )}

                <span
                  className={cn(
                    'transition-colors',
                    isActive
                      ? 'text-primary'
                      : 'text-sidebar-foreground/70 group-hover:text-sidebar-foreground'
                  )}
                >
                  {item.icon}
                </span>

                {!isRail && (
                  <span className="truncate flex-1 tracking-tight">{item.label}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Collapsible Rail / Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 h-screen border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out select-none relative z-30',
          collapsed ? 'w-14' : 'w-64'
        )}
        aria-label="Sidebar Navigation"
      >
        {/* Brand / Logo Header */}
        <div
          className={cn(
            'h-14 border-b border-sidebar-border flex items-center shrink-0 px-3 transition-all duration-300',
            collapsed ? 'justify-center' : 'justify-between'
          )}
        >
          <div
            className="flex items-center gap-2.5 cursor-pointer overflow-hidden"
            onClick={() => handleItemClick('vault')}
            title="SecureVault Cloud"
          >
            <div className="size-8 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0 shadow-xs">
              <ShieldIcon className="size-4" />
            </div>

            {!collapsed && (
              <div className="min-w-0 flex-1 animate-content-show">
                <div className="font-bold text-sm tracking-tight text-foreground flex items-center gap-1.5 leading-none">
                  <span>SecureVault</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono font-normal">
                    Cloud
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                  Zero-Knowledge Architecture
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Navigation Items */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {renderNavSection('Vault', vaultNavItems)}
          {renderNavSection('Security & Observability', observabilityNavItems)}
        </div>

        {/* Bottom Toggle Rail / Keyboard Shortcut */}
        <div className="p-2 border-t border-sidebar-border shrink-0">
          {!collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground rounded-lg transition-colors"
              title="Collapse sidebar (⌘B / Ctrl+B)"
              aria-label="Collapse sidebar"
            >
              <span className="flex items-center gap-2">
                <PanelLeftIcon className="size-4" />
                <span>Collapse Rail</span>
              </span>
              <kbd className="text-[10px] bg-muted/80 text-muted-foreground px-1.5 py-0.5 rounded font-mono border border-border shadow-2xs">
                ⌘B
              </kbd>
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="flex items-center justify-center size-10 mx-auto text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground rounded-lg transition-colors"
              title="Expand sidebar (⌘B / Ctrl+B)"
              aria-label="Expand sidebar"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Responsive Navigation Drawer */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="p-0 w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col z-[60]"
        >
          {/* Brand Header */}
          <div className="h-14 border-b border-sidebar-border px-4 flex items-center justify-between shrink-0">
            <div
              className="flex items-center gap-2.5 cursor-pointer"
              onClick={() => handleItemClick('vault')}
            >
              <div className="size-8 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                <ShieldIcon className="size-4" />
              </div>
              <div>
                <div className="font-bold text-sm tracking-tight text-foreground flex items-center gap-1.5 leading-none">
                  <span>SecureVault</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono">
                    Cloud
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground text-xs mt-0.5">
                  Zero-Knowledge Architecture
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Section List */}
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
            {renderNavSection('Vault', vaultNavItems, true)}
            {renderNavSection('Security & Observability', observabilityNavItems, true)}
          </div>

          {/* Mobile Footer with info */}
          <div className="p-4 border-t border-sidebar-border shrink-0 text-xs text-muted-foreground">
            <p className="font-mono text-[11px]">SecureVault Cloud v1.0.0</p>
            <p className="text-[10px] mt-0.5">Argon2id &bull; AES-256-GCM &bull; RSA-OAEP</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default Sidebar;
