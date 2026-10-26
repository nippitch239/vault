/**
 * SecureVault Cloud — API client
 *
 * Every call goes through API Gateway (VITE_API_URL). The Cognito ID token from the auth
 * adapter is sent as "Authorization: Bearer <token>"; API Gateway's Cognito authorizer
 * validates it before the Lambda runs. The frontend never talks to the database or to
 * server-side AWS APIs directly.
 */

import { config } from '../config.js';
import { getAuth } from './auth/index.js';

let customApiBase = null;
let staticToken = null; // tests / scripts only
let unauthorizedHandler = null;

export const setApiBase = (url) => {
  customApiBase = url;
};

export const getApiBase = () => customApiBase || config.apiUrl;

/** Overrides the token provider (integration tests). Pass null to use the auth adapter again. */
export const setAuthToken = (token) => {
  staticToken = token;
};

export const getAuthToken = async () => {
  if (staticToken) return staticToken;
  try {
    const auth = await getAuth();
    return await auth.getIdToken();
  } catch {
    return null;
  }
};

/** Called with the ApiError when the API answers 401 (expired / revoked session). */
export const setUnauthorizedHandler = (fn) => {
  unauthorizedHandler = fn;
};

export class ApiError extends Error {
  constructor(message, status = 500, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = data?.error;
  }
}

async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${getApiBase()}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  if (!options.public && !headers.Authorization) {
    const token = await getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const fetchOptions = {
    method: options.method || 'GET',
    headers,
    signal: options.signal,
  };
  if (options.body !== undefined) {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต', 0, null);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    if (!response.ok) throw new ApiError(`Request failed with status ${response.status}`, response.status);
    return response.text();
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new ApiError(data?.message || data?.error || `Request failed with status ${response.status}`, response.status, data);
    if (response.status === 401 && unauthorizedHandler) unauthorizedHandler(error);
    throw error;
  }
  return data;
}

