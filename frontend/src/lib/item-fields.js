/**
 * Display fields of a vault item.
 *
 * Title, username, URL, notes and tags live only inside the encrypted payload
 * (item._decrypted after client-side decryption). The server-side `metadata` holds just
 * non-sensitive flags: { favorite, collection_id }.
 */

export const UNTITLED = 'ไม่มีชื่อ';

export function itemFields(item) {
  const dec = item?._decrypted || {};
  const meta = item?.metadata || {};
  return {
    title: dec.title || UNTITLED,
    username: dec.username || '',
    url: dec.url || '',
    notes: dec.notes || '',
    password: dec.password || '',
    tags: Array.isArray(dec.tags) ? dec.tags : [],
    favorite: Boolean(meta.favorite),
    collectionId: item?._collectionId || meta.collection_id || '',
    locked: !item?._decrypted,
  };
}

/** Builds the plaintext metadata the server may see. */
export function buildMetadata({ favorite = false, collectionId = '' } = {}) {
  return {
    favorite: Boolean(favorite),
    ...(collectionId ? { collection_id: collectionId } : {}),
  };
}

export default itemFields;
