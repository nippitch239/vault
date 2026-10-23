import React, { useState, useEffect } from 'react';
import api from '../../services/api.js';
import { RefreshIcon } from '../Common/Icons.jsx';

export function UserActivityLogView() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterAction, setFilterAction] = useState('');

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.logs.getUserActivityLogs({
        action: filterAction || undefined,
        limit: 50,
      });
      setLogs(res?.data || []);
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดประวัติกิจกรรมได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [filterAction]);

  const getActionBadgeColor = (action) => {
    switch (action) {
      case 'LOGIN_SUCCESS':
      case 'LOGIN_MFA_SUCCESS':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40';
      case 'PASSWORD_CREATE':
        return 'bg-blue-950/80 text-blue-300 border-blue-500/40';
      case 'PASSWORD_UPDATE':
        return 'bg-purple-950/80 text-purple-300 border-purple-500/40';
      case 'PASSWORD_DELETE':
        return 'bg-rose-950/80 text-rose-300 border-rose-500/40';
      case 'PASSWORD_SHARE':
        return 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40';
      case 'MFA_ENABLED':
        return 'bg-amber-950/80 text-amber-300 border-amber-500/40';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">บันทึกกิจกรรมของฉัน (UC-12)</h1>
          <p className="text-sm text-slate-400 mt-1">
            ประวัติการเข้าใช้งาน การจัดการรหัสผ่าน และเหตุการณ์ความปลอดภัยของบัญชีคุณ
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 text-xs focus:ring-emerald-500"
          >
            <option value="">ทุกประเภทกิจกรรม (All Actions)</option>
            <option value="LOGIN_SUCCESS">เข้าสู่ระบบสำเร็จ (Login)</option>
            <option value="PASSWORD_CREATE">เพิ่มรหัสผ่าน (Create)</option>
            <option value="PASSWORD_UPDATE">แก้ไขรหัสผ่าน (Update)</option>
            <option value="PASSWORD_DELETE">ลบรหัสผ่าน (Delete)</option>
            <option value="PASSWORD_SHARE">แชร์รหัสผ่าน (Share)</option>
            <option value="MFA_ENABLED">เปิดใช้งาน MFA</option>
          </select>

          <button
            type="button"
            onClick={loadLogs}
            disabled={loading}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl transition-colors"
            title="รีเฟรช"
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

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลดประวัติกิจกรรม...</div>
      ) : logs.length === 0 ? (
        <div className="py-16 text-center bg-slate-800/40 border border-slate-700/50 rounded-3xl p-8 text-slate-400 text-sm">
          ไม่มีข้อมูลกิจกรรมของบัญชีนี้ (No activity records found)
        </div>
      ) : (
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">วันที่ / เวลา</th>
                  <th className="py-3.5 px-4">ประเภทกิจกรรม</th>
                  <th className="py-3.5 px-4">IP Address</th>
                  <th className="py-3.5 px-4">รายละเอียด</th>
                  <th className="py-3.5 px-4">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50 font-mono">
                {logs.map((log) => {
                  let detailsText = '';
                  if (typeof log.details === 'object' && log.details !== null) {
                    detailsText = JSON.stringify(log.details);
                  } else {
                    detailsText = log.details || '-';
                  }

                  return (
                    <tr key={log.log_id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                        {new Date(log.created_at).toLocaleString('th-TH')}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-1 rounded-md border font-sans font-bold text-[11px] ${getActionBadgeColor(
                            log.action_type
                          )}`}
                        >
                          {log.action_type}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                        {log.ip_address || '127.0.0.1'}
                      </td>
                      <td className="py-3.5 px-4 font-sans text-slate-300 max-w-xs truncate" title={detailsText}>
                        {detailsText}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap font-sans">
                        <span className="text-emerald-400 font-semibold">{log.status || 'SUCCESS'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserActivityLogView;
