import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { BellIcon, CloseIcon, ShieldIcon, RefreshIcon } from './Common/Icons.jsx';
import { useToast } from './Common/Toast.jsx';
import { Button } from './ui/Button.jsx';
import { Badge } from './ui/Badge.jsx';

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
      setError(err.message || 'ไม่สามารถโหลดการแจ้งเตือนความปลอดภัยได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadAlerts();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSimulateAlert = async () => {
    setSimulating(true);
    try {
      await api.logs.simulateSecurityEvent({
        type: 'UnauthorizedAccess:IAMUser/AnomalousBehavior',
        severity: 'CRITICAL',
        description: 'Simulated brute-force anomaly detected via GuardDuty / CloudWatch Alarm',
      });
      addToast('จำลองเหตุการณ์แจ้งเตือนความปลอดภัยสำเร็จ!', 'info');
      loadAlerts();
    } catch (err) {
      addToast(err.message || 'ไม่สามารถจำลองเหตุการณ์ได้', 'error');
    } finally {
      setSimulating(false);
    }
  };

  const getSeverityBadgeVariant = (sev) => {
    const s = (sev || 'INFO').toUpperCase();
    if (s === 'CRITICAL') return 'destructive';
    if (s === 'WARNING') return 'warning';
    return 'info';
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-background/80 backdrop-blur-sm animate-content-show"
    >
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-card text-card-foreground border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Fixed Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="size-10 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive shrink-0">
              <BellIcon className="size-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-foreground">
                ศูนย์แจ้งเตือนความปลอดภัย
              </h3>
              <p className="text-xs text-muted-foreground">
                การตรวจจับพฤติกรรมผิดปกติและการแจ้งเตือน (GuardDuty & Alerts)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring text-muted-foreground hover:text-foreground p-1"
            aria-label="Close"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {error && (
            <div className="p-3 bg-destructive/15 border border-destructive/30 rounded-lg text-destructive text-xs font-medium">
              {error}
            </div>
          )}

          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              รายการแจ้งเตือน ({alerts.length})
            </span>
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSimulateAlert}
                disabled={simulating}
                className="text-xs h-7 border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                {simulating ? 'กำลังจำลอง...' : '+ จำลองแจ้งเตือน (Simulate Event)'}
              </Button>
            )}
          </div>

          {loading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              กำลังโหลดการแจ้งเตือนความปลอดภัย...
            </div>
          ) : alerts.length === 0 ? (
            <div className="py-12 text-center bg-muted/30 rounded-xl border border-border text-muted-foreground text-sm">
              ระบบปลอดภัย ไม่พบกิจกรรมหรือพฤติกรรมที่น่าสงสัยในขณะนี้
            </div>
          ) : (
            alerts.map((al, idx) => (
              <div
                key={al.notification_id || idx}
                className="bg-card border border-border rounded-xl p-4 space-y-2 text-xs shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <Badge variant={getSeverityBadgeVariant(al.severity)} round={true}>
                    {al.severity || 'INFO'}
                  </Badge>
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {al.timestamp ? new Date(al.timestamp).toLocaleString('th-TH') : 'Just now'}
                  </span>
                </div>

                <div className="font-semibold text-foreground text-sm">
                  {al.type || al.title || 'Security Anomaly'}
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  {al.description || 'ตรวจพบความผิดปกติของการเข้าใช้งานระบบ'}
                </p>

                <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground border-t border-border">
                  <span>แหล่งที่มา: {al.source || 'CloudWatch/GuardDuty'}</span>
                  <span>สถานะ: {al.status || 'ACTIVE'}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Fixed Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-muted/30 flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            ปิดหน้าต่าง (Close)
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SecurityNotificationModal;
