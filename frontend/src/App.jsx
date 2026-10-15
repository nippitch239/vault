import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './components/Common/Toast.jsx';
import api from './services/api.js';

// Layout & Navigation Primitives
import { TopNav } from './components/Layout/TopNav.jsx';
import { CommandPalette } from './components/Layout/CommandPalette.jsx';

// Auth Views
import { LoginView, AuthNavProvider } from './components/Auth/LoginView.jsx';
import { LandingView } from './components/Landing/LandingView.jsx';
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
  const [authView, setAuthView] = useState('landing'); // 'landing' | 'login' | 'register' | 'confirm' | 'reset'
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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Security notifications & MFA modals
  const [notificationCount, setNotificationCount] = useState(0);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [showMfaModal, setShowMfaModal] = useState(false);

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

  // Global Keyboard Shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+K or Ctrl+K -> Command Palette
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Logged-out authentication screens
  if (!isAuthenticated) {
    const goTo = (view) => () => {
      setAuthView(view);
      window.scrollTo(0, 0);
    };
    if (authView === 'landing') {
      return <LandingView onSignIn={goTo('login')} onSignUp={goTo('register')} />;
    }
    return (
      <AuthNavProvider value={{ onHome: goTo('landing'), onSignIn: goTo('login'), onSignUp: goTo('register') }}>
      <main className="min-h-screen w-full text-foreground">
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
      </AuthNavProvider>
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
    <div className="min-h-screen font-sans text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-md focus:border focus:border-border focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:font-ui focus:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>

      {/* Sticky top navigation bar (links collapse into a drawer below lg) */}
      <TopNav
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenSecurityNotifications={() => setShowNotificationModal(true)}
        onOpenMfaModal={() => setShowMfaModal(true)}
        notificationCount={notificationCount}
      />

      {/* Main Application Content Area */}
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl overflow-x-clip px-4 py-8 focus:outline-none sm:px-6">
        {renderCurrentTab()}
      </main>

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
