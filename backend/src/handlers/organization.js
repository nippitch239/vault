/**
 * Secure Vault Cloud — Organizations & Membership Handlers (Milestone M3)
 *
 * Implements:
 * 1. Organization CRUD: createOrganization, listOrganizations, getOrganization, updateOrganization, deleteOrganization
 * 2. Organization Members: listMembers, addMemberOrInvite, updateMemberRole, removeMember
 * 3. Multi-tier RBAC: Owner, Admin, Member authorization guards & IDOR protection
 * 4. Sole Owner Protection: Prevents demoting or removing the last active owner
 * 5. Zero-Knowledge Key Storage: Stores encrypted_org_key wrapped via RSA-OAEP
 * 6. Invitations: createInvitation, listInvitations
 *
 * Ponytail minimalism: Native stdlib crypto & SQL parameterized queries.
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db/adapter.js';
import { authenticate, requireOrgRole } from '../middleware/auth-guard.js';
import { ok, badRequest, notFound, forbidden, conflict, readJsonBody } from '../http/response.js';
import { requireUuids, checkText, isWrappedKey } from '../http/validate.js';

const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;
const VALID_ORG_ROLES = ['owner', 'admin', 'member'];

/**
 * Normalizes organization database row into dual camelCase / snake_case representation
 */
export function formatOrganization(row, extra = {}) {
  if (!row) return null;
  const orgId = row.org_id || row.id;
  const name = row.name;
  const description = row.description !== undefined ? row.description : null;
  const createdBy = row.created_by || row.createdBy;
  const status = row.status || 'active';
  const createdAt = row.created_at || row.createdAt;
  const updatedAt = row.updated_at || row.updatedAt;
  const role = extra.role || row.user_role || row.role || null;
  const memberCount = extra.memberCount !== undefined
    ? extra.memberCount
    : (row.member_count !== undefined ? Number(row.member_count) : undefined);

  const obj = {
    id: orgId,
    org_id: orgId,
    name,
    description,
    createdBy,
    created_by: createdBy,
    status,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
  if (role) {
    obj.role = role;
  }
  if (memberCount !== undefined) {
    obj.memberCount = memberCount;
    obj.member_count = memberCount;
  }
  if (extra.encrypted_org_key !== undefined || row.encrypted_org_key !== undefined) {
    let key = extra.encrypted_org_key !== undefined ? extra.encrypted_org_key : row.encrypted_org_key;
    if (typeof key === 'string') {
      try { key = JSON.parse(key); } catch { /* preserve raw */ }
    }
    obj.encryptedOrgKey = key;
    obj.encrypted_org_key = key;
  }
  return obj;
}

/**
 * Normalizes organization member row into dual camelCase / snake_case representation
 */
export function formatMember(row) {
  if (!row) return null;
  const orgMemberId = row.org_member_id || row.id;
  const orgId = row.org_id || row.orgId;
  const userId = row.user_id || row.userId;
  const role = row.role;
  const status = row.status || 'confirmed';
  const createdAt = row.created_at || row.createdAt;
  const updatedAt = row.updated_at || row.updatedAt;

  let encryptedOrgKey = row.encrypted_org_key || row.encryptedOrgKey || null;
  if (typeof encryptedOrgKey === 'string') {
    try { encryptedOrgKey = JSON.parse(encryptedOrgKey); } catch { /* preserve raw */ }
  }

  const obj = {
    id: orgMemberId,
    org_member_id: orgMemberId,
    orgId,
    org_id: orgId,
    userId,
    user_id: userId,
    role,
    status,
    createdAt,
    created_at: createdAt,
    joinedAt: createdAt,
    joined_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
    hasKey: Boolean(encryptedOrgKey),
    has_key: Boolean(encryptedOrgKey),
  };

  if (row.username !== undefined) obj.username = row.username;
  if (row.email !== undefined) obj.email = row.email;
  if (row.full_name !== undefined) {
    obj.fullName = row.full_name;
    obj.full_name = row.full_name;
  }
  if (row.public_key !== undefined) {
    obj.publicKey = row.public_key;
    obj.public_key = row.public_key;
  }
  if (encryptedOrgKey) {
    obj.encryptedOrgKey = encryptedOrgKey;
    obj.encrypted_org_key = encryptedOrgKey;
  }
  return obj;
}

// ============================================================================
// Organization CRUD Handlers
// ============================================================================

/**
 * POST /api/v1/organizations - Create a new organization
 */
export async function createOrganizationHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const nameCheck = checkText('name', body.name, { min: 1, max: NAME_MAX });
  const descCheck = checkText('description', body.description ?? null, { max: DESCRIPTION_MAX, allowNull: true });
  const errors = [nameCheck.error, descCheck.error].filter(Boolean);

  const encryptedOrgKey = body.encryptedOrgKey || body.encrypted_org_key;
  if (encryptedOrgKey !== undefined && !isWrappedKey(encryptedOrgKey)) {
    errors.push({ field: 'encryptedOrgKey', message: 'encryptedOrgKey must be a valid wrapped key payload' });
  }
  if (errors.length) return badRequest('Validation failed', 'BAD_REQUEST', errors);

  const db = getDatabase();
  const orgId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO organizations (org_id, name, description, created_by, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
      [orgId, nameCheck.value, descCheck.value || null, user.user_id, now, now]
    );

    await tx.query(
      `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status, encrypted_org_key, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner', 'confirmed', $4, $5, $6)`,
      [memberId, orgId, user.user_id, encryptedOrgKey || null, now, now]
    );
  });

  return ok(
    {
      organization: formatOrganization({
        org_id: orgId,
        name: nameCheck.value,
        description: descCheck.value || null,
        created_by: user.user_id,
        status: 'active',
        created_at: now,
        updated_at: now,
      }, { role: 'owner', memberCount: 1, encrypted_org_key: encryptedOrgKey || null }),
    },
    201
  );
}

