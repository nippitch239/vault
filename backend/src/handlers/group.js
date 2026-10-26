/**
 * Secure Vault Cloud — User Groups & Membership Handlers (M3: R1)
 *
 * Implements:
 * 1. Group CRUD: createGroup, listGroups, getGroup, updateGroup, deleteGroup
 * 2. Group Membership: addGroupMember, listGroupMembers, removeGroupMember
 * 3. Cascade Cleanup: Application-level cascade purging polymorphic collection_access records
 * 4. Property Normalization: Dual camelCase & snake_case properties for API parity
 *
 * Ponytail minimalism: Native stdlib crypto & SQL parameterized queries.
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db/adapter.js';
import { authenticate, requireOrgRole } from '../middleware/auth-guard.js';
import { pruneKeysForGroup } from '../services/collection-service.js';
import { findUserByUsername } from '../services/user-directory.js';

const GROUP_ROLE_RANK = { member: 1, manager: 2, admin: 3 };

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

/**
 * Normalizes group database row into dual camelCase / snake_case representation
 */
export function formatGroup(row) {
  if (!row) return null;
  const id = row.group_id || row.id;
  const name = row.name;
  const description = row.description !== undefined ? row.description : null;
  const createdBy = row.created_by || row.createdBy;
  const createdAt = row.created_at || row.createdAt;
  const updatedAt = row.updated_at || row.updatedAt;
  const orgId = row.org_id || row.orgId || null;
  const memberCount = row.member_count !== undefined
    ? Number(row.member_count)
    : (row.memberCount !== undefined ? Number(row.memberCount) : 0);
  const obj = {
    id,
    group_id: id,
    name,
    description,
    createdBy,
    created_by: createdBy,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
  if (orgId !== null && orgId !== undefined) {
    obj.orgId = orgId;
    obj.org_id = orgId;
  }
  if (row.member_count !== undefined || row.memberCount !== undefined) {
    obj.memberCount = memberCount;
    obj.member_count = memberCount;
  }
  return obj;
}

/**
 * Normalizes group member row into dual camelCase / snake_case representation
 */
export function formatMember(row) {
  if (!row) return null;
  const id = row.group_member_id || row.id;
  const groupId = row.group_id || row.groupId;
  const userId = row.user_id || row.userId;
  const role = row.role;
  const createdAt = row.created_at || row.createdAt;
  const obj = {
    id,
    group_member_id: id,
    groupId,
    group_id: groupId,
    userId,
    user_id: userId,
    role,
    createdAt,
    created_at: createdAt,
  };
  if (row.username !== undefined) obj.username = row.username;
  if (row.email !== undefined) obj.email = row.email;
  if (row.public_key !== undefined) {
    obj.publicKey = row.public_key;
    obj.public_key = row.public_key;
  }
  if (row.full_name !== undefined) {
    obj.fullName = row.full_name;
    obj.full_name = row.full_name;
  }
  return obj;
}

async function recordAuditLog(db, { actorUserId, actorRole = 'user', eventAction, severity = 'INFO', targetResource = 'group', targetResourceId = null, details = {} }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, event_action, event_severity, target_resource, target_resource_id, ip_address, status, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [actorUserId || null, actorRole || 'user', eventAction, severity, targetResource, targetResourceId, '127.0.0.1', 'SUCCESS', details]
    );
  } catch {
    // Non-blocking
  }
}

// ============================================================================
// Group CRUD Handlers
// ============================================================================

/**
 * POST /api/v1/groups - Create a new user group
 */
export async function createGroupHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const body = parseBody(event);
  const name = body.name;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Group name is required',
    });
  }

  const db = getDatabase();
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();
  const trimmedName = name.trim();
  const description = body.description || null;

  await db.query(
    'INSERT INTO groups (group_id, name, description, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [groupId, trimmedName, description, user.user_id, now, now]
  );

  // Group creator is automatically assigned as group admin
  const memberId = crypto.randomUUID();
  await db.query(
    "INSERT INTO group_members (group_member_id, group_id, user_id, role, created_at) VALUES ($1, $2, $3, 'admin', $4)",
    [memberId, groupId, user.user_id, now]
  );

  await recordAuditLog(db, {
    actorUserId: user.user_id,
    actorRole: user.role,
    eventAction: 'GROUP_CREATED',
    targetResourceId: groupId,
    details: { name: trimmedName },
  });

  return jsonResponse(201, {
    status: 'success',
    success: true,
    group: formatGroup({
      group_id: groupId,
      name: trimmedName,
      description,
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
    }),
  });
}

/**
 * GET /api/v1/groups - List user groups
 */
