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
import { authenticate } from '../middleware/auth-guard.js';
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
  return {
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
  let result;
  if (user.role === 'admin' || user.role === 'ADMIN') {
    result = await db.query('SELECT * FROM groups ORDER BY created_at DESC');
  } else {
    result = await db.query(
      `SELECT DISTINCT g.* FROM groups g
       LEFT JOIN group_members gm ON g.group_id = gm.group_id
       WHERE g.created_by = $1 OR gm.user_id = $1
       ORDER BY g.created_at DESC`,
      [user.user_id]
    );
  }

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
  if (user.role !== 'admin' && group.created_by !== user.user_id) {
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
  if (user.role !== 'admin' && group.created_by !== user.user_id) {
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
  if (user.role !== 'admin' && group.created_by !== user.user_id) {
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
  if (user.role !== 'admin' && group.created_by !== user.user_id) {
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
  if (user.role !== 'admin' && group.created_by !== user.user_id) {
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

  if (user.user_id !== targetUserId && user.role !== 'admin' && group.created_by !== user.user_id) {
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
