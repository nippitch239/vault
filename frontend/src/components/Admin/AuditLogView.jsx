import React, { useState, useEffect } from 'react';
import api from '../../services/api.js';
import { DownloadIcon, RefreshIcon, ChartBarIcon } from '../Common/Icons.jsx';
import { useToast } from '../Common/Toast.jsx';

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
  const [exporting, setExporting] = useState(false);

  const loadAuditLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {
        action: action || undefined,
        severity: severity || undefined,
        userId: searchActor.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit: 50,
      };

      const res = await api.logs.getAdminAuditLogs(filters);
      setLogs(res?.data || []);
      setTotalCount(res?.pagination?.total || (res?.data || []).length);
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลดบันทึกการตรวจสอบได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, [action, severity, startDate, endDate]);

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
      addToast('ส่งออกรายงาน CSV สำเร็จ!', 'success');
    } catch (err) {
      addToast(err.message || 'ส่งออกไฟล์ CSV ไม่สำเร็จ', 'error');
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
      addToast('ส่งออกรายงาน JSON สำเร็จ!', 'success');
    } catch {
      addToast('ส่งออกไฟล์ JSON ไม่สำเร็จ', 'error');
    }
  };

  const getSeverityBadge = (sev) => {
    switch (sev) {
      case 'CRITICAL':
        return 'bg-rose-950/80 text-rose-300 border-rose-500/50';
      case 'WARNING':
        return 'bg-amber-950/80 text-amber-300 border-amber-500/50';
      default:
        return 'bg-blue-950/80 text-blue-300 border-blue-500/50';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2.5">
            <ChartBarIcon className="w-7 h-7 text-purple-400" />
            <span>บันทึกการตรวจสอบระบบ (UC-9 Admin Audit Logs)</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            บันทึกการใช้งานและเหตุการณ์ความปลอดภัยส่วนกลาง ตรวจสอบและส่งออกรายงาน CSV/JSON
          </p>
        </div>

        <div className="flex items-center space-x-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exporting}
            className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 rounded-xl text-xs font-medium transition-all flex items-center space-x-1.5"
          >
            <DownloadIcon className="w-4 h-4" />
            <span>{exporting ? 'กำลังส่งออก...' : 'Export CSV'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            className="px-3 py-2 bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/40 rounded-xl text-xs font-medium transition-all flex items-center space-x-1.5"
          >
            <DownloadIcon className="w-4 h-4" />
            <span>Export JSON</span>
          </button>

          <button
            type="button"
            onClick={loadAuditLogs}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl transition-colors"
            title="รีเฟรช"
          >
            <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin text-purple-400' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-2xl text-rose-200 text-sm">
          {error}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-slate-800/80 p-4 rounded-2xl border border-slate-700/80 text-xs">
        <div>
          <label className="block text-slate-400 mb-1 font-semibold uppercase tracking-wider">ประเภทกิจกรรม (Action)</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:ring-purple-500"
          >
            <option value="">ทุกประเภท (All Actions)</option>
            <option value="USER_REGISTERED">USER_REGISTERED</option>
            <option value="LOGIN_SUCCESS">LOGIN_SUCCESS</option>
            <option value="PASSWORD_DELETE">PASSWORD_DELETE</option>
            <option value="PASSWORD_RESET_REQUESTED">PASSWORD_RESET_REQUESTED</option>
            <option value="BRUTE_FORCE_DETECTED">BRUTE_FORCE_DETECTED</option>
          </select>
        </div>

        <div>
          <label className="block text-slate-400 mb-1 font-semibold uppercase tracking-wider">ระดับความรุนแรง (Severity)</label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:ring-purple-500"
          >
            <option value="">ทุกระดับ (All Severities)</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>

        <div>
          <label className="block text-slate-400 mb-1 font-semibold uppercase tracking-wider">ตั้งแต่วันที่ (Start Date)</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-slate-400 mb-1 font-semibold uppercase tracking-wider">ถึงวันที่ (End Date)</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:ring-purple-500"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลดบันทึกการตรวจสอบ...</div>
      ) : logs.length === 0 ? (
        <div className="py-16 text-center bg-slate-800/40 border border-slate-700/50 rounded-3xl p-8 text-slate-400 text-sm">
          ไม่พบข้อมูลตามเงื่อนไขที่ระบุ (No audit logs matching filters)
        </div>
      ) : (
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700">
                <tr>
                  <th className="py-3.5 px-4">Timestamp</th>
                  <th className="py-3.5 px-4">Event Action</th>
                  <th className="py-3.5 px-4">Severity</th>
                  <th className="py-3.5 px-4">Actor / Role</th>
                  <th className="py-3.5 px-4">Target Resource</th>
                  <th className="py-3.5 px-4">IP Address</th>
                  <th className="py-3.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50 font-mono">
                {logs.map((log) => (
                  <tr key={log.audit_id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                      {new Date(log.created_at).toLocaleString('th-TH')}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap font-bold text-slate-100">
                      {log.event_action}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${getSeverityBadge(log.event_severity)}`}>
                        {log.event_severity || 'INFO'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-300 font-sans">
                      {log.actor_role || 'system'}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                      {log.target_resource || '-'}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                      {log.ip_address || '127.0.0.1'}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="text-emerald-400 font-semibold">{log.status || 'SUCCESS'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="py-3 px-4 bg-slate-900/60 border-t border-slate-700 text-xs text-slate-400 flex justify-between items-center">
            <span>แสดง {logs.length} รายการ จากทั้งหมด {totalCount} รายการ</span>
            <span className="font-mono">Centralized Observability</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default AuditLogView;
