import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import {
  ShieldIcon,
  KeyIcon,
  BellIcon,
  LockIcon,
  UnlockIcon,
  ChartBarIcon,
  ShareIcon,
} from '../Common/Icons.jsx';
import { SecurityNotificationModal } from '../Logs/SecurityNotificationModal.jsx';
import { MfaModal } from '../Auth/MfaModal.jsx';

export function Navbar({ currentTab, onSelectTab }) {
  const { user, isVaultUnlocked, lockVault, logout, isAdmin } = useAuth();

  const [notificationCount, setNotificationCount] = useState(0);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Poll or fetch security notification count
  useEffect(() => {
    if (isAdmin) {
      api.logs
        .getSecurityNotifications()
        .then((res) => {
          setNotificationCount(res?.data?.length || 0);
        })
        .catch(() => {});
    }
  }, [isAdmin]);

  return (
    <>
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3 cursor-pointer shrink-0" onClick={() => onSelectTab('vault')}>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/20">
              <ShieldIcon className="w-6 h-6" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight text-white flex items-center space-x-1.5">
                <span>SecureVault</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  Cloud
                </span>
              </span>
              <span className="text-[10px] text-slate-400 hidden sm:block -mt-0.5">Zero-Knowledge Architecture</span>
            </div>
          </div>

          {/* Center Navigation Links */}
          <nav className="hidden xl:flex items-center space-x-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => onSelectTab('vault')}
              className={`px-3 py-2 rounded-xl transition-colors ${
                currentTab === 'vault'
                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              คลังรหัสผ่าน (Vault)
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('generator')}
              className={`px-3 py-2 rounded-xl transition-colors ${
                currentTab === 'generator'
                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              เครื่องมือสุ่ม (Generator)
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('shared')}
              className={`px-3 py-2 rounded-xl transition-colors ${
                currentTab === 'shared'
                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              แชร์กับฉัน (Shared)
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('collections')}
              className={`px-3 py-2 rounded-xl transition-colors ${
                currentTab === 'collections'
                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              คอลเลกชัน (Collections)
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('groups')}
              className={`px-3 py-2 rounded-xl transition-colors ${
                currentTab === 'groups'
                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              กลุ่มผู้ใช้ (Groups)
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('activity')}
              className={`px-3 py-2 rounded-xl transition-colors ${
                currentTab === 'activity'
                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              กิจกรรมของฉัน (Activity)
            </button>

            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => onSelectTab('audit')}
                  className={`px-3 py-2 rounded-xl transition-colors ${
                    currentTab === 'audit'
                      ? 'bg-slate-800 text-purple-400 font-semibold'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  บันทึกระบบ (Audit)
                </button>

                <button
                  type="button"
                  onClick={() => onSelectTab('monitoring')}
                  className={`px-3 py-2 rounded-xl transition-colors ${
                    currentTab === 'monitoring'
                      ? 'bg-slate-800 text-purple-400 font-semibold'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  มอนิเตอร์ (Monitoring)
                </button>
              </>
            )}
          </nav>

          {/* Right Action Icons & Profile */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* Vault Lock Status indicator / toggle */}
            <button
              type="button"
              onClick={() => {
                if (isVaultUnlocked) {
                  lockVault();
                }
              }}
              title={isVaultUnlocked ? 'คลังรหัสผ่านปลดล็อกอยู่ (คลิกเพื่อล็อก)' : 'คลังรหัสผ่านถูกล็อกอยู่'}
              className={`p-2 rounded-xl border transition-colors flex items-center space-x-1 text-xs shrink-0 ${
                isVaultUnlocked
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
              }`}
            >
              {isVaultUnlocked ? <UnlockIcon className="w-4 h-4" /> : <LockIcon className="w-4 h-4" />}
              <span className="hidden sm:inline font-mono">{isVaultUnlocked ? 'Unlocked' : 'Locked'}</span>
            </button>

            {/* Security Bell (UC-8) */}
            <button
              type="button"
              onClick={() => setShowNotificationModal(true)}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors relative shrink-0"
              title="การแจ้งเตือนความปลอดภัย"
            >
              <BellIcon className="w-5 h-5" />
              {notificationCount > 0 && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse" />
              )}
            </button>

            {/* User Dropdown / Controls */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center space-x-2 pl-2 pr-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:bg-slate-700/60 transition-colors text-left"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-xs uppercase">
                  {user?.username?.charAt(0) || 'U'}
                </div>
                <div className="hidden sm:block text-xs">
                  <span className="font-semibold text-slate-200 block truncate max-w-[100px]">
                    {user?.username || 'User'}
                  </span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                    {user?.role || 'user'}
                  </span>
                </div>
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl py-2 z-50 text-xs text-slate-200 animate-fadeIn">
                  <div className="px-4 py-2 border-b border-slate-700">
                    <p className="font-bold text-white truncate">{user?.full_name || user?.username}</p>
                    <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowMfaModal(true);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-700/60 flex items-center space-x-2 transition-colors"
                  >
                    <ShieldIcon className="w-4 h-4 text-emerald-400" />
                    <span>ตั้งค่า MFA (2-Factor Auth)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      lockVault();
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-700/60 flex items-center space-x-2 transition-colors"
                  >
                    <LockIcon className="w-4 h-4 text-amber-400" />
                    <span>ล็อกคลังรหัสผ่าน (Lock Vault)</span>
                  </button>

                  <div className="border-t border-slate-700 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      logout();
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-rose-950/40 text-rose-300 flex items-center space-x-2 transition-colors font-medium"
                  >
                    <span>ออกจากระบบ (Logout)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile / Tablet Sub-Navigation */}
        <div className="xl:hidden flex items-center space-x-2 py-2 overflow-x-auto text-xs border-t border-slate-800">
          <button
            type="button"
            onClick={() => onSelectTab('vault')}
            className={`px-3 py-1 rounded-lg ${currentTab === 'vault' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
          >
            Vault
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('generator')}
            className={`px-3 py-1 rounded-lg ${currentTab === 'generator' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
          >
            Generator
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('shared')}
            className={`px-3 py-1 rounded-lg ${currentTab === 'shared' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
          >
            Shared
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('collections')}
            className={`px-3 py-1 rounded-lg ${currentTab === 'collections' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
          >
            Collections
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('groups')}
            className={`px-3 py-1 rounded-lg ${currentTab === 'groups' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
          >
            Groups
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('activity')}
            className={`px-3 py-1 rounded-lg ${currentTab === 'activity' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
          >
            Activity
          </button>
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => onSelectTab('audit')}
                className={`px-3 py-1 rounded-lg ${currentTab === 'audit' ? 'bg-purple-600 text-white' : 'text-slate-400'}`}
              >
                Audit
              </button>
              <button
                type="button"
                onClick={() => onSelectTab('monitoring')}
                className={`px-3 py-1 rounded-lg ${currentTab === 'monitoring' ? 'bg-purple-600 text-white' : 'text-slate-400'}`}
              >
                Monitoring
              </button>
            </>
          )}
        </div>
      </div>
    </header>

      {/* Security Notification Modal (UC-8) */}
      <SecurityNotificationModal
        isOpen={showNotificationModal}
        onClose={() => setShowNotificationModal(false)}
      />

      {/* MFA Setup Modal (UC-3) */}
      <MfaModal
        isOpen={showMfaModal}
        mode="setup"
        onClose={() => setShowMfaModal(false)}
      />
    </>
  );
}

export default Navbar;
