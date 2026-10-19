import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import { useToast } from '../Common/Toast.jsx';
import {
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Alert,
  Skeleton,
  EmptyState,
} from '../ui/index.js';

function ShieldCheckIcon({ className = 'size-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const SEVERITY = {
  CRITICAL: { label: 'วิกฤต', variant: 'destructive' },
  HIGH: { label: 'สูง', variant: 'destructive' },
  WARNING: { label: 'คำเตือน', variant: 'warning' },
  MEDIUM: { label: 'ปานกลาง', variant: 'warning' },
  INFO: { label: 'ข้อมูล', variant: 'info' },
  LOW: { label: 'ต่ำ', variant: 'info' },
};

const STATUS_LABELS = {
  ACTIVE: 'ยังไม่ได้จัดการ',
  OPEN: 'ยังไม่ได้จัดการ',
  RESOLVED: 'จัดการแล้ว',
  ACKNOWLEDGED: 'รับทราบแล้ว',
};

const severityOf = (sev) => SEVERITY[(sev || 'INFO').toUpperCase()] || { label: sev, variant: 'info' };
const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : 'เมื่อสักครู่';

export function SecurityNotificationModal({ isOpen, onClose }) {
  const { isAdmin } = useAuth();
  const { addToast } = useToast();

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState(null);

  const loadAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.logs.getSecurityNotifications();
      setAlerts(res?.data || []);
    } catch (err) {
      setError(err.message || 'โหลดการแจ้งเตือนไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadAlerts();
    }
  }, [isOpen]);

  const handleSimulateAlert = async () => {
    setSimulating(true);
    try {
      await api.logs.simulateSecurityEvent({
        type: 'UnauthorizedAccess:IAMUser/AnomalousBehavior',
        severity: 'CRITICAL',
        description: 'Simulated brute-force anomaly detected via GuardDuty / CloudWatch Alarm',
      });
      addToast('จำลองเหตุการณ์ความปลอดภัยแล้ว', 'success');
      loadAlerts();
    } catch (err) {
      addToast(err.message || 'จำลองเหตุการณ์ไม่สำเร็จ ลองอีกครั้ง', 'error');
    } finally {
      setSimulating(false);
    }
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">กำลังโหลดการแจ้งเตือน</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <Alert
          variant="error"
          title="โหลดการแจ้งเตือนไม่สำเร็จ"
          action={
            <Button variant="outline" size="sm" onClick={loadAlerts}>
              ลองอีกครั้ง
            </Button>
          }
        >
          {error}
        </Alert>
      );
    }

    if (alerts.length === 0) {
      return (
        <EmptyState
          className="py-10"
          icon={<ShieldCheckIcon />}
          title="ไม่มีการแจ้งเตือนความปลอดภัย"
          description="ยังไม่พบกิจกรรมผิดปกติในบัญชีของคุณ ระบบจะแจ้งที่นี่ทันทีเมื่อพบสิ่งที่ควรตรวจสอบ"
          action={
            <Button variant="outline" size="sm" onClick={loadAlerts}>
              ตรวจสอบอีกครั้ง
            </Button>
          }
        />
      );
    }

    return (
      <ul className="space-y-2">
        {alerts.map((al, idx) => {
          const sev = severityOf(al.severity);
          const status = (al.status || 'ACTIVE').toUpperCase();
          return (
            <li key={al.notification_id || idx} className="space-y-2 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={sev.variant}>
                  <span className="sr-only">ระดับความรุนแรง: </span>
                  {sev.label}
                </Badge>
                <time dateTime={al.timestamp || undefined} className="text-xs text-muted-foreground">
                  {formatDateTime(al.timestamp)}
                </time>
              </div>

              <p className="break-words text-sm font-ui text-foreground">
                {al.title || al.type || 'พบกิจกรรมผิดปกติ'}
              </p>

              <p className="break-words text-sm text-muted-foreground">
                {al.description || 'ตรวจพบการเข้าใช้งานที่ผิดปกติ'}
              </p>

              <div className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted-foreground sm:flex-row sm:justify-between">
                <span className="break-words">แหล่งที่มา: {al.source || 'ระบบตรวจจับอัตโนมัติ'}</span>
                <span>สถานะ: {STATUS_LABELS[status] || al.status}</span>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Dialog open={!!isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>การแจ้งเตือนความปลอดภัย</DialogTitle>
          <DialogDescription>กิจกรรมผิดปกติที่ระบบตรวจพบในบัญชีและคลังรหัสผ่านของคุณ</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {loading ? 'กำลังโหลด…' : error ? '' : `ทั้งหมด ${alerts.length} รายการ`}
          </p>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSimulateAlert}
              loading={simulating}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {simulating ? 'กำลังจำลอง…' : 'จำลองเหตุการณ์'}
            </Button>
          )}
        </div>

        {renderBody()}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto" data-autofocus>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SecurityNotificationModal;
