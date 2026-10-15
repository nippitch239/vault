import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api.js';
import { RefreshIcon, ShieldIcon } from '../Common/Icons.jsx';
import { Button, Badge, Card, Alert, Skeleton } from '../ui/index.js';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

const STATUS_TONE = {
  success: 'text-success-foreground',
  warning: 'text-warning-foreground',
  error: 'text-error-foreground',
  neutral: 'text-muted-foreground',
};

const formatNumber = (n, opts) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('th-TH', opts) : '—');

function formatUptime(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '—';
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} วัน ${hours} ชม.`;
  if (hours > 0) return `${hours} ชม. ${minutes} นาที`;
  return `${minutes} นาที`;
}

function KpiCard({ label, value, unit, note, tone = 'neutral', noteLabel }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="text-2xl font-strong tracking-tight tabular-nums text-foreground">
        {value}
        {unit && <span className="ml-1 text-sm font-ui text-muted-foreground">{unit}</span>}
      </p>
      {note && (
        <p className={cn('text-caption', STATUS_TONE[tone])}>
          {noteLabel && <span className="sr-only">{noteLabel}: </span>}
          {note}
        </p>
      )}
    </Card>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-ui text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

export function MonitoringDashboardView() {
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [metricsError, setMetricsError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, metricsRes] = await Promise.all([
        api.monitoring.getHealth().catch((e) => ({ status: 'degraded', database: e.message })),
        api.monitoring.getMetrics().catch((e) => ({ data: null, error: e.message })),
      ]);

      setHealth(healthRes);
      setMetricsError(metricsRes?.error || null);
      const rawMetrics = metricsRes?.metrics || metricsRes?.data || metricsRes || {};
      const normalized = {
        uptime_seconds: rawMetrics?.uptime_seconds ?? 0,
        requests: {
          total: rawMetrics?.request_statistics?.total_requests_24h ?? rawMetrics?.requests?.total ?? 0,
          errors: rawMetrics?.requests?.errors ?? 0,
          error_rate_percent: rawMetrics?.request_statistics?.error_rate_percentage ?? rawMetrics?.requests?.error_rate_percent ?? 0,
          avg_latency_ms: rawMetrics?.request_statistics?.p95_latency_ms ?? rawMetrics?.requests?.avg_latency_ms ?? 0,
        },
        mfa_adoption_percent: rawMetrics?.security_indicators?.mfa_adoption_percentage ?? rawMetrics?.mfa_adoption_percent ?? 0,
        database: {
          total_users: rawMetrics?.inventory?.total_users ?? rawMetrics?.database?.total_users ?? 0,
          mfa_users: rawMetrics?.database?.mfa_users ?? 0,
        },
        ...rawMetrics,
      };
      setMetrics(normalized);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || 'โหลดข้อมูลสถานะระบบไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const interval = setInterval(() => {
      loadData();
    }, 15000); // 15s interval
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  const status = health?.status;
  const statusInfo =
    status === 'healthy'
      ? { label: 'ทำงานปกติ', variant: 'success', tone: 'success' }
      : status
        ? { label: 'มีปัญหา', variant: 'destructive', tone: 'error' }
        : { label: 'ไม่ทราบสถานะ', variant: 'outline', tone: 'neutral' };
  const dbStatus = health?.database;
  const dbLabel = dbStatus === 'connected' ? 'เชื่อมต่อแล้ว' : dbStatus === 'disconnected' ? 'ไม่ได้เชื่อมต่อ' : dbStatus || '—';

  const errorRate = Number(metrics?.requests?.error_rate_percent ?? 0);
  const errorRateOk = errorRate < 1;
  const totalUsers = metrics?.inventory?.total_users ?? metrics?.database?.total_users ?? 0;
  // The backend reports these under `inventory` / `security_indicators`; older shapes under `database`.
  const totalItems = metrics?.inventory?.total_vault_items ?? metrics?.database?.total_vault_items ?? 0;
  const failedLogins = metrics?.security_indicators?.failed_logins_last_hour ?? metrics?.database?.failed_login_events ?? 0;
  const securityAlarms = metrics?.security_indicators?.active_security_alarms;

  const initialLoading = loading && !metrics;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">สถานะระบบ</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">ความพร้อมของระบบ ความเร็วในการตอบสนอง และตัวชี้วัดด้านความปลอดภัย</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="size-4 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            โหลดใหม่อัตโนมัติทุก 15 วินาที
          </label>
          <Button variant="outline" onClick={loadData} disabled={loading} className="w-full sm:w-auto">
            <RefreshIcon className={loading ? 'animate-spin' : ''} />
            โหลดใหม่
          </Button>
        </div>
      </header>

      <div aria-live="polite" className="space-y-4">
        {error && (
          <Alert
            variant="error"
            title="โหลดข้อมูลสถานะระบบไม่สำเร็จ"
            action={
              <Button variant="outline" size="sm" onClick={loadData}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {error}
          </Alert>
        )}
        {!error && metricsError && !loading && (
          <Alert
            variant="error"
            title="โหลดตัวชี้วัดไม่สำเร็จ ตัวเลขด้านล่างอาจไม่ถูกต้อง"
            action={
              <Button variant="outline" size="sm" onClick={loadData}>
                ลองอีกครั้ง
              </Button>
            }
          >
            {metricsError}
          </Alert>
        )}
      </div>

      <section aria-busy={loading} aria-label="ภาพรวม" className="space-y-6">
        {/* Health summary */}
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          {initialLoading ? (
            <div className="flex w-full items-center gap-4">
              <Skeleton className="size-10 shrink-0" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
              <span className="sr-only">กำลังโหลดสถานะระบบ</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div
                  className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary', STATUS_TONE[statusInfo.tone])}
                  aria-hidden="true"
                >
                  <ShieldIcon className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base">สถานะระบบ</h2>
                    <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    ฐานข้อมูล: <span className={dbStatus === 'connected' ? 'text-success-foreground' : 'text-error-foreground'}>{dbLabel}</span>
                    {health?.engine && <> · {health.engine}</>}
                    {health?.version && <> · เวอร์ชัน {health.version}</>}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-caption sm:text-right">
                <dt className="text-muted-foreground">ทำงานต่อเนื่อง</dt>
                <dd className="font-ui text-foreground">{formatUptime(metrics?.uptime_seconds)}</dd>
                <dt className="text-muted-foreground">อัปเดตล่าสุด</dt>
                <dd className="font-ui text-foreground">{lastUpdated ? lastUpdated.toLocaleTimeString('th-TH', { timeStyle: 'medium' }) : '—'}</dd>
              </dl>
            </>
          )}
        </Card>

        {/* KPI grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {initialLoading ? (
            [0, 1, 2, 3].map((i) => (
              <Card key={i} className="grid gap-2 p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-4 w-28" />
              </Card>
            ))
          ) : (
            <>
              <KpiCard label="คำขอทั้งหมด" value={formatNumber(metrics?.requests?.total)} unit="ครั้ง" note={`ผิดพลาด ${formatNumber(metrics?.requests?.errors)} ครั้ง`} />
              <KpiCard
                label="อัตราข้อผิดพลาด"
                value={formatNumber(errorRate, { maximumFractionDigits: 2 })}
                unit="%"
                tone={errorRateOk ? 'success' : 'warning'}
                noteLabel="สถานะ"
                note={errorRateOk ? 'อยู่ในเกณฑ์ (ต่ำกว่า 1%)' : 'สูงกว่าเกณฑ์ 1%'}
              />
              <KpiCard
                label="เวลาตอบสนอง (P95)"
                value={formatNumber(metrics?.requests?.avg_latency_ms, { maximumFractionDigits: 1 })}
                unit="มิลลิวินาที"
                note="95% ของคำขอเร็วกว่าค่านี้"
              />
              <KpiCard
                label="ผู้ใช้ที่เปิด 2FA"
                value={formatNumber(metrics?.mfa_adoption_percent, { maximumFractionDigits: 1 })}
                unit="%"
                note={`จากผู้ใช้ทั้งหมด ${formatNumber(totalUsers)} คน`}
              />
            </>
          )}
        </div>

        {/* Detail panels */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-sm">ข้อมูลในระบบ</h2>
            {initialLoading ? (
              <div className="mt-3 grid gap-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : (
              <dl className="mt-2 divide-y divide-border">
                <DetailRow label="ผู้ใช้ทั้งหมด">{formatNumber(totalUsers)} คน</DetailRow>
                <DetailRow label="รายการรหัสผ่านที่จัดเก็บ">{formatNumber(totalItems)} รายการ</DetailRow>
                {metrics?.active_db_connections != null && (
                  <DetailRow label="การเชื่อมต่อฐานข้อมูล">{formatNumber(metrics.active_db_connections)}</DetailRow>
                )}
              </dl>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm">ความปลอดภัย</h2>
            {initialLoading ? (
              <div className="mt-3 grid gap-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : (
              <dl className="mt-2 divide-y divide-border">
                <DetailRow label="การเข้าสู่ระบบที่ล้มเหลว">
                  <span className={Number(failedLogins) > 0 ? 'text-warning-foreground' : ''}>{formatNumber(failedLogins)} ครั้ง</span>
                </DetailRow>
                {securityAlarms != null && (
                  <DetailRow label="การแจ้งเตือนความปลอดภัยที่ยังเปิดอยู่">
                    <span className={Number(securityAlarms) > 0 ? 'text-error-foreground' : 'text-success-foreground'}>
                      {Number(securityAlarms) > 0 ? `${formatNumber(securityAlarms)} รายการ` : 'ไม่มี'}
                    </span>
                  </DetailRow>
                )}
                <DetailRow label="ผู้ใช้ที่เปิด 2FA">{formatNumber(metrics?.mfa_adoption_percent, { maximumFractionDigits: 1 })}%</DetailRow>
              </dl>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

export default MonitoringDashboardView;
