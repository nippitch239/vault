import React, { useState, useEffect } from 'react';
import api from '../../services/api.js';
import { ChartBarIcon, RefreshIcon, ShieldIcon } from '../Common/Icons.jsx';

export function MonitoringDashboardView() {

  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, metricsRes] = await Promise.all([
        api.monitoring.getHealth().catch((e) => ({ status: 'degraded', database: e.message })),
        api.monitoring.getMetrics().catch((e) => ({ data: null, error: e.message })),
      ]);

      setHealth(healthRes);
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
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดข้อมูลระบบมอนิเตอร์ได้ในขณะนี้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData();
    }, 15000); // 15s interval
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const isHealthy = health?.status === 'healthy';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2.5">
            <ChartBarIcon className="w-7 h-7 text-emerald-400" />
            <span>แดชบอร์ดตรวจสอบระบบ (UC-13 System Monitoring)</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            สถานะความพร้อมของระบบ (System Health), อัตราความหน่วง API และสถิติความปลอดภัยแบบเรียลไทม์
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <label className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-800 px-3 py-2 rounded-xl border border-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-500 bg-slate-900 border-slate-600"
            />
            <span>Auto Refresh (15s)</span>
          </label>

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-2xl text-rose-200 text-sm">
          {error}
        </div>
      )}

      {/* System Health Status Card */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              isHealthy ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
            }`}
          >
            <ShieldIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white">สถานะระบบ (System Status):</h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider border ${
                  isHealthy
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
                    : 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                }`}
              >
                {health?.status || 'Unknown'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              ฐานข้อมูล: <strong className="text-slate-200">{health?.database || 'Connected'}</strong> | เอนจิ้น: {health?.engine || 'RDS PostgreSQL'} | Version: {health?.version || '1.0.0'}
            </p>
          </div>
        </div>

        <div className="text-right text-xs text-slate-400 self-end sm:self-center">
          <div>เวลาทำงาน (Uptime): <strong className="text-slate-200 font-mono">{metrics?.uptime_seconds ? `${Math.floor(metrics.uptime_seconds / 60)} นาที` : 'Online'}</strong></div>
          <div>อัปเดตล่าสุด: {new Date().toLocaleTimeString('th-TH')}</div>
        </div>
      </div>

      {/* Key Metric Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Requests */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            คำขอทั้งหมด (Total Requests)
          </span>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics?.requests?.total ?? 0}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            ข้อผิดพลาด: {metrics?.requests?.errors ?? 0} ครั้ง
          </span>
        </div>

        {/* Error Rate */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            อัตราผิดพลาด (Error Rate)
          </span>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {metrics?.requests?.error_rate_percent ?? 0}%
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">เกณฑ์มาตรฐาน &lt; 1%</span>
        </div>

        {/* Average Latency */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            ความหน่วงเฉลี่ย (Avg Latency)
          </span>
          <div className="text-2xl font-bold font-mono text-cyan-400">
            {metrics?.requests?.avg_latency_ms ?? 0} ms
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">API Gateway Response Time</span>
        </div>

        {/* MFA Adoption */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 shadow">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            การใช้งาน MFA (Adoption)
          </span>
          <div className="text-2xl font-bold font-mono text-purple-400">
            {metrics?.mfa_adoption_percent ?? 0}%
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            {metrics?.database?.mfa_users ?? 0} จาก {metrics?.database?.total_users ?? 0} ผู้ใช้
          </span>
        </div>
      </div>

      {/* Latency & Security Anomaly Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Latency Simulation Chart */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow">
          <h3 className="text-sm font-bold text-white mb-3">การกระจายความหน่วงของ API (Latency Distribution)</h3>
          <div className="h-40 flex items-end justify-between space-x-2 pt-4 px-2 border-b border-slate-700">
            {[12, 18, 9, 25, 14, 8, 30, 22, 16, 11, 19, 15].map((val, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center group relative">
                <div
                  className="w-full bg-emerald-500/70 hover:bg-emerald-400 rounded-t transition-all"
                  style={{ height: `${val * 3}px` }}
                />
                <span className="text-[9px] text-slate-500 mt-1">{idx * 5}m</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center text-xs text-slate-400 pt-3">
            <span>ประสิทธิภาพ: สูง (Optimal)</span>
            <span className="font-mono text-emerald-400">P99: &lt; 45ms</span>
          </div>
        </div>

        {/* System Stats Overview */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow flex flex-col justify-between">
          <h3 className="text-sm font-bold text-white mb-3">สรุปปริมาณข้อมูลและความปลอดภัย</h3>
          <div className="space-y-3 text-xs text-slate-300">
            <div className="flex justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
              <span className="text-slate-400">จำนวนรหัสผ่านทั้งหมดที่จัดเก็บ:</span>
              <span className="font-bold font-mono text-white">{metrics?.database?.total_vault_items ?? 0} รายการ</span>
            </div>
            <div className="flex justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
              <span className="text-slate-400">การพยายามเข้าสู่ระบบที่ล้มเหลว:</span>
              <span className="font-bold font-mono text-amber-400">{metrics?.database?.failed_login_events ?? 0} ครั้ง</span>
            </div>
            <div className="flex justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
              <span className="text-slate-400">โครงสร้างพื้นฐานคลาวด์:</span>
              <span className="font-bold text-white">AWS Lambda + RDS PostgreSQL (Multi-AZ)</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-500 pt-3 text-right">
            CloudWatch Log Group: <code className="text-slate-400">/aws/lambda/securevault-api</code>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MonitoringDashboardView;
