/**
 * Local Cognito emulator adapter (VITE_AUTH_MODE=local, development only).
 * Talks to backend/local/local-auth.js through the Vite proxy (/local-auth).
 * Same interface as cognito.js.
 */

import { config } from '../../config.js';

const TOKEN_KEY = 'securevault_local_id_token';
let idToken = null;
let pendingSession = null;

function storage() {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
}

function saveToken(token) {
  idToken = token;
  try {
    if (token) storage()?.setItem(TOKEN_KEY, token);
    else storage()?.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private mode): keep the token in memory only
  }
}

function tokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

class LocalAuthError extends Error {
  constructor(name, message) {
    super(message);
    this.name = name;
  }
}

async function post(action, body = {}, withToken = false) {
  const headers = { 'content-type': 'application/json' };
  if (withToken && idToken) headers.authorization = `Bearer ${idToken}`;
  const res = await fetch(`${config.localAuthUrl}/${action}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new LocalAuthError(data.name || 'LocalAuthError', data.message || `Request failed (${res.status})`);
  return data;
}

export const localAuth = {
  mode: 'local',

  async signUp({ username, email, password, name }) {
    const data = await post('sign-up', { username, email, password, name });
    return { userSub: data.userSub, needsConfirmation: true, devCode: data.devCode };
  },

  async confirmSignUp({ username, code }) {
    await post('confirm-sign-up', { username, code });
  },

  async resendSignUpCode({ username }) {
    return post('resend-sign-up-code', { username });
  },

  async signIn({ username, password }) {
    const data = await post('sign-in', { username, password });
    if (data.nextStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
      pendingSession = data.session;
      return { status: 'TOTP_REQUIRED' };
    }
    saveToken(data.idToken);
    return { status: 'DONE' };
  },

  async confirmTotp({ code }) {
    const data = await post('confirm-sign-in', { session: pendingSession, code });
    pendingSession = null;
    saveToken(data.idToken);
    return { status: 'DONE' };
  },

  async getIdToken() {
    if (!idToken) {
      try {
        idToken = storage()?.getItem(TOKEN_KEY) || null;
      } catch {
        idToken = null;
      }
    }
    if (idToken && tokenExpired(idToken)) saveToken(null);
    return idToken;
  },

  async signOut() {
    pendingSession = null;
    saveToken(null);
  },

  async forgotPassword({ username }) {
    const data = await post('forgot-password', { username });
    return { devCode: data.devCode };
  },

  async confirmForgotPassword({ username, code, newPassword }) {
    await post('confirm-forgot-password', { username, code, newPassword });
  },

  async changePassword({ oldPassword, newPassword }) {
    await post('change-password', { oldPassword, newPassword }, true);
  },

  async setupTotp({ accountName }) {
    const data = await post('totp/setup', {}, true);
    return {
      sharedSecret: data.sharedSecret,
      otpauthUrl: `otpauth://totp/SecureVault:${encodeURIComponent(accountName)}?secret=${data.sharedSecret}&issuer=SecureVault`,
    };
  },

  async verifyTotp({ code }) {
    await post('totp/verify', { code }, true);
  },
};

export default localAuth;