export async function listGroupsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const result = await db.query(
    `SELECT DISTINCT g.* FROM groups g
     LEFT JOIN group_members gm ON g.group_id = gm.group_id
     WHERE g.created_by = $1 OR gm.user_id = $1
     ORDER BY g.created_at DESC`,
    [user.user_id]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    groups: (result.rows || []).map(formatGroup),
  });
}

/**
 * GET /api/v1/groups/:groupId - Get group details
 */
export async function getGroupHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const res = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }

  const group = res.rows[0];
  if (group.created_by !== user.user_id) {
    const mbr = await db.query(
      'SELECT group_member_id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.user_id]
    );
    if (!mbr.rows || mbr.rows.length === 0) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Access denied: You are not a member of this group',
      });
    }
  }

  return jsonResponse(200, {
    status: 'success',
    success: true,
    group: formatGroup(group),
  });
}

/**
 * PUT /api/v1/groups/:groupId - Update group details
 */
export async function updateGroupHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const res = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }

  const group = res.rows[0];
  if (group.created_by !== user.user_id) {
    const mbr = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.user_id]
    );
    const role = mbr.rows[0]?.role;
    if (!role || (role !== 'admin' && role !== 'manager')) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Only group admin, manager, or creator can update group',
      });
    }
  }

  const body = parseBody(event);
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Group name cannot be empty',
    });
  }

  const updatedName = body.name !== undefined ? body.name.trim() : group.name;
  const updatedDesc = body.description !== undefined ? body.description : group.description;
  const now = new Date().toISOString();

  await db.query(
    'UPDATE groups SET name = $1, description = $2, updated_at = $3 WHERE group_id = $4',
    [updatedName, updatedDesc, now, groupId]
  );

  const updated = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  return jsonResponse(200, {
    status: 'success',
    success: true,
    group: formatGroup(updated.rows[0]),
  });
}

/**
 * DELETE /api/v1/groups/:groupId - Delete group with polymorphic cascade
 */
export async function deleteGroupHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const res = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }

  const group = res.rows[0];
  if (group.created_by !== user.user_id) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Only group creator or admin can delete group',
    });
  }

  // Application cascade cleanup: purge polymorphic collection_access records targeting this group
  await db.query(
    "DELETE FROM collection_access WHERE target_type = 'group' AND target_id = $1",
    [groupId]
  );
  await db.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
  await db.query('DELETE FROM groups WHERE group_id = $1', [groupId]);

  return jsonResponse(200, {
    status: 'success',
    success: true,
    message: 'Group deleted successfully',
  });
}

// ============================================================================
// Group Membership Handlers
// ============================================================================

/**
 * POST /api/v1/groups/:groupId/members - Add member to group
 */
export async function addGroupMemberHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const res = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }

  const group = res.rows[0];
  // Group membership grants collection permissions, so nobody may hand out a group role
  // above their own: managers add members/managers, only group admins add admins.
  let actorRank = GROUP_ROLE_RANK.admin;
  if (group.created_by !== user.user_id) {
    const mbr = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.user_id]
    );
    const role = mbr.rows[0]?.role;
    if (!role || (role !== 'admin' && role !== 'manager')) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Only group admin or manager can add members',
      });
    }
    actorRank = GROUP_ROLE_RANK[role];
  }

  const body = parseBody(event);
  const role = typeof body.role === 'string' ? body.role.toLowerCase() : 'member';

  // Members are added by username (or user id). Only group admins/managers get here, and this
  // is the one place a user can be found without already sharing a group with them.
  let targetUserId = body.userId || body.user_id;
  if (!targetUserId && body.username) {
    const targetProfile = await findUserByUsername(db, body.username);
    if (!targetProfile) {
      return jsonResponse(404, {
        status: 'fail',
        error: 'NOT_FOUND',
        message: 'No user with this username',
      });
    }
    targetUserId = targetProfile.user_id;
  }

  if (!targetUserId) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'username or userId is required',
    });
  }

  if (!['member', 'manager', 'admin'].includes(role)) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Invalid role. Must be member, manager, or admin',
    });
  }

  if (GROUP_ROLE_RANK[role] > actorRank) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'You cannot assign a group role higher than your own',
    });
  }

  const targetUser = await db.query('SELECT user_id, username, full_name FROM users WHERE user_id = $1', [targetUserId]);
  if (!targetUser.rows || targetUser.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Target user not found',
    });
  }

  if (group.org_id) {
    const memberCheck = await db.query(
      'SELECT org_member_id FROM organization_members WHERE org_id = $1 AND user_id = $2 AND status = $3',
      [group.org_id, targetUserId, 'confirmed']
    );
    if (!memberCheck.rows || memberCheck.rows.length === 0) {
      return jsonResponse(400, {
        status: 'fail',
        error: 'BAD_REQUEST',
        message: 'Target user is not a member of this organization',
      });
    }
  }

  const existing = await db.query(
    'SELECT group_member_id FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, targetUserId]
  );
  if (existing.rows && existing.rows.length > 0) {
    return jsonResponse(409, {
      status: 'fail',
      error: 'CONFLICT',
      message: 'User is already a member of this group',
    });
  }

  const memberId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO group_members (group_member_id, group_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
    [memberId, groupId, targetUserId, role, now]
  );

  return jsonResponse(201, {
    status: 'success',
    success: true,
    member: formatMember({
      group_member_id: memberId,
      group_id: groupId,
      user_id: targetUserId,
      role,
      created_at: now,
      username: targetUser.rows[0].username,
      full_name: targetUser.rows[0].full_name,
    }),
  });
}

