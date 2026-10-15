/**
 * SecureVault Cloud — Client Cryptography Service
 *
 * Implements client-side Zero-Knowledge cryptographic flows:
 * 1. Argon2id + HKDF -> KEK (memory only) + Authentication Key (Cognito password)
 * 1b. Random Vault Key wrapped by the KEK; the Vault Key encrypts items and the RSA private key
 * 2. AES-256-GCM vault payload encryption/decryption with fresh IVs
 * 3. RSA-OAEP asymmetric key generation & key wrapping for UC-10 sharing
 * 4. Password generation & entropy calculation integration
 */

import {
  deriveMasterKeys,
  generateSalt,
  encryptData,
  decryptData,
  generateAsymmetricKeyPair,
  wrapKey,
  unwrapKey,
  encryptPrivateKey,
  decryptPrivateKey,
  toBase64,
  fromBase64,
  generateRandomBytes,
  generateVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  toCognitoPassword,
  generateCollectionKey,
  wrapCollectionKey,
  unwrapCollectionKey,
} from '@vault/shared/crypto.js';

import {
  generatePassword,
  generatePassphrase,
  calculateEntropy,
  CHAR_SETS,
} from '@vault/shared/generator.js';

import {
  validateRegistration,
  validateLogin,
  validateVaultItem,
  validateShareRequest,
  validatePasswordReset,
  getErrorMessage,
} from '@vault/shared/validator.js';

export const ClientCrypto = {
  // Key Derivation
  deriveKeys: async (masterPassword, salt) => {
    return await deriveMasterKeys(masterPassword, salt);
  },

  // Vault Key layer
  createVaultKey: () => generateVaultKey(),
  wrapVaultKey: (vaultKey, kek) => wrapVaultKey(vaultKey, kek),
  unwrapVaultKey: (encryptedVaultKey, kek) => unwrapVaultKey(encryptedVaultKey, kek),
  toCognitoPassword: (authHash) => toCognitoPassword(authHash),

  createSalt: (length = 16) => {
    return generateSalt(length);
  },

  // Asymmetric Keys for Sharing (UC-10)
  createKeyPair: async () => {
    return await generateAsymmetricKeyPair();
  },

  protectPrivateKey: async (privateKey, mek) => {
    return await encryptPrivateKey(privateKey, mek);
  },

  unprotectPrivateKey: async (encryptedPrivateKey, mek) => {
    return await decryptPrivateKey(encryptedPrivateKey, mek);
  },

  // Vault Items (AES-256-GCM)
  encryptItem: async (plainPayload, mek) => {
    // Encrypts { username, password, url, notes, ... }
    return await encryptData(plainPayload, mek);
  },

  decryptItem: async (encryptedData, mek) => {
    return await decryptData(encryptedData, mek);
  },

  // Key Wrapping for Sharing
  wrapItemKey: async (itemKey, recipientPublicKey) => {
    return await wrapKey(itemKey, recipientPublicKey);
  },

  unwrapItemKey: async (wrappedKey, recipientPrivateKey) => {
    return await unwrapKey(wrappedKey, recipientPrivateKey);
  },

  generateItemKey: () => {
    return generateRandomBytes(32);
  },

  // Collections Cryptography (M2/M3: R2)
  generateCollectionKey: () => {
    return generateCollectionKey();
  },

  wrapCollectionKey: async (collectionKey, recipientPublicKey) => {
    return await wrapCollectionKey(collectionKey, recipientPublicKey);
  },

  unwrapCollectionKey: async (wrappedKey, recipientPrivateKey) => {
    return await unwrapCollectionKey(wrappedKey, recipientPrivateKey);
  },

  encryptCollectionItem: (plainPayload, collectionKey, options = {}) => encryptData(plainPayload, collectionKey, options),

  decryptCollectionItem: (encryptedPayload, collectionKey, options = {}) => decryptData(encryptedPayload, collectionKey, options),

  // Password Generator & Entropy
  generateSecurePassword: (options) => {
    return generatePassword(options);
  },

  generateSecurePassphrase: (options) => {
    return generatePassphrase(options);
  },

  calculateStrength: (pwd, isPassphrase) => {
    return calculateEntropy(pwd, isPassphrase);
  },

  // Validation
  validators: {
    validateRegistration,
    validateLogin,
    validateVaultItem,
    validateShareRequest,
    validatePasswordReset,
    getErrorMessage,
  },

  // Helpers
  toBase64,
  fromBase64,
  CHAR_SETS,
};

export default ClientCrypto;
