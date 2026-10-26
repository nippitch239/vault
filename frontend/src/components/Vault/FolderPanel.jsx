import React, { useState, useEffect } from 'react';
import api from '../../services/api.js';
import { useToast } from '../Common/Toast.jsx';
import { Button, Input, Field, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, ConfirmDialog } from '../ui/index.js';
import { PlusIcon, EditIcon, TrashIcon } from '../Common/Icons.jsx';

function FolderIcon({ className = 'size-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

export function FolderPanel({ selectedFolder, onSelectFolder }) {
  const { addToast } = useToast();
  const [folders, setFolders] = useState([]);
  const [, setLoading] = useState(false);

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Rename dialog state
  const [renameFolder, setRenameFolder] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  // Delete confirm state
  const [deleteFolder, setDeleteFolder] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadFolders = async () => {
    if (!api.folders) return;
    setLoading(true);
    try {
      const res = await api.folders.list();
      setFolders(res?.folders || res?.data || []);
    } catch (err) {
      console.warn('Could not load folders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFolders();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreateLoading(true);
    try {
      await api.folders.create({ name: createName.trim() });
      addToast('สร้างโฟลเดอร์แล้ว', 'success');
      setShowCreate(false);
      setCreateName('');
      loadFolders();
    } catch (err) {
      addToast(err.message || 'สร้างโฟลเดอร์ไม่สำเร็จ', 'error');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRename = async (e) => {
    e.preventDefault();
    if (!renameName.trim() || !renameFolder) return;
    setRenameLoading(true);
    try {
      const fid = renameFolder.folder_id || renameFolder.id;
      await api.folders.update(fid, { name: renameName.trim() });
      addToast('เปลี่ยนชื่อโฟลเดอร์แล้ว', 'success');
      setRenameFolder(null);
      setRenameName('');
      loadFolders();
    } catch (err) {
      addToast(err.message || 'เปลี่ยนชื่อโฟลเดอร์ไม่สำเร็จ', 'error');
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteFolder) return;
    setDeleteLoading(true);
    try {
      const fid = deleteFolder.folder_id || deleteFolder.id;
      await api.folders.delete(fid);
      addToast('ลบโฟลเดอร์แล้ว', 'success');
      if ((selectedFolder === fid)) onSelectFolder(null);
      setDeleteFolder(null);
      loadFolders();
    } catch (err) {
      addToast(err.message || 'ลบโฟลเดอร์ไม่สำเร็จ', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const itemBase =
    'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const itemActive = 'bg-accent text-foreground font-ui';
  const itemIdle = 'text-muted-foreground hover:bg-accent hover:text-foreground';

  return (
    <nav aria-label="โฟลเดอร์" className="flex flex-col gap-0.5">
      {/* Static options */}
      <button
        type="button"
        onClick={() => onSelectFolder(null)}
        className={`${itemBase} ${selectedFolder === null ? itemActive : itemIdle}`}
      >
        <FolderIcon />
        <span className="truncate">รายการทั้งหมด</span>
      </button>
      <button
        type="button"
        onClick={() => onSelectFolder('NONE')}
        className={`${itemBase} ${selectedFolder === 'NONE' ? itemActive : itemIdle}`}
      >
        <FolderIcon className="size-4 opacity-40" />
        <span className="truncate">ไม่มีโฟลเดอร์</span>
      </button>

      {/* Divider */}
      {folders.length > 0 && <div className="my-1 h-px bg-border" aria-hidden="true" />}

      {/* User folders */}
      {folders.map((folder) => {
        const fid = folder.folder_id || folder.id;
        const active = selectedFolder === fid;
        return (
          <div key={fid} className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onSelectFolder(fid)}
              className={`${itemBase} flex-1 ${active ? itemActive : itemIdle}`}
            >
              <FolderIcon />
              <span className="truncate">{folder.name}</span>
            </button>
            {/* Edit/delete shown on hover via group */}
            <div className="invisible flex shrink-0 items-center gap-0.5 group-hover:visible [.group:hover_&]:visible">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setRenameFolder(folder);
                  setRenameName(folder.name);
                }}
                aria-label={`เปลี่ยนชื่อ ${folder.name}`}
                className="size-6 text-muted-foreground hover:text-foreground"
              >
                <EditIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDeleteFolder(folder)}
                aria-label={`ลบ ${folder.name}`}
                className="size-6 text-muted-foreground hover:text-destructive"
              >
                <TrashIcon />
              </Button>
            </div>
          </div>
        );
      })}

      {/* Create folder button */}
      <button
        type="button"
        onClick={() => { setCreateName(''); setShowCreate(true); }}
        className={`${itemBase} mt-1 ${itemIdle}`}
      >
        <PlusIcon className="size-4" />
        <span className="truncate">สร้างโฟลเดอร์</span>
      </button>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>สร้างโฟลเดอร์ใหม่</DialogTitle>
            <DialogDescription>ตั้งชื่อโฟลเดอร์เพื่อจัดกลุ่มรายการในคลัง</DialogDescription>
          </DialogHeader>
          <form id="folder-create-form" onSubmit={handleCreate} className="grid gap-4 py-2">
            <Field label="ชื่อโฟลเดอร์" required>
              {(props) => (
                <Input
                  {...props}
                  autoFocus
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="เช่น งาน, ส่วนตัว"
                />
              )}
            </Field>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={createLoading}>
              ยกเลิก
            </Button>
            <Button type="submit" form="folder-create-form" loading={createLoading}>
              สร้าง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={Boolean(renameFolder)} onOpenChange={(open) => { if (!open) setRenameFolder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เปลี่ยนชื่อโฟลเดอร์</DialogTitle>
            <DialogDescription>แก้ไขชื่อโฟลเดอร์ &ldquo;{renameFolder?.name}&rdquo;</DialogDescription>
          </DialogHeader>
          <form id="folder-rename-form" onSubmit={handleRename} className="grid gap-4 py-2">
            <Field label="ชื่อโฟลเดอร์" required>
              {(props) => (
                <Input
                  {...props}
                  autoFocus
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                />
              )}
            </Field>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameFolder(null)} disabled={renameLoading}>
              ยกเลิก
            </Button>
            <Button type="submit" form="folder-rename-form" loading={renameLoading}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={Boolean(deleteFolder)}
        onOpenChange={(open) => { if (!open) setDeleteFolder(null); }}
        title="ลบโฟลเดอร์?"
        description={`โฟลเดอร์ "${deleteFolder?.name}" จะถูกลบ รายการในโฟลเดอร์จะยังคงอยู่ในคลัง`}
        confirmLabel="ลบโฟลเดอร์"
        cancelLabel="ยกเลิก"
        loading={deleteLoading}
        onConfirm={handleDelete}
      />
    </nav>
  );
}

export default FolderPanel;
