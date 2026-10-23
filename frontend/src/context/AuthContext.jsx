/**
 * SecureVault Cloud — AuthContext
 *
 * Implements Zero-Knowledge Session & Volatile Cryptographic Key Management.
 * Master Encryption Key (MEK) and decrypted RSA Private Key are STRICTLY retained
 * in volatile memory (React State) and NEVER written to localStorage, sessionStorage, or cookies.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setAuthToken } from '../services/api.js';
import ClientCrypto from '../services/crypto.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem('securevault_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Volatile cryptographic material — STRICTLY IN MEMORY
  const [mek, setMek] = useState(null);
  const [privateKey, setPrivateKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Helper to zero out memory when locking or logging out
  const wipeMemoryKeys = useCallback(() => {
    if (mek && mek instanceof Uint8Array) {
      mek.fill(0); // Zeroize buffer
    }
    setMek(null);
    setPrivateKey(null);
  }, [mek]);

  // Logout clears all credentials and wipes memory
  const logout = useCallback(() => {
    wipeMemoryKeys();
    setUser(null);
    setAuthToken(null);
    sessionStorage.removeItem('securevault_user');
    sessionStorage.removeItem('securevault_jwt');
  }, [wipeMemoryKeys]);

  // Lock vault keeps session but clears MEK from memory
  const lockVault = useCallback(() => {
    wipeMemoryKeys();
  }, [wipeMemoryKeys]);

  // Unlock vault using Master Password
  const unlockVault = useCallback(async (masterPassword) => {
    if (!user || !user.auth_salt) {
      throw new Error('User salt not available to unlock vault');
    }
    setLoading(true);
    setError(null);
    try {
      const { mek: derivedMek } = await ClientCrypto.deriveKeys(masterPassword, user.auth_salt);
      setMek(derivedMek);

      if (user.encrypted_private_key) {
        try {
          const privKey = await ClientCrypto.unprotectPrivateKey(user.encrypted_private_key, derivedMek);
          setPrivateKey(privKey);
        } catch (e) {
          console.warn('Could not decrypt private key with derived MEK:', e);
        }
      }
      return true;
    } catch (err) {
      setError(err.message || 'Failed to unlock vault');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Registration flow (UC-1)
  const register = useCallback(async ({ username, email, fullName, masterPassword, role = 'user' }) => {
    setLoading(true);
    setError(null);
    try {
      // 1. Generate account salt
      const salt = ClientCrypto.createSalt(16);

      // 2. Derive dual keys: authHash for TLS authentication and MEK for local vault encryption
      const { mek: derivedMek, authHash } = await ClientCrypto.deriveKeys(masterPassword, salt);

      // 3. Generate RSA-OAEP Key Pair for UC-10 Zero-Knowledge sharing
      const keyPair = await ClientCrypto.createKeyPair();

      // 4. Encrypt RSA private key using MEK before storing on server
      const encryptedPrivKey = await ClientCrypto.protectPrivateKey(keyPair.privateKey, derivedMek);

      // 5. Send registration payload to backend
      const response = await api.auth.register({
        username,
        email,
        fullName,
        authHash,
        authSalt: salt,
        publicKey: keyPair.publicKey,
        encryptedPrivateKey: encryptedPrivKey,
        role,
      });

      return response;
    } catch (err) {
      setError(err.message || 'Registration failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Login flow (UC-2)
  const login = useCallback(async ({ identifier, masterPassword }) => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch user's public salt
      const saltRes = await api.auth.getSalt(identifier);
      const salt = saltRes?.data?.salt;
      if (!salt) {
        throw new Error('Could not retrieve user salt');
      }

      // 2. Derive MEK and authHash locally in browser
      const { mek: derivedMek, authHash } = await ClientCrypto.deriveKeys(masterPassword, salt);

      // 3. Authenticate with server using authHash
      const loginRes = await api.auth.login({ identifier, authHash });

      // Handle MFA Challenge (UC-3)
      if (loginRes.status === 'mfa_required') {
        return {
          mfaRequired: true,
          mfaSessionToken: loginRes.mfa_session_token,
          mfaType: loginRes.mfa_type,
          pendingMek: derivedMek,
          identifier,
        };
      }

      // Success without MFA
      const token = loginRes.token;
      const userData = { ...loginRes.user, auth_salt: salt };

      setAuthToken(token);
      setUser(userData);
      sessionStorage.setItem('securevault_user', JSON.stringify(userData));

      // Retain MEK in volatile memory
      setMek(derivedMek);

      // Decrypt private key if available
      if (userData.encrypted_private_key) {
        try {
          const privKey = await ClientCrypto.unprotectPrivateKey(userData.encrypted_private_key, derivedMek);
          setPrivateKey(privKey);
        } catch (e) {
          console.warn('Failed to decrypt user private key:', e);
        }
      }

      return { success: true, user: userData };
    } catch (err) {
      setError(err.message || 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Complete MFA Login (UC-3)
  const completeMfaLogin = useCallback(async ({ mfaSessionToken, code, pendingMek, identifier }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.mfaValidate({ mfaSessionToken, token: code });
      const token = res.token;
      let userData = res.user;

      // Fetch salt if missing
      if (!userData.auth_salt && identifier) {
        try {
          const saltRes = await api.auth.getSalt(identifier);
          userData.auth_salt = saltRes?.data?.salt;
        } catch {}
      }

      setAuthToken(token);
      setUser(userData);
      sessionStorage.setItem('securevault_user', JSON.stringify(userData));

      // Retain MEK in memory
      setMek(pendingMek);

      // Decrypt private key
      if (userData.encrypted_private_key && pendingMek) {
        try {
          const privKey = await ClientCrypto.unprotectPrivateKey(userData.encrypted_private_key, pendingMek);
          setPrivateKey(privKey);
        } catch (e) {
          console.warn('Failed to decrypt user private key after MFA:', e);
        }
      }

      return { success: true, user: userData };
    } catch (err) {
      setError(err.message || 'MFA validation failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync token state on mount
  useEffect(() => {
    const token = sessionStorage.getItem('securevault_jwt');
    if (token) {
      setAuthToken(token);
    }
  }, []);

  const value = {
    user,
    setUser,
    mek,
    setMek,
    privateKey,
    setPrivateKey,
    isVaultUnlocked: Boolean(mek),
    isAuthenticated: Boolean(user),
    isAdmin: user?.role === 'admin',
    loading,
    error,
    setError,
    login,
    register,
    logout,
    lockVault,
    unlockVault,
    completeMfaLogin,
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