/**
 * GET /api/v1/organizations - List organizations caller belongs to
 */
export async function listOrganizationsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const res = await db.query(
    `SELECT
       o.org_id,
       o.name,
       o.description,
       o.created_by,
       o.status,
       o.created_at,
       o.updated_at,
       om.role AS user_role,
       om.encrypted_org_key,
       (SELECT COUNT(*) FROM organization_members m WHERE m.org_id = o.org_id AND m.status = 'confirmed') AS member_count
     FROM organizations o
     JOIN organization_members om ON om.org_id = o.org_id AND om.user_id = $1 AND om.status = 'confirmed'
     ORDER BY o.created_at DESC`,
    [user.user_id]
  );

  return ok({
    organizations: (res.rows || []).map((row) =>
      formatOrganization(row, {
        role: row.user_role,
        encrypted_org_key: row.encrypted_org_key,
      })
    ),
  });
}

/**
 * GET /api/v1/organizations/:orgId - Get single organization details
 */
export async function getOrganizationHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const idError = requireUuids({ orgId });
  if (idError) return idError;

  const db = getDatabase();
  const { organization, membership, role, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const countRes = await db.query(
    "SELECT COUNT(*) AS member_count FROM organization_members WHERE org_id = $1 AND status = 'confirmed'",
    [orgId]
  );
  const memberCount = Number(countRes.rows[0]?.member_count || 1);

  return ok({
    organization: formatOrganization(organization, {
      role,
      memberCount,
      encrypted_org_key: membership?.encrypted_org_key || null,
    }),
  });
}

/**
 * PUT /api/v1/organizations/:orgId - Update organization metadata
 */
export async function updateOrganizationHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const idError = requireUuids({ orgId });
  if (idError) return idError;

  const db = getDatabase();
  const { organization, role, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'admin');
  if (authError) return authError;

  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const nameCheck = body.name !== undefined ? checkText('name', body.name, { min: 1, max: NAME_MAX }) : {};
  const descCheck = body.description !== undefined ? checkText('description', body.description, { max: DESCRIPTION_MAX, allowNull: true }) : {};
  const errors = [nameCheck.error, descCheck.error].filter(Boolean);
  if (errors.length) return badRequest('Validation failed', 'BAD_REQUEST', errors);

  if (body.name === undefined && body.description === undefined) {
    return badRequest('At least name or description is required to update');
  }

  const updatedName = nameCheck.value !== undefined ? nameCheck.value : organization.name;
  const updatedDesc = body.description !== undefined ? (descCheck.value || null) : organization.description;
  const now = new Date().toISOString();

  await db.query(
    'UPDATE organizations SET name = $1, description = $2, updated_at = $3 WHERE org_id = $4',
    [updatedName, updatedDesc, now, orgId]
  );

  const countRes = await db.query(
    "SELECT COUNT(*) AS member_count FROM organization_members WHERE org_id = $1 AND status = 'confirmed'",
    [orgId]
  );
  const memberCount = Number(countRes.rows[0]?.member_count || 1);

  return ok({
    organization: formatOrganization({
      ...organization,
      name: updatedName,
      description: updatedDesc,
      updated_at: now,
    }, { role, memberCount }),
  });
}

