import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api.js';
import { RefreshIcon, DownloadIcon, HistoryIcon, SearchIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import {
  Button,
  Badge,
  Label,
  Select,
  Alert,
  Skeleton,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../ui/index.js';

const PAGE_SIZE = 50;

export const ACTIVITY_LABELS = {
  LOGIN_SUCCESS: 'เข้าสู่ระบบ',
  LOGIN_MFA_SUCCESS: 'เข้าสู่ระบบด้วย 2FA',
  PASSWORD_CREATE: 'เพิ่มรายการ',
  PASSWORD_UPDATE: 'แก้ไขรายการ',
  PASSWORD_DELETE: 'ลบรายการ',
  PASSWORD_RESTORE: 'กู้คืนรายการ',
  PASSWORD_SHARE: 'แชร์รายการ',
  PASSWORD_SHARE_REVOKED: 'ยกเลิกการแชร์',
  MFA_ENABLED: 'เปิดการยืนยันตัวตนสองขั้นตอน',
  MFA_DISABLED: 'ปิดการยืนยันตัวตนสองขั้นตอน',
  MASTER_PASSWORD_CHANGED: 'เปลี่ยนรหัสผ่านหลัก',
  MASTER_PASSWORD_RESET: 'รีเซ็ตรหัสผ่านหลัก',
};

const ACTIVITY_BADGE = {
  PASSWORD_DELETE: 'destructive',
  PASSWORD_SHARE_REVOKED: 'warning',
  MFA_DISABLED: 'warning',
  MASTER_PASSWORD_RESET: 'warning',
  PASSWORD_CREATE: 'info',
  PASSWORD_SHARE: 'info',
};

// Options offered in the filter (values are sent to the API as-is).
const FILTER_ACTIONS = ['LOGIN_SUCCESS', 'PASSWORD_CREATE', 'PASSWORD_UPDATE', 'PASSWORD_DELETE', 'PASSWORD_SHARE', 'MFA_ENABLED'];

const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const isFailure = (status) => /fail|error|denied/i.test(String(status || ''));

const detailsText = (details) => {
  if (details && typeof details === 'object') return JSON.stringify(details);
  return details || '—';
};

// Neutralise spreadsheet formulas (=, +, -, @) and quote every cell.
const csvCell = (value) => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function UserActivityLogView() {
  const { addToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterAction, setFilterAction] = useState('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.logs.getUserActivityLogs({
        action: filterAction || undefined,
        limit: PAGE_SIZE,
        offset: page > 0 ? page * PAGE_SIZE : undefined,
      });
      setLogs(res?.data || []);
    } catch (err) {
      setError(err.message || 'โหลดกิจกรรมไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, [filterAction, page]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const changeFilter = (value) => {
    setFilterAction(value);
    setPage(0);
  };

  // The API returns no total, so a full page means there may be more.
  const hasNext = logs.length === PAGE_SIZE;

  const handleExportCsv = () => {
    if (logs.length === 0) return;
    setExporting(true);
    try {
      const header = ['วันที่และเวลา', 'กิจกรรม', 'รหัสกิจกรรม', 'IP', 'สถานะ', 'รายละเอียด'];
      const rows = logs.map((log) => [
        formatDateTime(log.created_at),
        ACTIVITY_LABELS[log.action_type] || log.action_type,
        log.action_type,
        log.ip_address || '',
        isFailure(log.status) ? 'ไม่สำเร็จ' : 'สำเร็จ',
        detailsText(log.details),
      ]);
      const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `securevault_activity_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast(`ส่งออก ${logs.length.toLocaleString('th-TH')} รายการเป็น CSV แล้ว`, 'success');
    } catch {
      addToast('ส่งออก CSV ไม่สำเร็จ ลองอีกครั้ง', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">กิจกรรมของฉัน</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            ประวัติการเข้าสู่ระบบ การจัดการรายการ และเหตุการณ์ด้านความปลอดภัยของบัญชีคุณ
          </p>
        </div>
        <Button variant="outline" onClick={handleExportCsv} loading={exporting} disabled={loading || logs.length === 0} className="w-full sm:w-auto">
          {!exporting && <DownloadIcon />}
          ส่งออก CSV
        </Button>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end">
        <div className="grid gap-1.5 sm:w-72">
          <Label htmlFor="activity-filter-action">ประเภทกิจกรรม</Label>
          <Select id="activity-filter-action" value={filterAction} onChange={(e) => changeFilter(e.target.value)}>
            <option value="">ทุกประเภท</option>
            {FILTER_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTIVITY_LABELS[a]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          {filterAction && (
            <Button variant="ghost" onClick={() => changeFilter('')} className="flex-1 sm:flex-none">
              ล้างตัวกรอง
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={loadLogs} disabled={loading} aria-label="โหลดกิจกรรมใหม่">
            <RefreshIcon className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      <section aria-live="polite" aria-busy={loading} className="space-y-3">
        {loading ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
            <span className="sr-only">กำลังโหลดกิจกรรม</span>
          </div>
        ) : error ? (
          <Alert
            variant="error"
            title="โหลดกิจกรรมไม่สำเร็จ"
            action={
              <Button variant="outline" size="sm" onClick={loadLogs}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {error}
          </Alert>
        ) : logs.length === 0 ? (
          filterAction || page > 0 ? (
            <EmptyState
              icon={<SearchIcon className="size-5" />}
              title="ไม่พบข้อมูลตามเงื่อนไขที่เลือก"
              description="ลองเปลี่ยนประเภทกิจกรรม หรือล้างตัวกรองเพื่อดูทั้งหมด"
              action={
                <Button variant="outline" onClick={() => changeFilter('')}>
                  ล้างตัวกรอง
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<HistoryIcon className="size-5" />}
              title="ยังไม่มีกิจกรรม"
              description="เมื่อคุณเข้าสู่ระบบหรือจัดการรายการในคลัง กิจกรรมจะถูกบันทึกไว้ที่นี่"
            />
          )
        ) : (
          <>
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">วันที่และเวลา</TableHead>
                  <TableHead scope="col">กิจกรรม</TableHead>
                  <TableHead scope="col">IP</TableHead>
                  <TableHead scope="col">สถานะ</TableHead>
                  <TableHead scope="col">รายละเอียด</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const text = detailsText(log.details);
                  const failed = isFailure(log.status);
                  return (
                    <TableRow key={log.log_id}>
                      <TableCell className="whitespace-nowrap px-4 py-3 text-secondary-foreground">{formatDateTime(log.created_at)}</TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3">
                        <Badge variant={ACTIVITY_BADGE[log.action_type] || 'secondary'} title={log.action_type}>
                          {ACTIVITY_LABELS[log.action_type] || log.action_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted-foreground">{log.ip_address || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3">
                        <Badge variant={failed ? 'destructive' : 'success'}>{failed ? 'ไม่สำเร็จ' : 'สำเร็จ'}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate px-4 py-3 font-mono text-caption text-muted-foreground" title={text}>
                        {text}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <nav aria-label="เปลี่ยนหน้ากิจกรรม" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-caption text-muted-foreground">
                หน้า {(page + 1).toLocaleString('th-TH')} · รายการที่ {(page * PAGE_SIZE + 1).toLocaleString('th-TH')}–
                {(page * PAGE_SIZE + logs.length).toLocaleString('th-TH')}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="หน้าก่อนหน้า" className="flex-1 sm:flex-none">
                  ก่อนหน้า
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!hasNext} aria-label="หน้าถัดไป" className="flex-1 sm:flex-none">
                  ถัดไป
                </Button>
              </div>
            </nav>
          </>
        )}
      </section>
    </div>
  );
}

export default UserActivityLogView;
