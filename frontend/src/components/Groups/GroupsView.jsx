import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import {
  PlusIcon,
  SearchIcon,
  EditIcon,
  TrashIcon,
  CloseIcon,
  CheckIcon,
  RefreshIcon,
  KeyIcon,
} from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';

// Inline UserGroupIcon component
function UserGroupIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

function UserPlusIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
      />
    </svg>
  );
}

export function GroupsView() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state: 'create' | 'edit' | 'delete' | 'members' | null
  const [activeModal, setActiveModal] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state for Create / Edit group
  const [groupFormData, setGroupFormData] = useState({ name: '', description: '' });

  // Members Modal state
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberLookupEmail, setMemberLookupEmail] = useState('');
  const [foundUser, setFoundUser] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [selectedRole, setSelectedRole] = useState('member');

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.groups.list();
      setGroups(res?.groups || []);
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดรายการกลุ่มผู้ใช้ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Load members of selected group
  const loadMembers = useCallback(async (groupId) => {
    if (!groupId) return;
    setLoadingMembers(true);
    try {
      const res = await api.groups.listMembers(groupId);
      setMembers(res?.members || []);
    } catch (err) {
      addToast(err.message || 'ไม่สามารถโหลดสมาชิกของกลุ่มได้', 'error');
    } finally {
      setLoadingMembers(false);
    }
  }, [addToast]);

  const handleOpenCreateModal = () => {
    setSelectedGroup(null);
    setGroupFormData({ name: '', description: '' });
    setActiveModal('create');
  };

  const handleOpenEditModal = (grp) => {
    setSelectedGroup(grp);
    setGroupFormData({
      name: grp.name || '',
      description: grp.description || '',
    });
    setActiveModal('edit');
  };

  const handleOpenDeleteModal = (grp) => {
    setSelectedGroup(grp);
    setActiveModal('delete');
  };

  const handleOpenMembersModal = (grp) => {
    setSelectedGroup(grp);
    setMemberLookupEmail('');
    setFoundUser(null);
    setLookupError(null);
    setSelectedRole('member');
    setActiveModal('members');
    loadMembers(grp.group_id || grp.id);
  };

  const handleSaveGroup = async (e) => {
    e.preventDefault();
    if (!groupFormData.name.trim()) {
      addToast('กรุณาระบุชื่อกลุ่ม (Group name is required)', 'error');
      return;
    }

    setActionLoading(true);
    try {
      if (activeModal === 'edit' && selectedGroup) {
        const groupId = selectedGroup.group_id || selectedGroup.id;
        await api.groups.update(groupId, {
          name: groupFormData.name.trim(),
          description: groupFormData.description.trim() || null,
        });
        addToast('แก้ไขข้อมูลกลุ่มผู้ใช้สำเร็จ', 'success');
      } else {
        await api.groups.create({
          name: groupFormData.name.trim(),
          description: groupFormData.description.trim() || null,
        });
        addToast('สร้างกลุ่มผู้ใช้ใหม่สำเร็จ', 'success');
      }
      setActiveModal(null);
      setSelectedGroup(null);
      loadGroups();
    } catch (err) {
      addToast(err.message || 'เกิดข้อผิดพลาดในการบันทึกกลุ่ม', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroup) return;
    setActionLoading(true);
    try {
      const groupId = selectedGroup.group_id || selectedGroup.id;
      await api.groups.delete(groupId);
      addToast('ลบกลุ่มผู้ใช้สำเร็จ', 'success');
      setActiveModal(null);
      setSelectedGroup(null);
      loadGroups();
    } catch (err) {
      addToast(err.message || 'ไม่สามารถลบกลุ่มผู้ใช้ได้', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLookupUser = async (e) => {
    e.preventDefault();
    if (!memberLookupEmail.trim()) {
      setLookupError('กรุณากรอกอีเมลผู้ใช้');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    setFoundUser(null);

    try {
      const res = await api.sharing.lookupUser(memberLookupEmail.trim().toLowerCase());
      if (res?.data) {
        setFoundUser(res.data);
      } else {
        setLookupError('ไม่พบบัญชีผู้ใช้ที่มีอีเมลนี้ในระบบ');
      }
    } catch (err) {
      setLookupError(err.message || 'ไม่พบบัญชีผู้ใช้ที่มีอีเมลนี้ในระบบ');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedGroup || !foundUser) return;
    setActionLoading(true);
    try {
      const groupId = selectedGroup.group_id || selectedGroup.id;
      await api.groups.addMember(groupId, {
        userId: foundUser.user_id,
        role: selectedRole,
      });
      addToast(`เพิ่ม ${foundUser.username || foundUser.email} เข้ากลุ่มแล้ว`, 'success');
      setFoundUser(null);
      setMemberLookupEmail('');
      loadMembers(groupId);
    } catch (err) {
      addToast(err.message || 'ไม่สามารถเพิ่มสมาชิกได้', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveMember = async (memberUserId) => {
    if (!selectedGroup || !memberUserId) return;
    try {
      const groupId = selectedGroup.group_id || selectedGroup.id;
      await api.groups.removeMember(groupId, memberUserId);
      addToast('นำสมาชิกออกจากกลุ่มสำเร็จ', 'success');
      loadMembers(groupId);
    } catch (err) {
      addToast(err.message || 'ไม่สามารถนำสมาชิกออกจากกลุ่มได้', 'error');
    }
  };

  const filteredGroups = groups.filter((g) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchName = (g.name || '').toLowerCase().includes(q);
    const matchDesc = (g.description || '').toLowerCase().includes(q);
    return matchName || matchDesc;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center space-x-2.5">
            <UserGroupIcon className="w-7 h-7 text-emerald-400" />
            <span>กลุ่มผู้ใช้ (User Groups)</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            จัดการกลุ่มสมาชิกและการสืบทอดสิทธิ์การเข้าถึงคอลเลกชันตามมาตรฐาน Bitwarden
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={loadGroups}
            disabled={loading}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl text-sm transition-all shadow-lg shadow-emerald-950/40 flex items-center space-x-2"
          >
            <PlusIcon className="w-4 h-4" />
            <span>สร้างกลุ่มใหม่ (Create Group)</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-2xl text-rose-200 text-sm">
          {error}
        </div>
      )}

      {/* Search Bar */}
      <div className="relative max-w-md">
        <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ค้นหาชื่อกลุ่ม หรือคำอธิบาย..."
          className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
        />
      </div>

      {/* Groups List */}
      {loading ? (
        <div className="py-20 text-center text-slate-400">
          <div className="inline-block w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm">กำลังโหลดข้อมูลกลุ่มผู้ใช้...</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="py-16 text-center bg-slate-800/40 border border-slate-700/50 rounded-3xl p-8">
          <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-4">
            <UserGroupIcon className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-white">ไม่พบกลุ่มผู้ใช้</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto mb-5">
            {searchQuery
              ? 'ไม่พบกลุ่มที่ตรงกับคำค้นหาของคุณ'
              : 'สร้างกลุ่มผู้ใช้เพื่อแบ่งปันรหัสผ่านและจัดการสิทธิ์แบบกลุ่ม'}
          </p>
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl text-sm transition-colors inline-flex items-center space-x-2 shadow-lg shadow-emerald-950/40"
          >
            <PlusIcon className="w-4 h-4" />
            <span>สร้างกลุ่มใหม่ (Create Group)</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGroups.map((grp) => {
            const id = grp.group_id || grp.id;
            const isCreator = grp.created_by === user?.user_id;

            return (
              <div
                key={id}
                className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 hover:border-slate-600 transition-all flex flex-col justify-between shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                        <UserGroupIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white tracking-tight truncate max-w-[200px]">
                          {grp.name}
                        </h3>
                        <span className="text-[11px] text-slate-400 block">
                          สร้างเมื่อ {grp.created_at ? new Date(grp.created_at).toLocaleDateString() : '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {grp.description ? (
                    <p className="text-xs text-slate-300 mb-4 line-clamp-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-800">
                      {grp.description}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 italic mb-4">ไม่มีคำอธิบาย</p>
                  )}
                </div>

                {/* Card Action Buttons */}
                <div className="pt-3 border-t border-slate-700/60 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleOpenMembersModal(grp)}
                    className="px-3 py-1.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors flex items-center space-x-1.5"
                  >
                    <UserPlusIcon className="w-3.5 h-3.5 text-emerald-400" />
                    <span>จัดการสมาชิก (Members)</span>
                  </button>

                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(grp)}
                      className="p-1.5 text-slate-400 hover:text-emerald-400 rounded-lg hover:bg-slate-700/60 transition-colors"
                      title="แก้ไขกลุ่ม"
                    >
                      <EditIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenDeleteModal(grp)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-700/60 transition-colors"
                      title="ลบกลุ่ม"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create / Edit Group */}
      {(activeModal === 'create' || activeModal === 'edit') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="absolute right-5 top-5 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <UserGroupIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  {activeModal === 'edit' ? 'แก้ไขกลุ่มผู้ใช้' : 'สร้างกลุ่มผู้ใช้ใหม่'}
                </h3>
                <p className="text-xs text-slate-400">
                  {activeModal === 'edit' ? 'อัปเดตชื่อหรือคำอธิบายกลุ่ม' : 'เพิ่มกลุ่มเพื่อมอบสิทธิ์ร่วมกัน'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  ชื่อกลุ่ม (Group Name) *
                </label>
                <input
                  type="text"
                  value={groupFormData.name}
                  onChange={(e) => setGroupFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="เช่น ทีมวิศวกรรม, ฝ่ายการเงิน, DevOps"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  คำอธิบาย (Description)
                </label>
                <textarea
                  rows={3}
                  value={groupFormData.description}
                  onChange={(e) => setGroupFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="รายละเอียดวัตถุประสงค์ของกลุ่มผู้ใช้นี้..."
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              </div>

              <div className="flex space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-950/40"
                >
                  <CheckIcon className="w-4 h-4" />
                  <span>{actionLoading ? 'กำลังบันทึก...' : 'บันทึก'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Group */}
      {activeModal === 'delete' && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
              <TrashIcon className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white text-center mb-1">ยืนยันการลบกลุ่ม</h3>
            <p className="text-xs text-slate-300 text-center mb-6">
              คุณแน่ใจหรือไม่ว่าต้องการลบกลุ่ม <span className="font-semibold text-rose-300">"{selectedGroup.name}"</span>?
              สมาชิกทั้งหมดจะหลุดจากกลุ่มและสูญเสียสิทธิ์ที่สืบทอด
            </p>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleDeleteGroup}
                disabled={actionLoading}
                className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {actionLoading ? 'กำลังลบ...' : 'ลบกลุ่ม'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Manage Members */}
      {activeModal === 'members' && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div className="bg-slate-800 border border-slate-700/80 rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl relative my-8">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="absolute right-5 top-5 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <UserGroupIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  สมาชิกกลุ่ม: {selectedGroup.name}
                </h3>
                <p className="text-xs text-slate-400">
                  ค้นหาและเพิ่มสมาชิก พร้อมกำหนดบทบาท (Member, Manager, Admin)
                </p>
              </div>
            </div>

            {/* Add Member Box */}
            <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 mb-5">
              <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
                เพิ่มสมาชิกใหม่เข้ากลุ่ม
              </h4>

              <form onSubmit={handleLookupUser} className="flex gap-2 mb-3">
                <input
                  type="email"
                  value={memberLookupEmail}
                  onChange={(e) => setMemberLookupEmail(e.target.value)}
                  placeholder="กรอกอีเมลผู้ใช้ที่ต้องการเพิ่ม..."
                  className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  disabled={lookupLoading}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors whitespace-nowrap"
                >
                  {lookupLoading ? 'กำลังค้นหา...' : 'ค้นหาผู้ใช้'}
                </button>
              </form>

              {lookupError && (
                <p className="text-xs text-rose-400 mb-2">{lookupError}</p>
              )}

              {foundUser && (
                <div className="p-3 bg-slate-950/80 border border-emerald-500/30 rounded-xl flex items-center justify-between gap-3 animate-fadeIn">
                  <div>
                    <p className="text-xs font-semibold text-white">
                      {foundUser.full_name || foundUser.username}
                    </p>
                    <p className="text-[11px] text-slate-400">{foundUser.email}</p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value)}
                      className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-xs focus:outline-none"
                    >
                      <option value="member">Member (สมาชิก)</option>
                      <option value="admin">Admin (ผู้ดูแล)</option>
                    </select>

                    <button
                      type="button"
                      onClick={handleAddMember}
                      disabled={actionLoading}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center space-x-1"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                      <span>{actionLoading ? 'กำลังเพิ่ม...' : 'เพิ่ม'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Current Members List */}
            <div>
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                รายชื่อสมาชิกปัจจุบัน ({members.length} คน)
              </h4>

              {loadingMembers ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  กำลังโหลดรายชื่อสมาชิก...
                </div>
              ) : members.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800">
                  ยังไม่มีสมาชิกในกลุ่มนี้
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {members.map((mbr) => {
                    const memberId = mbr.user_id || mbr.userId;
                    const role = (mbr.role || 'member').toLowerCase();

                    const roleBadgeColor =
                      role === 'admin'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                        : role === 'manager'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';

                    return (
                      <div
                        key={mbr.id || mbr.group_member_id || memberId}
                        className="p-3 bg-slate-900/60 border border-slate-700/60 rounded-xl flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-2.5">
                          <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-xs uppercase">
                            {mbr.username?.charAt(0) || 'U'}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-white">
                              {mbr.username || memberId}
                            </p>
                            {mbr.email && (
                              <p className="text-[10px] text-slate-400">{mbr.email}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <span
                            className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border ${roleBadgeColor}`}
                          >
                            {role}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRemoveMember(memberId)}
                            className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                            title="นำออกจากกลุ่ม"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-5 mt-4 border-t border-slate-700 text-right">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="py-2 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-xl transition-colors"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GroupsView;