/**
 * DELETE /api/v1/organizations/:orgId - Delete organization (Owner only)
 */
export async function deleteOrganizationHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const idError = requireUuids({ orgId });
  if (idError) return idError;

  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'owner');
  if (authError) return authError;

  // Application cascade cleanup: polymorphic collection_access targeting groups in this org
  await db.transaction(async (tx) => {
    await tx.query(
      `DELETE FROM collection_access
       WHERE target_type = 'group'
         AND target_id IN (SELECT group_id FROM groups WHERE org_id = $1)`,
      [orgId]
    );
    await tx.query('DELETE FROM organizations WHERE org_id = $1', [orgId]);
  });

  return ok({ message: 'Organization deleted successfully', deleted: true });
}

// ============================================================================
// Member Management Handlers
// ============================================================================

/**
 * GET /api/v1/organizations/:orgId/members - List organization members
 */
export async function listMembersHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const idError = requireUuids({ orgId });
  if (idError) return idError;

  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const res = await db.query(
    `SELECT
       om.org_member_id,
       om.org_id,
       om.user_id,
       om.role,
       om.status,
       om.encrypted_org_key,
       om.created_at,
       om.updated_at,
       u.username,
       u.email,
       u.full_name,
       u.public_key
     FROM organization_members om
     JOIN users u ON om.user_id = u.user_id
     WHERE om.org_id = $1
     ORDER BY
       CASE om.role
         WHEN 'owner' THEN 1
         WHEN 'admin' THEN 2
         WHEN 'member' THEN 3
         ELSE 4
       END,
       om.created_at ASC`,
    [orgId]
  );

  return ok({
    members: (res.rows || []).map(formatMember),
  });
}

/**
 * POST /api/v1/organizations/:orgId/members - Invite or add member
 */
