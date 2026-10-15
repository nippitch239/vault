/**
 * SecureVault Cloud — AuthContext
 *
 * Sign-in is done against Amazon Cognito (services/auth). Key hierarchy, all client side:
 *
 *   master password + kdf_salt --Argon2id--> Master Key --HKDF--> KEK + Authentication Key
 *   Authentication Key -> Cognito password (server never sees the master password)
 *   KEK --unwraps--> random Vault Key (users.encrypted_vault_key)
 *   Vault Key --decrypts--> RSA private key and personal vault items
 *
 * The KEK, Vault Key and private key live only in React state / refs (memory) and are
 * never written to localStorage, sessionStorage or cookies. The non-secret profile
 * (salt, encrypted keys, username) is cached in sessionStorage so a page reload shows the
 * "vault locked" screen instead of logging the user out.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api, { setUnauthorizedHandler } from '../services/api.js';
import ClientCrypto from '../services/crypto.js';
import { getAuth, describeAuthError } from '../services/auth/index.js';
import { config } from '../config.js';

const AuthContext = createContext(null);
const PROFILE_CACHE_KEY = 'securevault_user';

function readCachedProfile() {
  try {
    const saved = sessionStorage.getItem(PROFILE_CACHE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function cacheProfile(profile) {
  try {
    if (profile) sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    else sessionStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    // storage unavailable: the user will simply need to sign in again after a reload
  }
}

function friendlyError(err) {
  if (err?.name === 'ApiError') return err.message;
  if (err?.code === 'DECRYPT_FAILED') {
    return 'ไม่สามารถถอดรหัสคลังรหัสผ่านได้ รหัสผ่านหลักไม่ถูกต้อง หรือคีย์ของบัญชีถูกรีเซ็ตแล้ว';
  }
  return describeAuthError(err);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readCachedProfile);
  const [vaultKey, setVaultKey] = useState(null);
  const [privateKey, setPrivateKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Holds the KEK + context between sign-in and the TOTP challenge (memory only).
  const pendingLoginRef = useRef(null);
  // Full name typed at sign-up, used to create the vault profile on first sign-in.
  const pendingFullNameRef = useRef(new Map());

  const wipeMemoryKeys = useCallback(() => {
    setVaultKey((current) => {
      if (current instanceof Uint8Array) current.fill(0);
      return null;
    });
    setPrivateKey(null);
    pendingLoginRef.current = null;
  }, []);

  const logout = useCallback(async () => {
    wipeMemoryKeys();
    setUser(null);
    cacheProfile(null);
    try {
      const auth = await getAuth();
      await auth.signOut();
    } catch {
      // already signed out
    }
  }, [wipeMemoryKeys]);

  const lockVault = useCallback(() => {
    wipeMemoryKeys();
  }, [wipeMemoryKeys]);

  // Expired / revoked Cognito session -> back to the sign-in screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
      setError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // On reload: keep the cached profile only if the Cognito session is still valid.
  useEffect(() => {
    let cancelled = false;
    if (!user) return undefined;
    (async () => {
      const auth = await getAuth();
      const token = await auth.getIdToken().catch(() => null);
      if (!token && !cancelled) {
        setUser(null);
        cacheProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Opens the vault after Cognito accepted the Authentication Key:
   * loads (or, on first sign-in, creates) the profile and unwraps the Vault Key.
   */
  const openVault = useCallback(async ({ kek, salt, identifier }) => {
    let profile;
    try {
      profile = (await api.users.me()).data;
    } catch (err) {
      if (err?.code !== 'PROFILE_NOT_FOUND') throw err;
      profile = null;
    }

    let unlockedVaultKey;
    let unlockedPrivateKey;
    if (!profile) {
      // First sign-in after sign-up: create the key hierarchy.
      unlockedVaultKey = ClientCrypto.createVaultKey();
      const keyPair = await ClientCrypto.createKeyPair();
      unlockedPrivateKey = keyPair.privateKey;
      const fullName = pendingFullNameRef.current.get(identifier.toLowerCase()) || identifier;
      profile = (
        await api.users.createMe({
          full_name: fullName,
          kdf_salt: salt,
          public_key: keyPair.publicKey,
          encrypted_private_key: await ClientCrypto.protectPrivateKey(keyPair.privateKey, unlockedVaultKey),
          encrypted_vault_key: await ClientCrypto.wrapVaultKey(unlockedVaultKey, kek),
        })
      ).data;
      pendingFullNameRef.current.delete(identifier.toLowerCase());
    } else {
      unlockedVaultKey = await ClientCrypto.unwrapVaultKey(profile.encrypted_vault_key, kek);
      unlockedPrivateKey = await ClientCrypto.unprotectPrivateKey(profile.encrypted_private_key, unlockedVaultKey);
    }

    setVaultKey(unlockedVaultKey);
    setPrivateKey(unlockedPrivateKey);
    setUser(profile);
    cacheProfile(profile);
    api.auth.recordSession().catch(() => {});
    return profile;
  }, []);

  // UC-1: sign-up. The vault profile is created on the first successful sign-in.
  const register = useCallback(async ({ username, email, fullName, masterPassword }) => {
    setLoading(true);
    setError(null);
    try {
      const salt = (await api.auth.getSalt(username)).data.salt;
      const { authHash } = await ClientCrypto.deriveKeys(masterPassword, salt);
      const auth = await getAuth();
      const res = await auth.signUp({
        username,
        email,
        name: fullName,
        password: ClientCrypto.toCognitoPassword(authHash),
      });
      pendingFullNameRef.current.set(username.toLowerCase(), fullName);
      return res;
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const confirmRegistration = useCallback(async ({ username, code }) => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuth();
      await auth.confirmSignUp({ username, code });
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const resendConfirmation = useCallback(async ({ username }) => {
    const auth = await getAuth();
    return auth.resendSignUpCode({ username });
  }, []);

  // UC-2: sign-in
  const login = useCallback(
    async ({ identifier, masterPassword }) => {
      setLoading(true);
      setError(null);
      try {
        const salt = (await api.auth.getSalt(identifier)).data.salt;
        const { kek, authHash } = await ClientCrypto.deriveKeys(masterPassword, salt);
        const auth = await getAuth();
        const result = await auth.signIn({ username: identifier, password: ClientCrypto.toCognitoPassword(authHash) });

        if (result.status === 'TOTP_REQUIRED') {
          pendingLoginRef.current = { kek, salt, identifier };
          return { mfaRequired: true, mfaType: 'totp' };
        }
        if (result.status === 'CONFIRM_SIGN_UP') {
          return { confirmationRequired: true, identifier };
        }
        if (result.status !== 'DONE') {
          throw new Error('ขั้นตอนการเข้าสู่ระบบนี้ยังไม่รองรับ กรุณาติดต่อผู้ดูแลระบบ');
        }
        const profile = await openVault({ kek, salt, identifier });
        return { success: true, user: profile };
      } catch (err) {
        if (err?.name === 'UserNotConfirmedException') {
          return { confirmationRequired: true, identifier };
        }
        setError(friendlyError(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [openVault]
  );

  // UC-3: TOTP challenge during sign-in
  const completeMfaLogin = useCallback(
    async ({ code }) => {
      const pending = pendingLoginRef.current;
      if (!pending) throw new Error('ไม่พบขั้นตอนการเข้าสู่ระบบที่รอยืนยัน กรุณาเข้าสู่ระบบใหม่');
      setLoading(true);
      setError(null);
      try {
        const auth = await getAuth();
        const result = await auth.confirmTotp({ code });
        if (result.status !== 'DONE') throw new Error('การยืนยันตัวตนไม่สำเร็จ');
        pendingLoginRef.current = null;
        const profile = await openVault(pending);
        return { success: true, user: profile };
      } catch (err) {
        setError(friendlyError(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [openVault]
  );

  // Unlock after "lock vault" or a page reload (Cognito session still valid).
  const unlockVault = useCallback(
    async (masterPassword) => {
      if (!user?.kdf_salt) throw new Error('ไม่พบข้อมูลบัญชี กรุณาเข้าสู่ระบบใหม่');
      setLoading(true);
      setError(null);
      try {
        const { kek } = await ClientCrypto.deriveKeys(masterPassword, user.kdf_salt);
        const unlockedVaultKey = await ClientCrypto.unwrapVaultKey(user.encrypted_vault_key, kek);
        setVaultKey(unlockedVaultKey);
        setPrivateKey(await ClientCrypto.unprotectPrivateKey(user.encrypted_private_key, unlockedVaultKey));
        return true;
      } catch (err) {
        const message = err?.code === 'DECRYPT_FAILED' ? 'รหัสผ่านหลักไม่ถูกต้อง' : friendlyError(err);
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  // UC-3: TOTP enrolment
  const setupTotp = useCallback(async () => {
    const auth = await getAuth();
    return auth.setupTotp({ accountName: user?.email || user?.username || 'SecureVault' });
  }, [user]);

  const verifyTotp = useCallback(
    async ({ code }) => {
      const auth = await getAuth();
      await auth.verifyTotp({ code });
      const updated = (await api.users.updateMe({ mfa_enabled: true })).data;
      setUser(updated);
      cacheProfile(updated);
    },
    []
  );

  const value = {
    user,
    vaultKey,
    // Older components call the item key "mek"; it is the Vault Key.
    mek: vaultKey,
    privateKey,
    isVaultUnlocked: Boolean(vaultKey),
    isAuthenticated: Boolean(user),
    isAdmin: user?.role === 'admin',
    authMode: config.authMode,
    loading,
    error,
    setError,
    login,
    register,
    confirmRegistration,
    resendConfirmation,
    completeMfaLogin,
    logout,
    lockVault,
    unlockVault,
    setupTotp,
    verifyTotp,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
