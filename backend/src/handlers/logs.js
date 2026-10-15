/**
 * Secure Vault Cloud — Logging & Security Alert Handlers (UC-8, UC-9, UC-12)
 *
 * Implements:
 * 1. UC-8: Security anomaly notifications & simulation (Admin only).
 * 2. UC-9: Centralized Admin audit logs with search, filtering, and JSON/CSV export (Admin only).
 * 3. UC-12: Personal user activity log.
 */

import { getDatabase } from '../db/adapter.js';
import { authenticate } from '../middleware/auth-guard.js';

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(data),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  if (typeof event.body === 'object') return event.body;
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

// In-memory security alerts store for simulated and detected events (UC-8)
const securityNotifications = [
  {
    notification_id: 'sec-001',
    severity: 'CRITICAL',
    type: 'UnauthorizedAccess:IAMUser/AnomalousBehavior',
    source: 'GuardDuty',
    description: 'Multiple failed logins from anomalous IP 198.51.100.42',
    timestamp: '2026-10-05T16:15:00Z',
    status: 'ACTIVE',
  },
];

// ============================================================================
// UC-8: Security Notifications (Admin)
// ============================================================================

/**
 * GET /api/v1/admin/security/notifications
 */
export async function getSecurityNotificationsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'admin');
  if (errorResponse) return errorResponse;

  const db = getDatabase();

  // Combine static/ingested alerts with critical audit logs
  const criticalAudit = await db.query(
    `SELECT audit_id, event_action, event_severity, ip_address, details, created_at
     FROM audit_logs
     WHERE event_severity IN ('WARNING', 'CRITICAL')
     ORDER BY created_at DESC
     LIMIT 20`
  );

  const dynamicAlerts = criticalAudit.rows.map((row) => ({
    notification_id: row.audit_id,
    severity: row.event_severity,
    type: row.event_action,
    source: 'AuditSystem',
    description: `Security event ${row.event_action} from IP ${row.ip_address}`,
    timestamp: row.created_at,
    status: 'ACTIVE',
  }));

  const allAlerts = [...dynamicAlerts, ...securityNotifications];

  return jsonResponse(200, {
    status: 'success',
    data: allAlerts,
  });
}

/**
 * POST /api/v1/admin/security/simulate-event
 * Ingest or simulate a security alarm / GuardDuty finding
 */
export async function simulateSecurityEventHandler(event) {
  const { user, errorResponse } = authenticate(event, 'admin');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const body = parseBody(event);

  const notificationId = `sec-${Date.now()}`;
  const severity = body.severity || 'CRITICAL';
  const type = body.type || 'AnomalousAccessDetected';
  const description = body.description || 'Simulated security event';
  const source = body.source || 'GuardDuty';

  const newAlert = {
    notification_id: notificationId,
    severity,
    type,
    source,
    description,
    timestamp: new Date().toISOString(),
    status: 'ACTIVE',
  };

  securityNotifications.unshift(newAlert);

  // Record in audit_logs
  await db.query(
    `INSERT INTO audit_logs (
      actor_user_id, actor_role, event_action, event_severity, target_resource, ip_address, status, details
    ) VALUES ($1, 'system', $2, $3, 'security_alarms', '127.0.0.1', 'SUCCESS', $4)`,
    [user.user_id, type, severity, { description, source }]
  );

  return jsonResponse(201, {
    status: 'success',
    message: 'Security event ingested successfully',
    data: newAlert,
  });
}

// ============================================================================
// UC-9: Admin Audit Logs (Admin)
// ============================================================================

/**
 * Helper to convert array of objects to CSV string
 */
function objectsToCsv(rows) {
  if (!rows || rows.length === 0) {
    return 'audit_id,created_at,actor_user_id,actor_role,event_action,event_severity,target_resource,ip_address,status\n';
  }
  const headers = [
    'audit_id',
    'created_at',
    'actor_user_id',
    'actor_role',
    'event_action',
    'event_severity',
    'target_resource',
    'ip_address',
    'status',
  ];
  const csvLines = [headers.join(',')];

  for (const row of rows) {
    const line = headers.map((field) => {
      const val = row[field] ?? '';
      const strVal = String(val).replace(/"/g, '""');
      return `"${strVal}"`;
    });
    csvLines.push(line.join(','));
  }
  return csvLines.join('\n');
}

/**
 * GET /api/v1/admin/audit-logs
 * Search, filter, and export centralized audit records
 */
export async function getAdminAuditLogsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'admin');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const query = event.queryStringParameters || {};

  const severity = query.severity;
  const action = query.action || query.event_action;
  const actorId = query.actor_id || query.userId;
  const startDate = query.start_date || query.startDate;
  const endDate = query.end_date || query.endDate;
  const format = (query.format || 'json').toLowerCase();

  const limit = Math.min(Math.max(parseInt(query.limit || '50', 10), 1), 500);
  const offset = Math.max(parseInt(query.offset || '0', 10), 0);

  const whereConditions = [];
  const params = [];

  if (severity) {
    params.push(severity.toUpperCase());
    whereConditions.push(`event_severity = $${params.length}`);
  }

  if (action) {
    params.push(action);
    whereConditions.push(`event_action = $${params.length}`);
  }

  if (actorId) {
    params.push(actorId);
    whereConditions.push(`actor_user_id = $${params.length}`);
  }

  if (startDate) {
    params.push(startDate);
    whereConditions.push(`created_at >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    whereConditions.push(`created_at <= $${params.length}`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await db.query(`SELECT COUNT(*) as count FROM audit_logs ${whereClause}`, params);
  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  // Fetch paginated rows
  const querySql = `
    SELECT audit_id, actor_user_id, actor_role, event_action, event_severity,
           target_resource, target_resource_id, ip_address, status, details, created_at
    FROM audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const queryParams = [...params, limit, offset];
  const result = await db.query(querySql, queryParams);

  // Handle CSV export
  if (format === 'csv') {
    const csvContent = objectsToCsv(result.rows);
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="audit_logs.csv"',
        'access-control-allow-origin': '*',
      },
      body: csvContent,
    };
  }

  // Handle JSON response
  return jsonResponse(200, {
    status: 'success',
    pagination: {
      total,
      limit,
      offset,
    },
    data: result.rows,
  });
}

// ============================================================================
// UC-12: User Activity Logs (User)
// ============================================================================

/**
 * GET /api/v1/user/activity-logs
 * Fetch authenticated user's personal activity trail
 */
export async function getUserActivityLogsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const query = event.queryStringParameters || {};
  const limit = Math.min(Math.max(parseInt(query.limit || '20', 10), 1), 100);
  const offset = Math.max(parseInt(query.offset || '0', 10), 0);
  const actionType = query.action_type || query.action;

  const whereConditions = ['user_id = $1'];
  const params = [user.user_id];

  if (actionType) {
    params.push(actionType);
    whereConditions.push(`action_type = $${params.length}`);
  }

  const querySql = `
    SELECT log_id, user_id, action_type, target_item_id, ip_address, user_agent, status, details, created_at
    FROM activity_logs
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const result = await db.query(querySql, [...params, limit, offset]);

  return jsonResponse(200, {
    status: 'success',
    data: result.rows,
  });
}