export async function addMemberHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const idError = requireUuids({ orgId });
  if (idError) return idError;

  const db = getDatabase();
  const { role: callerRole, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'admin');
  if (authError) return authError;

  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const targetIdentifier = String(
    body.usernameOrEmail || body.username || body.email || body.userId || body.user_id || ''
  ).trim();
  if (!targetIdentifier) {
    return badRequest('usernameOrEmail is required', 'BAD_REQUEST');
  }

  const roleRaw = typeof body.role === 'string' ? body.role.toLowerCase() : 'member';
  const role = roleRaw === 'user' ? 'member' : roleRaw;
  if (!VALID_ORG_ROLES.includes(role)) {
    return badRequest(`Invalid role. Must be one of: ${VALID_ORG_ROLES.join(', ')}`, 'BAD_REQUEST');
  }

  // Privilege escalation check: only owners can assign owner role
  if (role === 'owner' && callerRole !== 'owner' && user.role !== 'admin') {
    return forbidden('Only organization owners can grant the owner role');
  }

  const encryptedOrgKey = body.encryptedOrgKey || body.encrypted_org_key;
  if (encryptedOrgKey !== undefined && !isWrappedKey(encryptedOrgKey)) {
    return badRequest('encryptedOrgKey must be a valid wrapped key payload', 'BAD_REQUEST');
  }

  // Locate target user profile (case-insensitive)
  const userRes = await db.query(
    'SELECT user_id, username, email, full_name, public_key FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) OR user_id = $1 LIMIT 1',
    [targetIdentifier]
  );
  if (!userRes.rows || userRes.rows.length === 0) {
    return notFound('Target user not found');
  }
  const targetUser = userRes.rows[0];

  // Check for duplicate membership
  const existingMember = await db.query(
    'SELECT org_member_id FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, targetUser.user_id]
  );
  if (existingMember.rows && existingMember.rows.length > 0) {
    return conflict('User is already a member of this organization');
  }

  const memberId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status, encrypted_org_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'confirmed', $5, $6, $7)`,
    [memberId, orgId, targetUser.user_id, role, encryptedOrgKey || null, now, now]
  );

  return ok(
    {
      member: formatMember({
        org_member_id: memberId,
        org_id: orgId,
        user_id: targetUser.user_id,
        role,
        status: 'confirmed',
        encrypted_org_key: encryptedOrgKey || null,
        created_at: now,
        updated_at: now,
        username: targetUser.username,
        email: targetUser.email,
        full_name: targetUser.full_name,
        public_key: targetUser.public_key,
      }),
    },
    201
  );
}

/**
 * PUT /api/v1/organizations/:orgId/members/:userId - Update member role with Sole-Owner protection
 */
export async function updateMemberRoleHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const targetUserId = event.pathParameters?.userId;
  const idError = requireUuids({ orgId, targetUserId });
  if (idError) return idError;

  const db = getDatabase();
  const { role: callerRole, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'admin');
  if (authError) return authError;

  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const roleRaw = typeof body.role === 'string' ? body.role.toLowerCase() : '';
  const newRole = roleRaw === 'user' ? 'member' : roleRaw;
  if (!VALID_ORG_ROLES.includes(newRole)) {
    return badRequest(`Invalid role. Must be one of: ${VALID_ORG_ROLES.join(', ')}`, 'BAD_REQUEST');
  }

  // Admins cannot promote anyone to owner
  if (newRole === 'owner' && callerRole !== 'owner' && user.role !== 'admin') {
    return forbidden('Only organization owners can grant the owner role');
  }

  const targetMemberRes = await db.query(
    'SELECT org_member_id, role, status FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, targetUserId]
  );
  if (!targetMemberRes.rows || targetMemberRes.rows.length === 0) {
    return notFound('Member not found in organization');
  }
  const targetMember = targetMemberRes.rows[0];

  // Admins cannot modify an owner's role
  if (targetMember.role === 'owner' && callerRole !== 'owner' && user.role !== 'admin') {
    return forbidden('Admins cannot modify organization owners');
  }

  // Sole-Owner Demotion Protection
  if (targetMember.role === 'owner' && newRole !== 'owner') {
    const ownerCountRes = await db.query(
      "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
      [orgId]
    );
    const count = Number(ownerCountRes.rows[0]?.count || 0);
    if (count <= 1) {
      return badRequest('Cannot demote the sole owner of the organization. Transfer ownership first.', 'SOLE_OWNER_PROTECTION');
    }
  }

  const now = new Date().toISOString();
  await db.query(
    'UPDATE organization_members SET role = $1, updated_at = $2 WHERE org_id = $3 AND user_id = $4',
    [newRole, now, orgId, targetUserId]
  );

  return ok({
    member: {
      org_member_id: targetMember.org_member_id,
      id: targetMember.org_member_id,
      org_id: orgId,
      orgId,
      user_id: targetUserId,
      userId: targetUserId,
      role: newRole,
      status: targetMember.status,
      updated_at: now,
      updatedAt: now,
    },
  });
}

/**
 * DELETE /api/v1/organizations/:orgId/members/:userId - Remove member with Sole-Owner protection & cleanup
 */
export async function removeMemberHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const targetUserId = event.pathParameters?.userId;
  const idError = requireUuids({ orgId, targetUserId });
  if (idError) return idError;

  const db = getDatabase();
  const { role: callerRole, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const isSelf = user.user_id === targetUserId;
  if (!isSelf && callerRole === 'member' && user.role !== 'admin') {
    return forbidden('Only organization owner or admin can remove members');
  }

  const targetMemberRes = await db.query(
    'SELECT org_member_id, role, status FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, targetUserId]
  );
  if (!targetMemberRes.rows || targetMemberRes.rows.length === 0) {
    return notFound('Member not found in organization');
  }
  const targetMember = targetMemberRes.rows[0];

  // Admin cannot remove an owner
  if (targetMember.role === 'owner' && callerRole === 'admin' && !isSelf && user.role !== 'admin') {
    return forbidden('Admins cannot remove organization owners');
  }

  // Sole-Owner Removal Protection
  if (targetMember.role === 'owner') {
    const ownerCountRes = await db.query(
      "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
      [orgId]
    );
    const count = Number(ownerCountRes.rows[0]?.count || 0);
    if (count <= 1) {
      return badRequest('Cannot remove the sole owner of the organization. Delete the organization or transfer ownership first.', 'SOLE_OWNER_PROTECTION');
    }
  }

  // Atomic cleanup of member's group memberships and direct collection access within this org
  await db.transaction(async (tx) => {
    // 1. Remove from all groups scoped to this organization
    await tx.query(
      `DELETE FROM group_members
       WHERE user_id = $1
         AND group_id IN (SELECT group_id FROM groups WHERE org_id = $2)`,
      [targetUserId, orgId]
    );

    // 2. Remove direct user collection access in this organization
    await tx.query(
      `DELETE FROM collection_access
       WHERE target_type = 'user'
         AND target_id = $1
         AND collection_id IN (SELECT collection_id FROM collections WHERE org_id = $2)`,
      [targetUserId, orgId]
    );

    // 3. Remove wrapped collection keys for this user in this org
    await tx.query(
      `DELETE FROM collection_keys
       WHERE user_id = $1
         AND collection_id IN (SELECT collection_id FROM collections WHERE org_id = $2)`,
      [targetUserId, orgId]
    );

    // 4. Remove member record
    await tx.query(
      'DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2',
      [orgId, targetUserId]
    );
  });

  return ok({ message: 'Member removed from organization', removed: true });
}

// ============================================================================
// Invitation Handlers
// ============================================================================

/**
 * POST /api/v1/organizations/:orgId/invitations - Create an invitation token for an email
 */
export async function createInvitationHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const idError = requireUuids({ orgId });
  if (idError) return idError;

  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'admin');
  if (authError) return authError;

  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const email = String(body.email || body.usernameOrEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return badRequest('A valid email address is required', 'BAD_REQUEST');
  }

  const roleRaw = typeof body.role === 'string' ? body.role.toLowerCase() : 'member';
  const role = roleRaw === 'admin' ? 'admin' : 'member';

  // Check if target email already belongs to an active member
  const memberCheck = await db.query(
    `SELECT om.org_member_id
     FROM organization_members om
     JOIN users u ON om.user_id = u.user_id
     WHERE om.org_id = $1 AND LOWER(u.email) = $2`,
    [orgId, email]
  );
  if (memberCheck.rows && memberCheck.rows.length > 0) {
    return conflict('User is already a member of this organization');
  }

  const invitationId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db.query(
    `INSERT INTO organization_invitations (invitation_id, org_id, email, role, invited_by, token, status, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
    [invitationId, orgId, email, role, user.user_id, token, expiresAt, now]
  );

  return ok(
    {
      invitation: {
        id: invitationId,
        invitation_id: invitationId,
        orgId,
        org_id: orgId,
        email,
        role,
        status: 'pending',
        token,
        expiresAt,
        expires_at: expiresAt,
        createdAt: now,
        created_at: now,
      },
    },
    201
  );
}

