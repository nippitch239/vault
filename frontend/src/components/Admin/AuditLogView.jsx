import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api.js';
import { DownloadIcon, RefreshIcon, ChartBarIcon, SearchIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';
import {
  Button,
  Badge,
  Input,
  Select,
  Field,
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

export const AUDIT_ACTION_LABELS = {
  USER_REGISTERED: 'สมัครสมาชิก',
  LOGIN_SUCCESS: 'เข้าสู่ระบบ',
  PASSWORD_DELETE: 'ลบรายการ',
  PASSWORD_RESET_REQUESTED: 'ขอรีเซ็ตรหัสผ่านหลัก',
  BRUTE_FORCE_DETECTED: 'ตรวจพบการเดารหัสผ่านซ้ำ',
  GROUP_CREATED: 'สร้างกลุ่ม',
  COLLECTION_CREATED: 'สร้างคอลเลกชัน',
  COLLECTION_UPDATED: 'แก้ไขคอลเลกชัน',
  COLLECTION_DELETED: 'ลบคอลเลกชัน',
  COLLECTION_ACCESS_GRANTED: 'ให้สิทธิ์คอลเลกชัน',
  COLLECTION_ACCESS_REVOKED: 'เพิกถอนสิทธิ์คอลเลกชัน',
  COLLECTION_KEY_DISTRIBUTED: 'ส่งคีย์คอลเลกชัน',
  COLLECTION_ITEM_ADDED: 'เพิ่มรายการในคอลเลกชัน',
  COLLECTION_ITEM_REMOVED: 'นำรายการออกจากคอลเลกชัน',
};

// Options offered in the filter (values are sent to the API as-is).
const FILTER_ACTIONS = ['USER_REGISTERED', 'LOGIN_SUCCESS', 'PASSWORD_DELETE', 'PASSWORD_RESET_REQUESTED', 'BRUTE_FORCE_DETECTED'];

const SEVERITY = {
  INFO: { label: 'ทั่วไป', variant: 'info' },
  WARNING: { label: 'เฝ้าระวัง', variant: 'warning' },
  CRITICAL: { label: 'ร้ายแรง', variant: 'destructive' },
};

const ACTOR_ROLE_LABELS = { admin: 'ผู้ดูแลระบบ', user: 'ผู้ใช้', system: 'ระบบ' };

const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const isFailure = (status) => /fail|error|denied/i.test(String(status || ''));

export function AuditLogView() {
  const { addToast } = useToast();

  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [action, setAction] = useState('');
  const [severity, setSeverity] = useState('');
  const [searchActor] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const rangeError = startDate && endDate && startDate > endDate ? 'วันที่สิ้นสุดต้องไม่อยู่ก่อนวันที่เริ่มต้น' : null;
  const hasFilters = Boolean(action || severity || startDate || endDate);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {
        action: action || undefined,
        severity: severity || undefined,
        userId: searchActor.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit: PAGE_SIZE,
        offset: page > 0 ? page * PAGE_SIZE : undefined,
      };

      const res = await api.logs.getAdminAuditLogs(filters);
      setLogs(res?.data || []);
      setTotalCount(res?.pagination?.total || (res?.data || []).length);
    } catch (err) {
      setError(err.message || 'โหลดบันทึกการตรวจสอบไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, [action, severity, searchActor, startDate, endDate, page]);

  useEffect(() => {
    if (rangeError) return;
    loadAuditLogs();
  }, [loadAuditLogs, rangeError]);

  const updateFilter = (setter) => (e) => {
    setter(e.target.value);
    setPage(0);
  };

  const clearFilters = () => {
    setAction('');
    setSeverity('');
    setStartDate('');
    setEndDate('');
    setPage(0);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const filters = {
        action: action || undefined,
        severity: severity || undefined,
        userId: searchActor.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };

      // The backend returns every matching row for CSV (up to 10,000).
      const csvData = await api.logs.exportAuditLogsCsv(filters);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `securevault_audit_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast('ส่งออกไฟล์ CSV แล้ว', 'success');
    } catch (err) {
      addToast(err.message || 'ส่งออก CSV ไม่สำเร็จ ลองอีกครั้ง', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportJson = () => {
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = `securevault_audit_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      addToast('ส่งออกไฟล์ JSON แล้ว', 'success');
    } catch {
      addToast('ส่งออก JSON ไม่สำเร็จ ลองอีกครั้ง', 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstRow = page * PAGE_SIZE + 1;
  const lastRow = page * PAGE_SIZE + logs.length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">บันทึกการตรวจสอบ</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            เหตุการณ์สำคัญและเหตุการณ์ด้านความปลอดภัยของทั้งระบบ กรองตามเงื่อนไขและส่งออกเป็นรายงานได้
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={handleExportCsv} loading={exporting} disabled={loading} className="w-full sm:w-auto">
            {!exporting && <DownloadIcon />}
            ส่งออก CSV
          </Button>
          <Button variant="outline" onClick={handleExportJson} disabled={loading || logs.length === 0} className="w-full sm:w-auto">
            <DownloadIcon />
            ส่งออก JSON
          </Button>
        </div>
      </header>

      {/* Filter toolbar */}
      <section aria-label="ตัวกรอง" className="grid gap-4 rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="ประเภทกิจกรรม">
            {(props) => (
              <Select {...props} value={action} onChange={updateFilter(setAction)}>
                <option value="">ทุกประเภท</option>
                {FILTER_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {AUDIT_ACTION_LABELS[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="ระดับความรุนแรง">
            {(props) => (
              <Select {...props} value={severity} onChange={updateFilter(setSeverity)}>
                <option value="">ทุกระดับ</option>
                {Object.entries(SEVERITY).map(([value, s]) => (
                  <option key={value} value={value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="ตั้งแต่วันที่">
            {(props) => <Input {...props} type="date" value={startDate} max={endDate || undefined} onChange={updateFilter(setStartDate)} />}
          </Field>
          <Field label="ถึงวันที่" error={rangeError}>
            {(props) => <Input {...props} type="date" value={endDate} min={startDate || undefined} onChange={updateFilter(setEndDate)} />}
          </Field>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              ล้างตัวกรอง
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={loadAuditLogs} disabled={loading || Boolean(rangeError)}>
            <RefreshIcon className={loading ? 'animate-spin' : ''} />
            โหลดใหม่
          </Button>
        </div>
      </section>

      <section aria-live="polite" aria-busy={loading} className="space-y-3">
        {rangeError ? (
          <Alert variant="warning" title="ช่วงวันที่ไม่ถูกต้อง">
            แก้ไขวันที่ในตัวกรองแล้วระบบจะโหลดข้อมูลให้อัตโนมัติ
          </Alert>
        ) : loading ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
            <span className="sr-only">กำลังโหลดบันทึกการตรวจสอบ</span>
          </div>
        ) : error ? (
          <Alert
            variant="error"
            title="โหลดบันทึกการตรวจสอบไม่สำเร็จ"
            action={
              <Button variant="outline" size="sm" onClick={loadAuditLogs}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {error}
          </Alert>
        ) : logs.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={<SearchIcon className="size-5" />}
              title="ไม่พบข้อมูลตามเงื่อนไขที่เลือก"
              description="ลองขยายช่วงวันที่หรือเปลี่ยนประเภทกิจกรรม"
              action={
                <Button variant="outline" onClick={clearFilters}>
                  ล้างตัวกรอง
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ChartBarIcon className="size-5" />}
              title="ยังไม่มีบันทึกการตรวจสอบ"
              description="เหตุการณ์จะถูกบันทึกเมื่อมีการสมัครสมาชิก เข้าสู่ระบบ หรือเปลี่ยนแปลงสิทธิ์"
              action={
                <Button variant="outline" onClick={loadAuditLogs}>
                  <RefreshIcon />
                  โหลดใหม่
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">วันที่และเวลา</TableHead>
                  <TableHead scope="col">กิจกรรม</TableHead>
                  <TableHead scope="col">ความรุนแรง</TableHead>
                  <TableHead scope="col">ผู้กระทำ</TableHead>
                  <TableHead scope="col">ทรัพยากร</TableHead>
                  <TableHead scope="col">IP</TableHead>
                  <TableHead scope="col">สถานะ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const sev = SEVERITY[String(log.event_severity || 'INFO').toUpperCase()] || SEVERITY.INFO;
                  const role = String(log.actor_role || 'system').toLowerCase();
                  const failed = isFailure(log.status);
                  return (
                    <TableRow key={log.audit_id}>
                      <TableCell className="whitespace-nowrap px-4 py-3 text-secondary-foreground">{formatDateTime(log.created_at)}</TableCell>
                      <TableCell className="px-4 py-3">
                        <p className="font-ui text-foreground">{AUDIT_ACTION_LABELS[log.event_action] || log.event_action}</p>
                        {AUDIT_ACTION_LABELS[log.event_action] && (
                          <p className="font-mono text-xs text-muted-foreground">{log.event_action}</p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3">
                        <Badge variant={sev.variant}>{sev.label}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3 text-secondary-foreground">{ACTOR_ROLE_LABELS[role] || log.actor_role}</TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted-foreground">{log.target_resource || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted-foreground">{log.ip_address || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3">
                        <Badge variant={failed ? 'destructive' : 'success'}>{failed ? 'ไม่สำเร็จ' : 'สำเร็จ'}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <nav aria-label="เปลี่ยนหน้าบันทึกการตรวจสอบ" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-caption text-muted-foreground">
                แสดง {firstRow.toLocaleString('th-TH')}–{lastRow.toLocaleString('th-TH')} จาก {totalCount.toLocaleString('th-TH')} รายการ · หน้า{' '}
                {(page + 1).toLocaleString('th-TH')}/{totalPages.toLocaleString('th-TH')}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="หน้าก่อนหน้า" className="flex-1 sm:flex-none">
                  ก่อนหน้า
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages} aria-label="หน้าถัดไป" className="flex-1 sm:flex-none">
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

export default AuditLogView;
