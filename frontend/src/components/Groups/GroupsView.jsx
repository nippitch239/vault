import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import { PlusIcon, SearchIcon, EditIcon, TrashIcon, RefreshIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import {
  Button,
  Badge,
  Card,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Field,
  Textarea,
  Select,
  Alert,
  Skeleton,
  EmptyState,
  ConfirmDialog,
} from '../ui/index.js';

const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;

export const GROUP_ROLE_LABELS = {
  admin: 'ผู้ดูแลกลุ่ม',
  manager: 'ผู้จัดการ',
  member: 'สมาชิก',
};

const GROUP_ROLE_HINTS = {
  member: 'ได้รับสิทธิ์คอลเลกชันที่มอบให้กลุ่มนี้',
  manager: 'เพิ่ม/นำสมาชิกออก และแก้ไขข้อมูลกลุ่มได้',
  admin: 'จัดการทุกอย่างในกลุ่ม รวมถึงแต่งตั้งผู้ดูแลกลุ่ม',
};

const GROUP_ROLE_BADGE = { admin: 'info', manager: 'success', member: 'outline' };

// Known backend messages → Thai. Anything else is shown as the server sent it.
const API_MESSAGES_TH = {
  'You cannot assign a group role higher than your own': 'คุณกำหนดบทบาทที่สูงกว่าบทบาทของตัวเองไม่ได้',
  'You cannot remove a member with a higher group role than your own': 'คุณนำสมาชิกที่มีบทบาทสูงกว่าคุณออกจากกลุ่มไม่ได้',
  'Only group admin or manager can add members': 'เฉพาะผู้ดูแลกลุ่มหรือผู้จัดการเท่านั้นที่เพิ่มสมาชิกได้',
  'Insufficient permission to remove member': 'คุณไม่มีสิทธิ์นำสมาชิกคนนี้ออก',
  'User is already a member of this group': 'ผู้ใช้นี้เป็นสมาชิกของกลุ่มอยู่แล้ว',
  'Only group creator or admin can delete group': 'เฉพาะผู้สร้างกลุ่มหรือผู้ดูแลระบบเท่านั้นที่ลบกลุ่มได้',
  'Only group admin, manager, or creator can update group': 'เฉพาะผู้ดูแลกลุ่ม ผู้จัดการ หรือผู้สร้างกลุ่มเท่านั้นที่แก้ไขกลุ่มได้',
  'Target user not found': 'ไม่พบบัญชีผู้ใช้นี้ในระบบ',
};
const apiMessage = (err, fallback) => API_MESSAGES_TH[err?.message] || err?.message || fallback;

function UserGroupIcon({ className = 'size-5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

function UserPlusIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
      />
    </svg>
  );
}

const charCount = (s) => [...(s || '')].length;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '—');
const groupIdOf = (g) => g?.group_id || g?.id;