/**
 * GET /api/v1/groups/:groupId/members - List members in group
 */
export async function listGroupMembersHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const res = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }

  const group = res.rows[0];
  if (group.created_by !== user.user_id) {
    const mbr = await db.query(
      'SELECT group_member_id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.user_id]
    );
    if (!mbr.rows || mbr.rows.length === 0) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Access denied: not a group member',
      });
    }
  }

  const membersRes = await db.query(
    `SELECT gm.*, u.username, u.email, u.full_name, u.public_key
     FROM group_members gm
     JOIN users u ON gm.user_id = u.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.created_at ASC`,
    [groupId]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    members: (membersRes.rows || []).map(formatMember),
  });
}

/**
 * DELETE /api/v1/groups/:groupId/members/:userId - Remove member from group
 */
export async function removeGroupMemberHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const groupId = event.pathParameters?.groupId;
  const targetUserId = event.pathParameters?.userId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }

  const group = res.rows[0];
  const targetMember = await db.query(
    'SELECT group_member_id, role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, targetUserId]
  );
  if (!targetMember.rows || targetMember.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Member not found in group',
    });
  }

  if (user.user_id !== targetUserId && group.created_by !== user.user_id) {
    const curMember = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.user_id]
    );
    const curRole = curMember.rows[0]?.role;
    if (!curRole || (curRole !== 'admin' && curRole !== 'manager')) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Insufficient permission to remove member',
      });
    }
    // A manager cannot remove someone with a higher group role (e.g. a group admin).
    if (GROUP_ROLE_RANK[targetMember.rows[0].role] > GROUP_ROLE_RANK[curRole]) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'You cannot remove a member with a higher group role than your own',
      });
    }
  }

  await db.query(
    'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, targetUserId]
  );

  // The removed member loses the group's collection access; drop their keys too.
  await pruneKeysForGroup(db, groupId);

  return jsonResponse(200, {
    status: 'success',
    success: true,
    message: 'Member removed from group',
  });
}

// ============================================================================
// Organization-Scoped Group Handlers (M4: Features 18 & 19)
// ============================================================================

/**
 * POST /api/v1/organizations/:orgId/groups - Create group scoped to organization
 */
export async function createOrgGroupHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'admin');
  if (authError) return authError;

  const body = parseBody(event);
  const name = body.name;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Group name is required',
    });
  }

  const trimmedName = name.trim();
  if (trimmedName.length > 255) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'VALIDATION_FAILED',
      message: 'Group name must not exceed 255 characters',
    });
  }

  const description = body.description || null;
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    'INSERT INTO groups (group_id, org_id, name, description, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [groupId, orgId, trimmedName, description, user.user_id, now, now]
  );

  await recordAuditLog(db, {
    actorUserId: user.user_id,
    actorRole: user.role,
    eventAction: 'ORG_GROUP_CREATED',
    targetResourceId: groupId,
    details: { orgId, name: trimmedName },
  });

  return jsonResponse(201, {
    status: 'success',
    success: true,
    group: formatGroup({
      group_id: groupId,
      org_id: orgId,
      name: trimmedName,
      description,
      created_by: user.user_id,
      created_at: now,
      updated_at: now,
      member_count: 1,
    }),
  });
}

/**
 * GET /api/v1/organizations/:orgId/groups - List groups in organization
 */
export async function listOrgGroupsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const result = await db.query(
    `SELECT g.*, COUNT(DISTINCT gm.user_id) AS member_count
     FROM groups g
     LEFT JOIN group_members gm ON g.group_id = gm.group_id
     WHERE g.org_id = $1
     GROUP BY g.group_id
     ORDER BY g.created_at DESC`,
    [orgId]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    groups: (result.rows || []).map(formatGroup),
  });
}