/**
 * GET /api/v1/organizations/:orgId/invitations - List pending invitations
 */
export async function listInvitationsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const idError = requireUuids({ orgId });
  if (idError) return idError;

  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'admin');
  if (authError) return authError;

  const res = await db.query(
    `SELECT invitation_id, org_id, email, role, invited_by, status, expires_at, created_at
     FROM organization_invitations
     WHERE org_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  );

  return ok({
    invitations: (res.rows || []).map((row) => ({
      id: row.invitation_id,
      invitation_id: row.invitation_id,
      orgId: row.org_id,
      org_id: row.org_id,
      email: row.email,
      role: row.role,
      invitedBy: row.invited_by,
      invited_by: row.invited_by,
      status: row.status,
      expiresAt: row.expires_at,
      expires_at: row.expires_at,
      createdAt: row.created_at,
      created_at: row.created_at,
    })),
  });
}

// Aliases for interface parity
export const createOrganization = createOrganizationHandler;
export const listOrganizations = listOrganizationsHandler;
export const getOrganization = getOrganizationHandler;
export const updateOrganization = updateOrganizationHandler;
export const deleteOrganization = deleteOrganizationHandler;
export const listMembers = listMembersHandler;
export const addMemberOrInvite = addMemberHandler;
export const updateMemberRole = updateMemberRoleHandler;
export const removeMember = removeMemberHandler;
export const inviteOrgMemberHandler = addMemberHandler;
export const listOrgMembersHandler = listMembersHandler;
export const updateOrgMemberRoleHandler = updateMemberRoleHandler;
export const removeOrgMemberHandler = removeMemberHandler;