export function GroupsView() {
  const { user, isAdmin } = useAuth();
  const { addToast } = useToast();

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Create / edit
  const [editor, setEditor] = useState(null); // { mode: 'create' | 'edit', group? }
  const [groupFormData, setGroupFormData] = useState({ name: '', description: '' });
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Members
  const [membersGroup, setMembersGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState(null);
  const [memberUsername, setMemberUsername] = useState('');
  const [memberUsernameError, setMemberUsernameError] = useState(null);
  const [selectedRole, setSelectedRole] = useState('member');
  const [addingMember, setAddingMember] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.groups.list();
      setGroups(res?.groups || []);
    } catch (err) {
      setError(err.message || 'โหลดรายการกลุ่มไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const loadMembers = useCallback(async (groupId) => {
    if (!groupId) return;
    setLoadingMembers(true);
    setMembersError(null);
    try {
      const res = await api.groups.listMembers(groupId);
      setMembers(res?.members || []);
    } catch (err) {
      setMembersError(err.message || 'โหลดรายชื่อสมาชิกไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  // ---------------------------------------------------------------- create / edit

  const openCreate = () => {
    setGroupFormData({ name: '', description: '' });
    setFormErrors({});
    setEditor({ mode: 'create' });
  };

  const openEdit = (grp) => {
    setGroupFormData({ name: grp.name || '', description: grp.description || '' });
    setFormErrors({});
    setEditor({ mode: 'edit', group: grp });
  };

  const validateForm = () => {
    const errors = {};
    const name = groupFormData.name.trim();
    if (!name) errors.name = 'กรุณาระบุชื่อกลุ่ม';
    else if (charCount(name) > NAME_MAX) errors.name = `ชื่อยาวได้ไม่เกิน ${NAME_MAX} ตัวอักษร`;
    if (charCount(groupFormData.description.trim()) > DESCRIPTION_MAX) {
      errors.description = `คำอธิบายยาวได้ไม่เกิน ${DESCRIPTION_MAX.toLocaleString('th-TH')} ตัวอักษร`;
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveGroup = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    try {
      const payload = {
        name: groupFormData.name.trim(),
        description: groupFormData.description.trim() || null,
      };
      if (editor?.mode === 'edit' && editor.group) {
        await api.groups.update(groupIdOf(editor.group), payload);
        addToast('บันทึกการแก้ไขกลุ่มแล้ว', 'success');
      } else {
        await api.groups.create(payload);
        addToast('สร้างกลุ่มแล้ว', 'success');
      }
      setEditor(null);
      loadGroups();
    } catch (err) {
      setFormErrors({ form: apiMessage(err, 'บันทึกกลุ่มไม่สำเร็จ ลองอีกครั้ง') });
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- delete

  const handleDeleteGroup = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.groups.delete(groupIdOf(deleteTarget));
      addToast(`ลบกลุ่ม “${deleteTarget.name}” แล้ว`, 'success');
      setDeleteTarget(null);
      loadGroups();
    } catch (err) {
      addToast(apiMessage(err, 'ลบกลุ่มไม่สำเร็จ ลองอีกครั้ง'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------- members

  const openMembers = (grp) => {
    setMembersGroup(grp);
    setMembers([]);
    setMemberUsername('');
    setMemberUsernameError(null);
    setSelectedRole('member');
    loadMembers(groupIdOf(grp));
  };

  // Members are added by username; the server resolves it (only group admins/managers can).
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!membersGroup) return;
    const username = memberUsername.trim().toLowerCase();
    if (!username) {
      setMemberUsernameError('กรุณากรอกชื่อผู้ใช้');
      return;
    }
    setAddingMember(true);
    try {
      const groupId = groupIdOf(membersGroup);
      const res = await api.groups.addMember(groupId, { username, role: effectiveRole });
      const added = res?.member || {};
      addToast(`เพิ่ม ${added.full_name || added.username || username} เข้ากลุ่มแล้ว`, 'success');
      setMemberUsername('');
      loadMembers(groupId);
    } catch (err) {
      if (err?.status === 404) setMemberUsernameError('ไม่พบบัญชีที่ใช้ชื่อผู้ใช้นี้');
      else if (err?.status === 409) setMemberUsernameError('ผู้ใช้นี้อยู่ในกลุ่มแล้ว');
      else addToast(apiMessage(err, 'เพิ่มสมาชิกไม่สำเร็จ ลองอีกครั้ง'), 'error');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async () => {
    const memberUserId = removeTarget?.userId;
    if (!membersGroup || !memberUserId) return;
    setRemoving(true);
    try {
      const groupId = groupIdOf(membersGroup);
      await api.groups.removeMember(groupId, memberUserId);
      addToast(`นำ ${removeTarget.name} ออกจากกลุ่มแล้ว`, 'success');
      setRemoveTarget(null);
      loadMembers(groupId);
    } catch (err) {
      addToast(apiMessage(err, 'นำสมาชิกออกไม่สำเร็จ ลองอีกครั้ง'), 'error');
    } finally {
      setRemoving(false);
    }
  };

  // ---------------------------------------------------------------- derived

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => `${g.name || ''} ${g.description || ''}`.toLowerCase().includes(q));
  }, [groups, searchQuery]);

  const isCreator = (grp) => Boolean(grp?.created_by && user?.user_id && grp.created_by === user.user_id);

  // The backend refuses to let a manager hand out a role above their own. Hide the
  // "admin" option only when we positively know the current user is not a group admin.
  const myMemberRole = useMemo(() => {
    const me = members.find((m) => (m.user_id || m.userId) === user?.user_id);
    return me ? String(me.role || 'member').toLowerCase() : null;
  }, [members, user]);
  const canAssignAdmin =
    isAdmin || isCreator(membersGroup) || loadingMembers || Boolean(membersError) || !myMemberRole || myMemberRole === 'admin';
  const roleOptions = canAssignAdmin ? ['member', 'manager', 'admin'] : ['member', 'manager'];
  const effectiveRole = roleOptions.includes(selectedRole) ? selectedRole : 'member';

  // ---------------------------------------------------------------- render

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">กลุ่ม</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            รวมผู้ใช้เป็นกลุ่มเพื่อให้สิทธิ์คอลเลกชันได้ในครั้งเดียว สมาชิกใหม่จะได้รับสิทธิ์ตามกลุ่มโดยอัตโนมัติ
          </p>
        </div>
        <Button onClick={openCreate} className="w-full sm:w-auto">
          <PlusIcon />
          สร้างกลุ่ม
        </Button>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative w-full sm:max-w-sm">
          <label htmlFor="group-search" className="sr-only">
            ค้นหากลุ่ม
          </label>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="group-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาจากชื่อหรือคำอธิบาย"
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" onClick={loadGroups} disabled={loading} aria-label="โหลดรายการกลุ่มใหม่">
          <RefreshIcon className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      <section aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-8 w-1/2" />
              </Card>
            ))}
            <span className="sr-only">กำลังโหลดรายการกลุ่ม</span>
          </div>
        ) : error ? (
          <Alert
            variant="error"
            title="โหลดรายการกลุ่มไม่สำเร็จ"
            action={
              <Button variant="outline" size="sm" onClick={loadGroups}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {error}
          </Alert>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<UserGroupIcon />}
            title="ยังไม่มีกลุ่ม"
            description="สร้างกลุ่มแล้วเพิ่มสมาชิก จากนั้นให้สิทธิ์คอลเลกชันกับทั้งกลุ่มได้ในครั้งเดียว"
            action={
              <Button onClick={openCreate}>
                <PlusIcon />
                สร้างกลุ่มแรก
              </Button>
            }
          />
        ) : filteredGroups.length === 0 ? (
          <EmptyState
            icon={<SearchIcon className="size-5" />}
            title="ไม่พบกลุ่มที่ตรงกับคำค้นหา"
            description={`ไม่มีกลุ่มที่มีคำว่า “${searchQuery.trim()}”`}
            action={
              <Button variant="outline" onClick={() => setSearchQuery('')}>
                ล้างคำค้นหา
              </Button>
            }
          />
        ) : (
          <>
            <p className="mb-3 text-caption text-muted-foreground">{filteredGroups.length.toLocaleString('th-TH')} กลุ่ม</p>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredGroups.map((grp) => {
                const creator = isCreator(grp);
                // Only the creator or a system admin may delete; unknown creator → keep the button.
                const canDelete = isAdmin || creator || !grp.created_by;
                return (
                  <li key={groupIdOf(grp)}>
                    <Card className="flex h-full flex-col p-5 transition-colors duration-fast hover:border-input">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
                            <UserGroupIcon className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <h2 className="truncate text-base" title={grp.name}>
                              {grp.name}
                            </h2>
                            <p className="text-caption text-muted-foreground">สร้างเมื่อ {formatDate(grp.created_at)}</p>
                          </div>
                        </div>
                        {creator && <Badge variant="outline">ผู้สร้าง</Badge>}
                      </div>

                      <p className={`mt-3 line-clamp-2 flex-1 text-sm ${grp.description ? 'text-secondary-foreground' : 'italic text-muted-foreground'}`}>
                        {grp.description || 'ไม่มีคำอธิบาย'}
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                        <Button variant="secondary" size="sm" onClick={() => openMembers(grp)}>
                          <UserPlusIcon />
                          จัดการสมาชิก
                        </Button>
                        <div className="ml-auto flex items-center gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => openEdit(grp)} aria-label={`แก้ไขกลุ่ม ${grp.name}`}>
                            <EditIcon />
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="hover:bg-error hover:text-error-foreground"
                              onClick={() => setDeleteTarget(grp)}
                              aria-label={`ลบกลุ่ม ${grp.name}`}
                            >
                              <TrashIcon />
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* Create / edit */}
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && !saving && setEditor(null)}>
        <DialogContent>
          <form onSubmit={handleSaveGroup} noValidate className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{editor?.mode === 'edit' ? 'แก้ไขกลุ่ม' : 'สร้างกลุ่มใหม่'}</DialogTitle>
              <DialogDescription>
                {editor?.mode === 'edit'
                  ? 'เปลี่ยนชื่อหรือคำอธิบาย สมาชิกและสิทธิ์ของกลุ่มจะไม่เปลี่ยน'
                  : 'คุณจะเป็นผู้ดูแลกลุ่มนี้ และเพิ่มสมาชิกได้หลังสร้างเสร็จ'}
              </DialogDescription>
            </DialogHeader>

            {formErrors.form && <Alert variant="error">{formErrors.form}</Alert>}

            <Field label="ชื่อกลุ่ม" required error={formErrors.name}>
              {(props) => (
                <Input
                  {...props}
                  data-autofocus
                  value={groupFormData.name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  placeholder="เช่น ทีมวิศวกรรม, ฝ่ายการเงิน"
                  onChange={(e) => setGroupFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
              )}
            </Field>

            <Field
              label="คำอธิบาย"
              error={formErrors.description}
              hint={`${charCount(groupFormData.description).toLocaleString('th-TH')} / ${DESCRIPTION_MAX.toLocaleString('th-TH')} ตัวอักษร`}
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={groupFormData.description}
                  maxLength={DESCRIPTION_MAX}
                  placeholder="กลุ่มนี้ใช้ทำอะไร ใครควรเป็นสมาชิก"
                  onChange={(e) => setGroupFormData((prev) => ({ ...prev, description: e.target.value }))}
                />
              )}
            </Field>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
                ยกเลิก
              </Button>
              <Button type="submit" loading={saving}>
                {editor?.mode === 'edit' ? 'บันทึก' : 'สร้างกลุ่ม'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`ลบกลุ่ม “${deleteTarget?.name || ''}”?`}
        description="สมาชิกทุกคนจะถูกนำออกจากกลุ่ม และเสียสิทธิ์คอลเลกชันที่ได้รับผ่านกลุ่มนี้ การลบนี้ย้อนกลับไม่ได้"
        confirmLabel="ลบกลุ่ม"
        loading={deleting}
        onConfirm={handleDeleteGroup}
      />

      {/* Members */}
      <Dialog open={Boolean(membersGroup)} onOpenChange={(open) => !open && !addingMember && setMembersGroup(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>สมาชิก · {membersGroup?.name}</DialogTitle>
            <DialogDescription>เพิ่มสมาชิกด้วยชื่อผู้ใช้ แล้วเลือกบทบาทในกลุ่ม</DialogDescription>
          </DialogHeader>

          <section aria-labelledby="add-member-heading" className="grid gap-4 rounded-lg border border-border bg-card p-4">
            <h3 id="add-member-heading" className="text-sm">
              เพิ่มสมาชิก
            </h3>

            <form onSubmit={handleAddMember} noValidate className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
              <Field label="ชื่อผู้ใช้" error={memberUsernameError} className="sm:col-span-2">
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={memberUsername}
                    placeholder="เช่น somchai"
                    onChange={(e) => {
                      setMemberUsername(e.target.value);
                      setMemberUsernameError(null);
                    }}
                  />
                )}
              </Field>
              <Field label="บทบาทในกลุ่ม" hint={GROUP_ROLE_HINTS[effectiveRole]}>
                {(props) => (
                  <Select {...props} value={effectiveRole} onChange={(e) => setSelectedRole(e.target.value)}>
                    {roleOptions.map((r) => (
                      <option key={r} value={r}>
                        {GROUP_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button type="submit" loading={addingMember} className="sm:mt-7">
                <PlusIcon />
                เพิ่มเข้ากลุ่ม
              </Button>
            </form>
          </section>

          <section aria-labelledby="members-heading" className="grid gap-2" aria-live="polite">
            <h3 id="members-heading" className="text-sm">
              สมาชิกปัจจุบัน {!loadingMembers && !membersError && `(${members.length.toLocaleString('th-TH')})`}
            </h3>
            {loadingMembers ? (
              <div className="grid gap-2" aria-busy="true">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <span className="sr-only">กำลังโหลดรายชื่อสมาชิก</span>
              </div>
            ) : membersError ? (
              <Alert
                variant="error"
                action={
                  <Button size="sm" variant="outline" onClick={() => loadMembers(groupIdOf(membersGroup))}>
                    ลองอีกครั้ง
                  </Button>
                }
              >
                {membersError}
              </Alert>
            ) : members.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                ยังไม่มีสมาชิกในกลุ่มนี้ กรอกชื่อผู้ใช้ด้านบนเพื่อเพิ่มคนแรก
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {members.map((mbr) => {
                  const memberId = mbr.user_id || mbr.userId;
                  const role = String(mbr.role || 'member').toLowerCase();
                  const isSelf = memberId === user?.user_id;
                  const name = mbr.full_name || mbr.fullName || mbr.username || mbr.email || 'ผู้ใช้';
                  return (
                    <li key={mbr.id || mbr.group_member_id || memberId} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-ui" aria-hidden="true">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-ui">
                          {name}
                          {isSelf && <span className="text-muted-foreground"> (คุณ)</span>}
                        </p>
                        {mbr.email && <p className="truncate text-caption text-muted-foreground">{mbr.email}</p>}
                      </div>
                      <Badge variant={GROUP_ROLE_BADGE[role] || 'outline'}>{GROUP_ROLE_LABELS[role] || role}</Badge>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:bg-error hover:text-error-foreground"
                        onClick={() => setRemoveTarget({ userId: memberId, name, isSelf })}
                        aria-label={isSelf ? 'ออกจากกลุ่มนี้' : `นำ ${name} ออกจากกลุ่ม`}
                      >
                        <TrashIcon />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersGroup(null)} disabled={addingMember}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={removeTarget?.isSelf ? `ออกจากกลุ่ม “${membersGroup?.name || ''}”?` : `นำ ${removeTarget?.name || ''} ออกจากกลุ่ม?`}
        description={
          removeTarget?.isSelf
            ? 'คุณจะเสียสิทธิ์คอลเลกชันที่ได้รับผ่านกลุ่มนี้ทันที และต้องให้ผู้ดูแลกลุ่มเพิ่มกลับหากต้องการเข้าอีก'
            : 'ผู้นี้จะเสียสิทธิ์คอลเลกชันที่ได้รับผ่านกลุ่มนี้ทันที หากเคยเปิดดูรหัสผ่านไปแล้ว ควรเปลี่ยนรหัสผ่านที่สำคัญ'
        }
        confirmLabel={removeTarget?.isSelf ? 'ออกจากกลุ่ม' : 'นำออกจากกลุ่ม'}
        loading={removing}
        onConfirm={handleRemoveMember}
      />
    </div>
  );
}

export default GroupsView;