export const api = {
  // Auth helpers (credentials themselves are handled by Cognito — see services/auth)
  auth: {
    getSalt: (identifier) => request(`/auth/salt?identifier=${encodeURIComponent(identifier)}`, { public: true }),
    recordSession: () => request('/auth/session', { method: 'POST' }),
  },

  // Vault profile & key material
  users: {
    me: () => request('/users/me'),
    createMe: (profile) => request('/users/me', { method: 'POST', body: profile }),
    updateMe: (fields) => request('/users/me', { method: 'PATCH', body: fields }),
    updateKeys: (keys) => request('/users/me/keys', { method: 'PUT', body: keys }),
  },

  // Vault Items (UC-4, UC-5, UC-6)
  vault: {
    listVaults: () => request('/vaults'),

    listItems: (vaultId) => (vaultId ? request(`/vaults/${vaultId}/items`) : request('/items')),

    getItem: (itemId, vaultId) =>
      vaultId ? request(`/vaults/${vaultId}/items/${itemId}`) : request(`/items/${itemId}`),

    createItem: (itemData, vaultId) =>
      vaultId
        ? request(`/vaults/${vaultId}/items`, { method: 'POST', body: itemData })
        : request('/items', { method: 'POST', body: itemData }),

    updateItem: (itemId, itemData, vaultId) =>
      vaultId
        ? request(`/vaults/${vaultId}/items/${itemId}`, { method: 'PUT', body: itemData })
        : request(`/items/${itemId}`, { method: 'PUT', body: itemData }),

    deleteItem: (itemId, vaultId) =>
      vaultId
        ? request(`/vaults/${vaultId}/items/${itemId}`, { method: 'DELETE' })
        : request(`/items/${itemId}`, { method: 'DELETE' }),
  },

  // Sharing (UC-10)
  sharing: {
    // Only users who share a group with the caller are found (404 otherwise).
    lookupUser: (username) => request(`/users/lookup?username=${encodeURIComponent(username)}`),

    shareItem: (itemId, shareData, vaultId) =>
      vaultId
        ? request(`/vaults/${vaultId}/items/${itemId}/share`, { method: 'POST', body: shareData })
        : request(`/items/${itemId}/share`, { method: 'POST', body: shareData }),

    listSharedItems: () => request('/shared-items'),

    revokeShare: (itemId, userId, vaultId) =>
      vaultId
        ? request(`/vaults/${vaultId}/items/${itemId}/share/${userId}`, { method: 'DELETE' })
        : request(`/items/${itemId}/share/${userId}`, { method: 'DELETE' }),
  },

  // History & Revision Rollback (UC-11)
  history: {
    getHistory: (itemId, vaultId) =>
      vaultId
        ? request(`/vaults/${vaultId}/items/${itemId}/history`)
        : request(`/items/${itemId}/history`),

    rollback: (itemId, version, vaultId) =>
      vaultId
        ? request(`/vaults/${vaultId}/items/${itemId}/rollback`, { method: 'POST', body: { version } })
        : request(`/items/${itemId}/rollback`, { method: 'POST', body: { version } }),
  },

  // Logs & Security (UC-8, UC-9, UC-12)
  logs: {
    getSecurityNotifications: () => request('/admin/security/notifications'),

    simulateSecurityEvent: (data) =>
      request('/admin/security/simulate-event', { method: 'POST', body: data }),

    getAdminAuditLogs: (filters = {}) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.append(k, v);
      });
      const qs = params.toString() ? `?${params.toString()}` : '';
      return request(`/admin/audit-logs${qs}`);
    },

    exportAuditLogsCsv: (filters = {}) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.append(k, v);
      });
      params.set('format', 'csv');
      return request(`/admin/audit-logs?${params.toString()}`);
    },

    getUserActivityLogs: (filters = {}) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.append(k, v);
      });
      const qs = params.toString() ? `?${params.toString()}` : '';
      return request(`/user/activity-logs${qs}`);
    },
  },

  // Monitoring (UC-13)
  monitoring: {
    getMetrics: () => request('/admin/monitoring/metrics'),
    getHealth: () => request('/health'),
  },

  // ==========================================
  // Groups API (M3: R1)
  // ==========================================
  groups: {
    create: (groupData) => request('/groups', { method: 'POST', body: groupData }),
    list: () => request('/groups'),
    get: (groupId) => request(`/groups/${groupId}`),
    update: (groupId, groupData) => request(`/groups/${groupId}`, { method: 'PUT', body: groupData }),
    delete: (groupId) => request(`/groups/${groupId}`, { method: 'DELETE' }),

    // Group Members API (M3: R1)
    listMembers: (groupId) => request(`/groups/${groupId}/members`),
    addMember: (groupId, memberData) =>
      request(`/groups/${groupId}/members`, { method: 'POST', body: memberData }),
    removeMember: (groupId, userId) =>
      request(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
  },

  // ==========================================
  // Collections API (M3: R1, R2, R3)
  // ==========================================
  collections: {
    create: (collectionData) => request('/collections', { method: 'POST', body: collectionData }),
    list: () => request('/collections'),
    get: (collectionId) => request(`/collections/${collectionId}`),
    update: (collectionId, updateData) =>
      request(`/collections/${collectionId}`, { method: 'PUT', body: updateData }),
    delete: (collectionId) => request(`/collections/${collectionId}`, { method: 'DELETE' }),

    // Collection Access RBAC (M3: R1, R3)
    listAccess: (collectionId) => request(`/collections/${collectionId}/access`),
    grantAccess: (collectionId, accessData) =>
      request(`/collections/${collectionId}/access`, { method: 'POST', body: accessData }),
    revokeAccess: (collectionId, targetType, targetId) =>
      request(`/collections/${collectionId}/access/${targetType}/${targetId}`, { method: 'DELETE' }),

    // Collection Keys Distribution (M3: R1, R2)
    getKeys: (collectionId) => request(`/collections/${collectionId}/keys`),
    pendingKeys: (collectionId) => request(`/collections/${collectionId}/keys/pending`),
    storeKey: (collectionId, keyData) =>
      request(`/collections/${collectionId}/keys`, { method: 'POST', body: keyData }),

    // Collection Items Association (M3: R1)
    listItems: (collectionId) => request(`/collections/${collectionId}/items`),
    addItem: (collectionId, itemData) =>
      request(`/collections/${collectionId}/items`, { method: 'POST', body: itemData }),
    removeItem: (collectionId, itemId) =>
      request(`/collections/${collectionId}/items/${itemId}`, { method: 'DELETE' }),
  },

  // Folders (Personal Vault Organization)
  folders: {
    list: () => request('/folders'),
    create: (name) => request('/folders', { method: 'POST', body: { name } }),
    update: (folderId, name) => request(`/folders/${folderId}`, { method: 'PUT', body: { name } }),
    delete: (folderId) => request(`/folders/${folderId}`, { method: 'DELETE' }),
  },

  // Flat Convenience Aliases
  createGroup: (groupData) => request('/groups', { method: 'POST', body: groupData }),
  listGroups: () => request('/groups'),
  getGroup: (groupId) => request(`/groups/${groupId}`),
  updateGroup: (groupId, groupData) => request(`/groups/${groupId}`, { method: 'PUT', body: groupData }),
  deleteGroup: (groupId) => request(`/groups/${groupId}`, { method: 'DELETE' }),

  addGroupMember: (groupId, memberData) =>
    request(`/groups/${groupId}/members`, { method: 'POST', body: memberData }),
  listGroupMembers: (groupId) => request(`/groups/${groupId}/members`),
  removeGroupMember: (groupId, userId) =>
    request(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),

  createCollection: (collectionData) => request('/collections', { method: 'POST', body: collectionData }),
  listCollections: () => request('/collections'),
  getCollection: (collectionId) => request(`/collections/${collectionId}`),
  updateCollection: (collectionId, updateData) =>
    request(`/collections/${collectionId}`, { method: 'PUT', body: updateData }),
  deleteCollection: (collectionId) => request(`/collections/${collectionId}`, { method: 'DELETE' }),

  grantCollectionAccess: (collectionId, accessData) =>
    request(`/collections/${collectionId}/access`, { method: 'POST', body: accessData }),
  listCollectionAccess: (collectionId) => request(`/collections/${collectionId}/access`),
  revokeCollectionAccess: (collectionId, targetType, targetId) =>
    request(`/collections/${collectionId}/access/${targetType}/${targetId}`, { method: 'DELETE' }),

  storeCollectionKey: (collectionId, keyData) =>
    request(`/collections/${collectionId}/keys`, { method: 'POST', body: keyData }),
  getCollectionKeys: (collectionId) => request(`/collections/${collectionId}/keys`),

  addCollectionItem: (collectionId, itemData) =>
    request(`/collections/${collectionId}/items`, { method: 'POST', body: itemData }),
  listCollectionItems: (collectionId) => request(`/collections/${collectionId}/items`),
  removeCollectionItem: (collectionId, itemId) =>
    request(`/collections/${collectionId}/items/${itemId}`, { method: 'DELETE' }),

  setBaseUrl: setApiBase,
  getBaseUrl: getApiBase,
  setToken: setAuthToken,
  getToken: getAuthToken,
};

export default api;
