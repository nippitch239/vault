/**
 * SecureVault Cloud — API Client Service
 *
 * Implements isomorphic HTTP requests to API Gateway v2 / Lambda endpoints.
 * Handles token management, authentication headers, error serialization, and file downloads.
 */

let customApiBase = null;

export const setApiBase = (url) => {
  customApiBase = url;
};

export const getApiBase = () => {
  if (customApiBase) return customApiBase;
  if (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) {
    return process.env.VITE_API_BASE_URL;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  return '/api/v1';
};

class ApiError extends Error {
  constructor(message, status = 500, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// Token holder in memory with optional sessionStorage fallback for JWT (never MEK!)
let authToken =
  typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('securevault_jwt') : null;

export const setAuthToken = (token) => {
  authToken = token;
  if (typeof sessionStorage !== 'undefined') {
    if (token) {
      sessionStorage.setItem('securevault_jwt', token);
    } else {
      sessionStorage.removeItem('securevault_jwt');
    }
  }
};

export const getAuthToken = () => authToken;

async function request(endpoint, options = {}) {
  const base = getApiBase();
  const url = endpoint.startsWith('http') ? endpoint : `${base}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const config = {
    method: options.method || 'GET',
    headers,
    ...options,
  };

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, config);

    // Handle CSV or text responses
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      if (!response.ok) {
        throw new ApiError(`Request failed with status ${response.status}`, response.status);
      }
      return await response.text();
    }

    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const errorMsg = data?.message || data?.error || `Request failed with status ${response.status}`;
      throw new ApiError(errorMsg, response.status, data);
    }

    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.message || 'Network error occurred', 0, err);
  }
}

export const api = {
  // Authentication (UC-1, UC-2, UC-3, UC-7)
  auth: {
    register: (userData) => request('/auth/register', { method: 'POST', body: userData }),

    getSalt: (identifier) => {
      const isEmail = identifier.includes('@');
      const param = isEmail ? `email=${encodeURIComponent(identifier)}` : `username=${encodeURIComponent(identifier)}`;
      return request(`/auth/salt?${param}`);
    },

    login: ({ identifier, authHash }) => {
      const isEmail = identifier.includes('@');
      const body = {
        auth_hash: authHash,
        ...(isEmail ? { email: identifier } : { username: identifier }),
      };
      return request('/auth/login', { method: 'POST', body });
    },

    mfaSetup: () => request('/auth/mfa/setup', { method: 'POST' }),

    mfaVerify: (token) => request('/auth/mfa/verify', { method: 'POST', body: { token } }),

    mfaValidate: ({ mfaSessionToken, token }) =>
      request('/auth/mfa/validate', {
        method: 'POST',
        body: { mfa_session_token: mfaSessionToken, token },
      }),

    resetPasswordRequest: (email) =>
      request('/auth/reset-password/request', { method: 'POST', body: { email } }),

    resetPasswordConfirm: ({ email, otpCode, newAuthHash, newAuthSalt }) =>
      request('/auth/reset-password/confirm', {
        method: 'POST',
        body: {
          email,
          otp_code: otpCode,
          new_auth_hash: newAuthHash,
          new_auth_salt: newAuthSalt,
        },
      }),
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
    lookupUser: (email) => request(`/users/lookup?email=${encodeURIComponent(email)}`),

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
    storeKey: (collectionId, keyData) =>
      request(`/collections/${collectionId}/keys`, { method: 'POST', body: keyData }),

    // Collection Items Association (M3: R1)
    listItems: (collectionId) => request(`/collections/${collectionId}/items`),
    addItem: (collectionId, itemData) =>
      request(`/collections/${collectionId}/items`, { method: 'POST', body: itemData }),
    removeItem: (collectionId, itemId) =>
      request(`/collections/${collectionId}/items/${itemId}`, { method: 'DELETE' }),
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
