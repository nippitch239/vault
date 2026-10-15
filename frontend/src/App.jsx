import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './components/Common/Toast.jsx';
import api from './services/api.js';

// Layout & Navigation Primitives
import { Sidebar } from './components/Layout/Sidebar.jsx';
import { AppHeader } from './components/Layout/AppHeader.jsx';
import { CommandPalette } from './components/Layout/CommandPalette.jsx';

// Auth Views
import { LoginView } from './components/Auth/LoginView.jsx';
import { RegisterView } from './components/Auth/RegisterView.jsx';
import { ResetPasswordView } from './components/Auth/ResetPasswordView.jsx';
import { ConfirmSignUpView } from './components/Auth/ConfirmSignUpView.jsx';
import { MfaModal } from './components/Auth/MfaModal.jsx';

// Main Application Views
import { VaultDashboard } from './components/Vault/VaultDashboard.jsx';
import { PasswordGenerator } from './components/Generator/PasswordGenerator.jsx';
import { SharedItemsView } from './components/Sharing/SharedItemsView.jsx';
import { CollectionsView } from './components/Collections/CollectionsView.jsx';
import { GroupsView } from './components/Groups/GroupsView.jsx';
import { UserActivityLogView } from './components/Logs/UserActivityLogView.jsx';
import { AuditLogView } from './components/Admin/AuditLogView.jsx';
import { MonitoringDashboardView } from './components/Admin/MonitoringDashboardView.jsx';
import { SecurityNotificationModal } from './components/Logs/SecurityNotificationModal.jsx';

function MainApp() {
  const { isAuthenticated, isAdmin, lockVault, logout } = useAuth();

  // Auth navigation state when logged out
  const [authView, setAuthView] = useState('login'); // 'login' | 'register' | 'confirm' | 'reset'
  const [pendingConfirmation, setPendingConfirmation] = useState({ username: '', devCode: null });

  const goToConfirm = useCallback((username, devCode = null) => {
    setPendingConfirmation({ username: username || '', devCode });
    setAuthView('confirm');
  }, []);

  // Dashboard tab state when logged in
  const [currentTab, setCurrentTab] = useState('vault');
  // Collection to pre-select in the vault when opened from the Collections page.
  const [vaultCollectionFilter, setVaultCollectionFilter] = useState(null); // 'vault' | 'generator' | 'shared' | 'collections' | 'groups' | 'activity' | 'audit' | 'monitoring'

  // Layout & UI Shell state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('securevault_sidebar_collapsed') === 'true';
    }
    return false;
  });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Security notifications & MFA modals
  const [notificationCount, setNotificationCount] = useState(0);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [showMfaModal, setShowMfaModal] = useState(false);

  // Toggle sidebar collapse and persist
  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('securevault_sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  // Theme toggle helper
  const handleToggleTheme = useCallback(() => {
    const root = document.documentElement;
    const isDark = root.classList.contains('dark');
    if (isDark) {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  }, []);

  // Poll security notification count for admin
  const fetchNotifications = useCallback(() => {
    if (isAdmin) {
      api.logs
        .getSecurityNotifications()
        .then((res) => {
          setNotificationCount(res?.data?.length || 0);
        })
        .catch(() => {});
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchNotifications();
    if (isAdmin) {
      const interval = setInterval(fetchNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [isAdmin, fetchNotifications]);

  // Global Keyboard Shortcuts (Cmd+K / Ctrl+K and Cmd+B / Ctrl+B)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+K or Ctrl+K -> Command Palette
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
      // Cmd+B or Ctrl+B -> Toggle Sidebar
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        handleToggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSidebar]);

  // Logged-out authentication screens
  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8 text-foreground sm:p-6">
        {authView === 'login' && (
          <LoginView
            onNavigateRegister={() => setAuthView('register')}
            onNavigateReset={() => setAuthView('reset')}
            onNavigateConfirm={(identifier) => goToConfirm(identifier)}
            onSuccess={() => setCurrentTab('vault')}
          />
        )}

        {authView === 'register' && (
          <RegisterView onNavigateLogin={() => setAuthView('login')} onNavigateConfirm={goToConfirm} />
        )}

        {authView === 'confirm' && (
          <ConfirmSignUpView
            key={pendingConfirmation.username}
            username={pendingConfirmation.username}
            devCode={pendingConfirmation.devCode}
            onNavigateLogin={() => setAuthView('login')}
          />
        )}

        {authView === 'reset' && (
          <ResetPasswordView onNavigateLogin={() => setAuthView('login')} />
        )}
      </main>
    );
  }

  // Active Tab View Content Renderer
  const renderCurrentTab = () => {
    switch (currentTab) {
      case 'vault':
        return <VaultDashboard initialCollectionFilter={vaultCollectionFilter} />;
      case 'generator':
        return (
          <div className="max-w-2xl mx-auto py-2 sm:py-4">
            <PasswordGenerator />
          </div>
        );
      case 'shared':
        return <SharedItemsView />;
      case 'collections':
        return (
          <CollectionsView
            onOpenCollection={(collectionId) => {
              setVaultCollectionFilter(collectionId);
              setCurrentTab('vault');
            }}
          />
        );
      case 'groups':
        return <GroupsView />;
      case 'activity':
        return <UserActivityLogView />;
      case 'audit':
        return isAdmin ? <AuditLogView /> : <VaultDashboard />;
      case 'monitoring':
        return isAdmin ? <MonitoringDashboardView /> : <VaultDashboard />;
      default:
        return <VaultDashboard />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-md focus:border focus:border-border focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:font-ui focus:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>

      {/* Left Collapsible Rail / Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        collapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        mobileOpen={isMobileNavOpen}
        onMobileOpenChange={setIsMobileNavOpen}
      />

      {/* Main Viewport Container */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Sticky Header */}
        <AppHeader
          currentTab={currentTab}
          onToggleSidebar={handleToggleSidebar}
          isSidebarCollapsed={isSidebarCollapsed}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenSecurityNotifications={() => setShowNotificationModal(true)}
          onOpenMfaModal={() => setShowMfaModal(true)}
          notificationCount={notificationCount}
        />

        {/* Scrollable Main Application Content Area */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            {renderCurrentTab()}
          </div>
        </main>
      </div>

      {/* Quick Search & Command Palette Overlay (Cmd+K / Ctrl+K) */}
      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
        onSelectTab={setCurrentTab}
        onLockVault={lockVault}
        onToggleTheme={handleToggleTheme}
        onOpenMfa={() => setShowMfaModal(true)}
        onOpenNotifications={() => setShowNotificationModal(true)}
        onLogout={logout}
      />

      {/* Security Alerts & Notifications Modal */}
      <SecurityNotificationModal
        isOpen={showNotificationModal}
        onClose={() => setShowNotificationModal(false)}
      />

      {/* MFA Configuration Modal */}
      <MfaModal
        isOpen={showMfaModal}
        mode="setup"
        onClose={() => setShowMfaModal(false)}
      />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <MainApp />
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