/**
 * GET /api/v1/organizations/:orgId/groups/:groupId - Get group details
 */
export async function getOrgGroupHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const res = await db.query(
    `SELECT g.*, COUNT(DISTINCT gm.user_id) AS member_count
     FROM groups g
     LEFT JOIN group_members gm ON g.group_id = gm.group_id
     WHERE g.group_id = $1 AND g.org_id = $2
     GROUP BY g.group_id`,
    [groupId, orgId]
  );
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }

  return jsonResponse(200, {
    status: 'success',
    success: true,
    group: formatGroup(res.rows[0]),
  });
}

/**
 * PUT /api/v1/organizations/:orgId/groups/:groupId - Update group details
 */
export async function updateOrgGroupHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const { role: callerOrgRole, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const existingRes = await db.query(
    'SELECT * FROM groups WHERE group_id = $1 AND org_id = $2',
    [groupId, orgId]
  );
  if (!existingRes.rows || existingRes.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }
  const group = existingRes.rows[0];

  // Authorization: Org Owner/Admin, group creator, or group admin/manager
  if (callerOrgRole !== 'owner' && callerOrgRole !== 'admin' && group.created_by !== user.user_id) {
    const curMember = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.user_id]
    );
    const curRole = curMember.rows[0]?.role;
    if (!curRole || (curRole !== 'admin' && curRole !== 'manager')) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Insufficient permission to update group',
      });
    }
  }

  const body = parseBody(event);
  const newName = body.name !== undefined ? String(body.name).trim() : group.name;
  if (!newName) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Group name cannot be empty',
    });
  }
  if (newName.length > 255) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'VALIDATION_FAILED',
      message: 'Group name must not exceed 255 characters',
    });
  }
  const newDescription = body.description !== undefined ? body.description : group.description;
  const now = new Date().toISOString();

  await db.query(
    'UPDATE groups SET name = $1, description = $2, updated_at = $3 WHERE group_id = $4 AND org_id = $5',
    [newName, newDescription, now, groupId, orgId]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    group: formatGroup({
      ...group,
      name: newName,
      description: newDescription,
      updated_at: now,
    }),
  });
}

/**
 * DELETE /api/v1/organizations/:orgId/groups/:groupId - Delete group
 */
export async function deleteOrgGroupHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const { role: callerOrgRole, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const existingRes = await db.query(
    'SELECT * FROM groups WHERE group_id = $1 AND org_id = $2',
    [groupId, orgId]
  );
  if (!existingRes.rows || existingRes.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }
  const group = existingRes.rows[0];

  if (callerOrgRole !== 'owner' && callerOrgRole !== 'admin' && group.created_by !== user.user_id) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Only organization administrators or group creator can delete group',
    });
  }

  // Safe Cascade: clean up polymorphic collection_access for group
  await db.query(
    "DELETE FROM collection_access WHERE target_type = 'group' AND target_id = $1",
    [groupId]
  );
  await pruneKeysForGroup(db, groupId);
  await db.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
  await db.query('DELETE FROM groups WHERE group_id = $1 AND org_id = $2', [groupId, orgId]);

  await recordAuditLog(db, {
    actorUserId: user.user_id,
    actorRole: user.role,
    eventAction: 'ORG_GROUP_DELETED',
    targetResourceId: groupId,
    details: { orgId, name: group.name },
  });

  return jsonResponse(200, {
    status: 'success',
    success: true,
    deleted: true,
    message: 'Group deleted successfully',
  });
}

/**
 * POST /api/v1/organizations/:orgId/groups/:groupId/members - Add member to organization group
 */
