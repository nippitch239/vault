/**
 * Per-item keys for vault items (see "Item Keys" in shared/crypto.js).
 *
 *   encrypted_data               payload encrypted with the item's own Item Key
 *   encrypted_item_key           Item Key wrapped with the owner's Vault Key, or with the
 *                                Collection Key when the item is in a collection
 *   encrypted_key_for_recipient  Item Key wrapped with a share recipient's public key
 *
 * Items saved before item keys existed have no encrypted_item_key; their payload is encrypted
 * directly with the Vault Key or the Collection Key, so decryption falls back to those keys.
 * The owner's next save gives such an item its own Item Key.
 */

import api from '../services/api.js';
import ClientCrypto from '../services/crypto.js';

/** Unwraps the caller's copy of a collection key; null when they have none. */
export async function fetchCollectionKey(collectionId, privateKey) {
  if (!collectionId || !privateKey) return null;
  try {
    const res = await api.collections.getKeys(collectionId);
    return await ClientCrypto.unwrapCollectionKey(res?.key?.encryptedKeyForRecipient, privateKey);
  } catch {
    return null;
  }
}

/**
 * The item's Item Key, or null (legacy item, or no key available to this user).
 * @param {object} item vault item row (optionally with encrypted_key_for_recipient from a share)
 * @param {{ mek?: Uint8Array, collectionKey?: Uint8Array, privateKey?: string }} keys
 */
export async function openItemKey(item, { mek, collectionKey, collectionKeys, privateKey } = {}) {
  if (item?.encrypted_key_for_recipient && privateKey) {
    try {
      return await ClientCrypto.unwrapItemKey(item.encrypted_key_for_recipient, privateKey);
    } catch {
      // fall through to the owner / collection copies
    }
  }
  if (item?.encrypted_item_key) {
    const candidateKeys = [];
    if (collectionKey) candidateKeys.push(collectionKey);
    if (collectionKeys) {
      if (Array.isArray(collectionKeys)) candidateKeys.push(...collectionKeys);
      else if (collectionKeys instanceof Map) candidateKeys.push(...collectionKeys.values());
      else if (collectionKeys instanceof Set) candidateKeys.push(...collectionKeys);
    }
    if (mek) candidateKeys.push(mek);

    for (const key of candidateKeys) {
      if (!key) continue;
      try {
        return await ClientCrypto.unprotectItemKey(item.encrypted_item_key, key);
      } catch {
        // wrong wrapping key, try the next one
      }
    }
  }
  return null;
}

/** Decrypts with the first key that works; null when none does. */
export async function decryptWithAny(encryptedData, keys) {
  if (!encryptedData) return null;
  for (const key of keys) {
    if (!key) continue;
    try {
      return await ClientCrypto.decryptItem(encryptedData, key);
    } catch {
      // try the next key
    }
  }
  return null;
}

/**
 * Decrypts an item: with its Item Key, else (legacy) with the Collection Key / Vault Key.
 * @returns {Promise<{ payload: object|null, itemKey: Uint8Array|null }>}
 */
export async function decryptVaultItem(item, keys = {}) {
  const itemKey = await openItemKey(item, keys);
  const candidateKeys = [itemKey];
  if (keys.collectionKey) candidateKeys.push(keys.collectionKey);
  if (keys.collectionKeys) {
    if (Array.isArray(keys.collectionKeys)) candidateKeys.push(...keys.collectionKeys);
    else if (keys.collectionKeys instanceof Map) candidateKeys.push(...keys.collectionKeys.values());
    else if (keys.collectionKeys instanceof Set) candidateKeys.push(...keys.collectionKeys);
  }
  if (keys.mek) candidateKeys.push(keys.mek);
  const payload = await decryptWithAny(item?.encrypted_data, candidateKeys);
  return { payload, itemKey };
}

/**
 * Encrypts a payload for create / update.
 *
 * Owner: keeps the existing Item Key (so shares stay readable) or creates one, and wraps it
 * with the target collection's key or the Vault Key -> { encrypted_data, encrypted_item_key }.
 * Editor (collection writer / share with 'modify'): reuses the Item Key; a legacy collection
 * item stays under the collection key -> { encrypted_data }.
 */
export async function encryptForSave(payload, { isOwner, itemKey, mek, targetCollectionKey, legacyKey }) {
  if (isOwner) {
    const wrappingKey = targetCollectionKey || mek;
    if (!wrappingKey) throw new Error('คลังรหัสผ่านถูกล็อก กรุณาปลดล็อกก่อนบันทึก');
    const key = itemKey || ClientCrypto.generateItemKey();
    return {
      encrypted_data: await ClientCrypto.encryptItem(payload, key),
      encrypted_item_key: await ClientCrypto.protectItemKey(key, wrappingKey),
    };
  }
  const key = itemKey || legacyKey;
  if (!key) throw new Error('ไม่มีคีย์ของรายการนี้ จึงบันทึกการแก้ไขไม่ได้');
  return { encrypted_data: await ClientCrypto.encryptItem(payload, key) };
}