export async function addOrgGroupMemberHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const { role: callerOrgRole, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const groupRes = await db.query(
    'SELECT * FROM groups WHERE group_id = $1 AND org_id = $2',
    [groupId, orgId]
  );
  if (!groupRes.rows || groupRes.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }
  const group = groupRes.rows[0];

  // Authorization: Org Owner/Admin, group creator, or group manager/admin
  let actorRank = 1;
  if (callerOrgRole === 'owner' || callerOrgRole === 'admin' || group.created_by === user.user_id) {
    actorRank = 3;
  } else {
    const curMember = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.user_id]
    );
    const curRole = curMember.rows[0]?.role;
    if (!curRole || (curRole !== 'admin' && curRole !== 'manager')) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Insufficient permission to add member to group',
      });
    }
    actorRank = GROUP_ROLE_RANK[curRole] || 1;
  }

  const body = parseBody(event);
  const role = body.role || 'member';
  if (!['member', 'manager', 'admin'].includes(role)) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Invalid role. Must be member, manager, or admin',
    });
  }
  if (GROUP_ROLE_RANK[role] > actorRank) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'You cannot assign a group role higher than your own',
    });
  }

  let targetUserId = body.userId || body.user_id;
  if (!targetUserId && (body.username || body.usernameOrEmail)) {
    const targetIdentifier = body.username || body.usernameOrEmail;
    const uRes = await db.query(
      'SELECT user_id, username, full_name FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
      [targetIdentifier]
    );
    if (!uRes.rows || uRes.rows.length === 0) {
      return jsonResponse(404, {
        status: 'fail',
        error: 'NOT_FOUND',
        message: 'Target user not found',
      });
    }
    targetUserId = uRes.rows[0].user_id;
  }

  if (!targetUserId) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'userId or username is required',
    });
  }

  // Cross-tenant boundary check: Target user MUST be a confirmed member of this organization!
  const orgMemberRes = await db.query(
    'SELECT org_member_id FROM organization_members WHERE org_id = $1 AND user_id = $2 AND status = $3',
    [orgId, targetUserId, 'confirmed']
  );
  if (!orgMemberRes.rows || orgMemberRes.rows.length === 0) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'CROSS_ORG_FORBIDDEN',
      message: 'Target user is not a member of this organization',
    });
  }

  const targetUserRes = await db.query(
    'SELECT user_id, username, full_name, email FROM users WHERE user_id = $1',
    [targetUserId]
  );
  if (!targetUserRes.rows || targetUserRes.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Target user not found',
    });
  }

  const existingRes = await db.query(
    'SELECT group_member_id FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, targetUserId]
  );
  if (existingRes.rows && existingRes.rows.length > 0) {
    return jsonResponse(409, {
      status: 'fail',
      error: 'CONFLICT',
      message: 'User is already a member of this group',
    });
  }

  const memberId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO group_members (group_member_id, group_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
    [memberId, groupId, targetUserId, role, now]
  );

  return jsonResponse(201, {
    status: 'success',
    success: true,
    member: formatMember({
      group_member_id: memberId,
      group_id: groupId,
      user_id: targetUserId,
      role,
      created_at: now,
      username: targetUserRes.rows[0].username,
      full_name: targetUserRes.rows[0].full_name,
      email: targetUserRes.rows[0].email,
    }),
  });
}

/**
 * GET /api/v1/organizations/:orgId/groups/:groupId/members - List members in organization group
 */
export async function listOrgGroupMembersHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const groupId = event.pathParameters?.groupId;
  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const groupRes = await db.query(
    'SELECT * FROM groups WHERE group_id = $1 AND org_id = $2',
    [groupId, orgId]
  );
  if (!groupRes.rows || groupRes.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }

  const membersRes = await db.query(
    `SELECT gm.*, u.username, u.email, u.full_name, u.public_key
     FROM group_members gm
     JOIN users u ON gm.user_id = u.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.created_at ASC`,
    [groupId]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    members: (membersRes.rows || []).map(formatMember),
  });
}

/**
 * DELETE /api/v1/organizations/:orgId/groups/:groupId/members/:userId - Remove member from organization group
 */
export async function removeOrgGroupMemberHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const groupId = event.pathParameters?.groupId;
  const targetUserId = event.pathParameters?.userId;
  const db = getDatabase();
  const { role: callerOrgRole, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const groupRes = await db.query(
    'SELECT * FROM groups WHERE group_id = $1 AND org_id = $2',
    [groupId, orgId]
  );
  if (!groupRes.rows || groupRes.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Group not found',
    });
  }
  const group = groupRes.rows[0];

  const targetMember = await db.query(
    'SELECT group_member_id, role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, targetUserId]
  );
  if (!targetMember.rows || targetMember.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Member not found in group',
    });
  }

  // Self removal is allowed; otherwise Org Owner/Admin, group creator, or group manager/admin
  if (user.user_id !== targetUserId && callerOrgRole !== 'owner' && callerOrgRole !== 'admin' && group.created_by !== user.user_id) {
    const curMember = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.user_id]
    );
    const curRole = curMember.rows[0]?.role;
    if (!curRole || (curRole !== 'admin' && curRole !== 'manager')) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Insufficient permission to remove member from group',
      });
    }
    if (GROUP_ROLE_RANK[targetMember.rows[0].role] > GROUP_ROLE_RANK[curRole]) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'You cannot remove a member with a higher group role than your own',
      });
    }
  }

  await db.query(
    'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, targetUserId]
  );
  await pruneKeysForGroup(db, groupId);

  return jsonResponse(200, {
    status: 'success',
    success: true,
    removed: true,
    message: 'Member removed from group',
  });
}
