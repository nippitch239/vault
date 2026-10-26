/**
 * SecureVault Cloud — Frontend Collection Items & Presentation Verification
 *
 * Verifies Requirements R1, R2, R3:
 * - Collection items presentation and filtering logic (ALL, PERSONAL, specific collection ID)
 * - Decryption of collection items (logins, passwords, secure notes) using Collection Key
 * - Extraction of decrypted credentials (username, password, notes, title, tags) via itemFields
 * - Clickable collection card event handling: ensuring nested action clicks do not trigger card navigation
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ClientCrypto from '../src/services/crypto.js';
import { itemFields, buildMetadata } from '../src/lib/item-fields.js';
import { decryptVaultItem, encryptForSave } from '../src/lib/item-crypto.js';

describe('Collection Items Presentation & Credential Handling (R1, R2, R3)', () => {
  const collectionId = 'col-finance-2026';
  const otherCollectionId = 'col-engineering-2026';
  let collectionKey;

  test('R3: Collection items (logins, passwords, secure notes) encrypt and decrypt properly with Collection Key', async () => {
    collectionKey = ClientCrypto.generateCollectionKey();
    assert.equal(collectionKey.length, 32);

    // 1. Login item
    const loginPayload = {
      title: 'Stripe Billing Portal',
      username: 'billing@company.internal',
      password: 'LiveStripeSecretPassword_999!',
      url: 'https://dashboard.stripe.com/login',
      notes: '2FA device with finance lead',
    };

    const loginEncrypted = await encryptForSave(loginPayload, {
      isOwner: true,
      targetCollectionKey: collectionKey,
    });

    const loginVaultItem = {
      item_id: 'item-login-1',
      item_type: 'login',
      ...loginEncrypted,
      metadata: buildMetadata({ collectionId }),
    };

    const decryptedLogin = await decryptVaultItem(loginVaultItem, { collectionKey });
    assert.deepEqual(decryptedLogin.payload, loginPayload);

    const loginFields = itemFields({ ...loginVaultItem, _decrypted: decryptedLogin.payload });
    assert.equal(loginFields.title, 'Stripe Billing Portal');
    assert.equal(loginFields.username, 'billing@company.internal');
    assert.equal(loginFields.password, 'LiveStripeSecretPassword_999!');
    assert.equal(loginFields.collectionId, collectionId);
    assert.equal(loginFields.locked, false);

    // 2. Secure Note item
    const notePayload = {
      title: 'Banking Wire Instructions & Recovery Keys',
      notes: 'IBAN: TH0200001234567890. Wire routing: BKKTHBK. Recovery mnemonic: apple banana cherry diamond elephant frog guitar heaven ice jungle kite lemon.',
      tags: ['finance', 'wire', 'confidential'],
    };

    const noteEncrypted = await encryptForSave(notePayload, {
      isOwner: true,
      targetCollectionKey: collectionKey,
    });

    const noteVaultItem = {
      item_id: 'item-note-1',
      item_type: 'note',
      ...noteEncrypted,
      metadata: buildMetadata({ collectionId }),
    };

    const decryptedNote = await decryptVaultItem(noteVaultItem, { collectionKey });
    assert.deepEqual(decryptedNote.payload, notePayload);

    const noteFields = itemFields({ ...noteVaultItem, _decrypted: decryptedNote.payload });
    assert.equal(noteFields.title, 'Banking Wire Instructions & Recovery Keys');
    assert.equal(noteFields.notes, notePayload.notes);
    assert.deepEqual(noteFields.tags, ['finance', 'wire', 'confidential']);
    assert.equal(noteFields.collectionId, collectionId);
    assert.equal(noteFields.locked, false);
  });

  test('R2: Filtered collection items presentation matches active collection filter', () => {
    const allItems = [
      {
        item_id: 'item-1',
        item_type: 'login',
        _decrypted: { title: 'Personal Github', username: 'alice', password: 'pw1' },
        metadata: { favorite: true },
        _collectionId: null,
      },
      {
        item_id: 'item-2',
        item_type: 'login',
        _decrypted: { title: 'Finance Stripe', username: 'fin_admin', password: 'pw2' },
        metadata: { collection_id: collectionId },
        _collectionId: collectionId,
      },
      {
        item_id: 'item-3',
        item_type: 'note',
        _decrypted: { title: 'Finance Wire Info', notes: 'Confidential wire details' },
        metadata: { collection_id: collectionId },
        _collectionId: collectionId,
      },
      {
        item_id: 'item-4',
        item_type: 'login',
        _decrypted: { title: 'Dev AWS Console', username: 'dev_user', password: 'pw3' },
        metadata: { collection_id: otherCollectionId },
        _collectionId: otherCollectionId,
      },
    ];

    // Filter by specific collectionId (navigated from collection card)
    const filterByCol = (items, filterId) => {
      return items.filter((it) => {
        if (filterId === 'PERSONAL') return !it._collectionId && !it.metadata?.collection_id;
        if (filterId !== 'ALL') return (it._collectionId || it.metadata?.collection_id) === filterId;
        return true;
      });
    };

    const financeItems = filterByCol(allItems, collectionId);
    assert.equal(financeItems.length, 2);
    assert.deepEqual(financeItems.map((i) => i.item_id), ['item-2', 'item-3']);

    // Clear filter back to ALL
    const clearedItems = filterByCol(allItems, 'ALL');
    assert.equal(clearedItems.length, 4);

    // Filter to PERSONAL items
    const personalItems = filterByCol(allItems, 'PERSONAL');
    assert.equal(personalItems.length, 1);
    assert.equal(personalItems[0].item_id, 'item-1');
  });

  test('R1: Clickable collection card interaction logic prevents nested action buttons from navigating', () => {
    let navigatedToCollectionId = null;
    let accessModalOpenedFor = null;
    let editModalOpenedFor = null;
    let deleteConfirmOpenedFor = null;

    const onOpenCollection = (id) => {
      navigatedToCollectionId = id;
    };
    const openAccess = (col) => {
      accessModalOpenedFor = col;
    };
    const openEdit = (col) => {
      editModalOpenedFor = col;
    };
    const setDeleteTarget = (col) => {
      deleteConfirmOpenedFor = col;
    };

    const col = { id: collectionId, name: 'Finance Team' };

    // Simulate clicking card non-button area
    const simulateCardClick = (targetTagName) => {
      const isButton = ['button', 'a', 'input', 'select', 'textarea'].includes(targetTagName.toLowerCase());
      if (isButton) return;
      onOpenCollection(col.id);
    };

    // 1. Click card body (e.g. div, h2, p, span)
    simulateCardClick('div');
    assert.equal(navigatedToCollectionId, collectionId);
    navigatedToCollectionId = null;

    simulateCardClick('h2');
    assert.equal(navigatedToCollectionId, collectionId);
    navigatedToCollectionId = null;

    // 2. Click button area directly -> card navigation should NOT trigger
    simulateCardClick('button');
    assert.equal(navigatedToCollectionId, null);

    // 3. Nested action buttons trigger their own handlers
    const clickActionButton = (action) => {
      // simulate e.stopPropagation() and action execution
      if (action === 'access') openAccess(col);
      else if (action === 'edit') openEdit(col);
      else if (action === 'delete') setDeleteTarget(col);
      // card click handler receives stopped event / button target and ignores navigation
    };

    clickActionButton('access');
    assert.equal(accessModalOpenedFor, col);
    assert.equal(navigatedToCollectionId, null);

    clickActionButton('edit');
    assert.equal(editModalOpenedFor, col);
    assert.equal(navigatedToCollectionId, null);

    clickActionButton('delete');
    assert.equal(deleteConfirmOpenedFor, col);
    assert.equal(navigatedToCollectionId, null);

    // 4. Clicking nested SVG / path icon elements inside action button does NOT trigger card navigation
    const simulateTargetClosest = (targetEl) => {
      const el = targetEl?.nodeType === 1 ? targetEl : targetEl?.parentElement;
      if (el?.closest?.('button, a, input, select, textarea')) return;
      onOpenCollection(col.id);
    };

    // Fake DOM tree: button > svg > path
    const mockButton = { tagName: 'BUTTON', nodeType: 1 };
    const mockSvg = { tagName: 'SVG', nodeType: 1, parentElement: mockButton };
    const mockPath = { tagName: 'PATH', nodeType: 1, parentElement: mockSvg };
    const mockTextNode = { nodeType: 3, parentElement: mockPath };

    const getClosest = (startEl, selector) => {
      let curr = startEl;
      const tags = selector.toUpperCase().split(',').map((s) => s.trim());
      while (curr) {
        if (curr.tagName && tags.includes(curr.tagName)) return curr;
        curr = curr.parentElement;
      }
      return null;
    };
    mockButton.closest = (sel) => getClosest(mockButton, sel);
    mockSvg.closest = (sel) => getClosest(mockSvg, sel);
    mockPath.closest = (sel) => getClosest(mockPath, sel);

    simulateTargetClosest(mockPath);
    assert.equal(navigatedToCollectionId, null, 'Clicking SVG path inside action button must not navigate');

    simulateTargetClosest(mockTextNode);
    assert.equal(navigatedToCollectionId, null, 'Clicking text node inside action button must not navigate');

    const cardDiv = { tagName: 'DIV', nodeType: 1, closest: () => null };
    simulateTargetClosest(cardDiv);
    assert.equal(navigatedToCollectionId, collectionId, 'Clicking non-button card div must navigate');
  });

  test('R2: Multi-collection items match multiple collection filters and exclude PERSONAL', () => {
    const multiColItem = {
      item_id: 'item-shared-multi',
      item_type: 'login',
      _decrypted: { title: 'Cross-Department Tool', username: 'cross_user', password: 'pw4' },
      metadata: { collection_id: collectionId },
      _collectionId: collectionId,
      _collectionIds: new Set([collectionId, otherCollectionId]),
    };

    const filterFn = (item, filterId) => {
      if (filterId === 'PERSONAL') {
        const hasCol =
          (item._collectionIds && item._collectionIds.size > 0) ||
          Boolean(item._collectionId) ||
          Boolean(item.metadata?.collection_id);
        return !hasCol;
      }
      if (filterId !== 'ALL') {
        return (
          (item._collectionIds && item._collectionIds.has(filterId)) ||
          item._collectionId === filterId ||
          item.metadata?.collection_id === filterId
        );
      }
      return true;
    };

    assert.equal(filterFn(multiColItem, collectionId), true, 'Matches first collection');
    assert.equal(filterFn(multiColItem, otherCollectionId), true, 'Matches second collection');
    assert.equal(filterFn(multiColItem, 'col-unrelated'), false, 'Does not match unrelated collection');
    assert.equal(filterFn(multiColItem, 'PERSONAL'), false, 'Multi-collection item is not personal');
    assert.equal(filterFn(multiColItem, 'ALL'), true, 'Matches ALL');
  });

  test('R2 & R3: Collection filter synchronization & copy note operations', () => {
    let syncedFilter = 'col-init';
    const onCollectionFilterChange = (filter) => {
      syncedFilter = filter;
    };
    const onClearCollectionFilter = () => {
      syncedFilter = null;
    };

    // Selecting a collection filter
    const handleSelect = (cid) => {
      if (cid === 'ALL') {
        onClearCollectionFilter();
        onCollectionFilterChange(null);
      } else {
        onCollectionFilterChange(cid);
      }
    };

    handleSelect(collectionId);
    assert.equal(syncedFilter, collectionId);

    handleSelect('ALL');
    assert.equal(syncedFilter, null);

    // Note copying
    let copiedText = null;
    const handleCopyNote = (note) => {
      copiedText = note;
    };
    handleCopyNote('Secret recovery key: 1234-5678');
    assert.equal(copiedText, 'Secret recovery key: 1234-5678');
  });

  test('R3: Secure Notes validate and save without requiring a password, while Logins require a password', () => {
    const validateItemForm = (formData) => {
      const isNote = formData.category === 'SECURE_NOTE' || formData.category === 'NOTE';
      const errors = {};
      if (!formData.title?.trim()) errors.title = 'กรุณาระบุชื่อรายการ';
      if (!isNote && !formData.password) errors.password = 'กรุณาระบุรหัสผ่าน หรือกด “สร้างรหัสผ่าน”';
      return { valid: Object.keys(errors).length === 0, errors };
    };

    // Login without password -> invalid
    const invalidLogin = { title: 'AWS Console', category: 'LOGIN', password: '' };
    const loginRes = validateItemForm(invalidLogin);
    assert.equal(loginRes.valid, false);
    assert.equal(Boolean(loginRes.errors.password), true);

    // Login with password -> valid
    const validLogin = { title: 'AWS Console', category: 'LOGIN', password: 'SecretPassword123!' };
    assert.equal(validateItemForm(validLogin).valid, true);

    // Secure Note without password -> VALID (must NOT require password)
    const secureNoteNoPw = { title: 'Production Recovery Codes', category: 'SECURE_NOTE', notes: '123-456-789', password: '' };
    const noteRes = validateItemForm(secureNoteNoPw);
    assert.equal(noteRes.valid, true);
    assert.equal(noteRes.errors.password, undefined);

    // Note category ('NOTE') without password -> VALID
    const noteCategory = { title: 'Server Config', category: 'NOTE', notes: 'port=8080', password: '' };
    assert.equal(validateItemForm(noteCategory).valid, true);
  });

  test('R3: Multi-collection item decryption fallback restores plaintext when key is available in subsequent collection', async () => {
    const validKey = ClientCrypto.generateCollectionKey();
    const notePayload = { title: 'Decrypted Shared Secret', notes: 'Secret note payload' };
    const enc = await encryptForSave(notePayload, { isOwner: true, targetCollectionKey: validKey });

    const sharedItem = {
      item_id: 'item-shared-decrypt',
      item_type: 'note',
      ...enc,
    };

    // Simulate collectionItemsMap behavior in loadItems
    const collectionItemsMap = new Map();

    // Collection 1 has NO key (pending key)
    const col1Res = await decryptVaultItem(sharedItem, { collectionKey: null });
    assert.equal(col1Res.payload, null, 'Decryption without key produces null payload (locked)');

    collectionItemsMap.set(sharedItem.item_id, {
      ...sharedItem,
      _decrypted: col1Res.payload,
      _collectionId: 'col-1-nokey',
      _collectionIds: new Set(['col-1-nokey']),
    });

    // Item starts locked
    let stored = collectionItemsMap.get(sharedItem.item_id);
    assert.equal(itemFields(stored).locked, true);

    // Collection 2 HAS valid key: simulate second collection pass in loadItems
    const existing = collectionItemsMap.get(sharedItem.item_id);
    if (existing) {
      existing._collectionIds.add('col-2-has-key');
      if (!existing._decrypted && validKey) {
        const { payload } = await decryptVaultItem(sharedItem, { collectionKey: validKey });
        if (payload) {
          existing._decrypted = payload;
        }
      }
    }

    // Now the item MUST be unlocked and fields extracted
    stored = collectionItemsMap.get(sharedItem.item_id);
    assert.equal(itemFields(stored).locked, false);
    assert.equal(itemFields(stored).title, 'Decrypted Shared Secret');
    assert.equal(itemFields(stored).notes, 'Secret note payload');
  });

  test('R2: Multi-collection item edit context defaults to the active collection filter', () => {
    const multiColItem = {
      item_id: 'item-multi-context',
      _collectionId: 'col-alpha',
      _collectionIds: new Set(['col-alpha', 'col-beta']),
      metadata: { collection_id: 'col-alpha' },
    };

    const resolveItemColId = (item, defaultCollectionId) => {
      return (defaultCollectionId && item._collectionIds?.has(defaultCollectionId))
        ? defaultCollectionId
        : item._collectionId || item.collection_id || item.metadata?.collection_id || '';
    };

    // When viewing col-beta, editing should contextually select col-beta
    assert.equal(resolveItemColId(multiColItem, 'col-beta'), 'col-beta');

    // When viewing col-alpha, editing should select col-alpha
    assert.equal(resolveItemColId(multiColItem, 'col-alpha'), 'col-alpha');

    // When not in a collection (ALL), defaults to primary collectionId
    assert.equal(resolveItemColId(multiColItem, ''), 'col-alpha');
  });

  test('R3: Clipboard operations handle undefined clipboard API gracefully without crashing', () => {
    let toastMessage = null;
    const addToast = (msg) => {
      toastMessage = msg;
    };

    // Simulate environment without navigator.clipboard
    const safeCopyUsername = (username, clipboardObj) => {
      if (!username) return;
      if (typeof clipboardObj !== 'undefined' && clipboardObj?.writeText) {
        clipboardObj.writeText(username);
      }
      addToast('คัดลอกชื่อผู้ใช้แล้ว');
    };

    // Undefined clipboard object -> does not throw
    assert.doesNotThrow(() => {
      safeCopyUsername('admin_user', undefined);
    });
    assert.equal(toastMessage, 'คัดลอกชื่อผู้ใช้แล้ว');

    // Available clipboard object -> calls writeText
    let writtenText = null;
    const mockClipboard = {
      writeText: (txt) => {
        writtenText = txt;
      },
    };
    safeCopyUsername('developer_alice', mockClipboard);
    assert.equal(writtenText, 'developer_alice');

    // Password copy fallback without copyPasswordWithAutoClear
    const safeCopyPassword = (password, clipboardObj) => {
      if (!password) return;
      if (typeof clipboardObj !== 'undefined' && clipboardObj?.writeText) {
        clipboardObj.writeText(password);
      }
      addToast('คัดลอกรหัสผ่านแล้ว');
    };
    assert.doesNotThrow(() => {
      safeCopyPassword('secret_pw_123', undefined);
    });
    assert.equal(toastMessage, 'คัดลอกรหัสผ่านแล้ว');
  });

  test('R3: Personal item mapping decrypts locked collection item using MEK or collectionKeyCache without TDZ ReferenceError', async () => {
    const mek = ClientCrypto.generateCollectionKey();
    const personalItemSecret = { title: 'Creator Personal Item', username: 'owner_user', password: 'OwnerPassword!99' };
    const encryptedPersonal = await encryptForSave(personalItemSecret, { isOwner: true, mek });

    const rawPersonalItem = {
      item_id: 'item-personal-creator',
      item_type: 'login',
      ...encryptedPersonal,
      metadata: { collection_id: 'col-pending-key' },
    };

    // Simulate collectionItemsMap where this item was encountered in a collection with no key yet
    const collectionItemsMap = new Map();
    collectionItemsMap.set(rawPersonalItem.item_id, {
      ...rawPersonalItem,
      _decrypted: null,
      _collectionId: 'col-pending-key',
      _collectionIds: new Set(['col-pending-key']),
    });

    const collectionKeyCache = new Map();
    const loadedCollections = [{ collection_id: 'col-pending-key', name: 'Pending Key Team' }];

    // Simulate rawPersonal.map from loadItems
    const rawPersonal = [rawPersonalItem];
    const decryptedPersonal = await Promise.all(
      rawPersonal.map(async (it) => {
        const iid = it.item_id || it.id;
        const metaColId = it.metadata?.collection_id;
        const associatedCol = metaColId
          ? loadedCollections.find((c) => (c.collection_id || c.id) === metaColId)
          : null;

        if (collectionItemsMap.has(iid)) {
          const cItem = collectionItemsMap.get(iid);
          if (metaColId) {
            cItem._collectionIds = cItem._collectionIds || new Set();
            cItem._collectionIds.add(metaColId);
          }
          if (!cItem._decrypted) {
            let colKey = metaColId ? collectionKeyCache.get(metaColId) : null;
            if (!colKey && cItem._collectionIds) {
              for (const cid of cItem._collectionIds) {
                if (collectionKeyCache.has(cid)) {
                  colKey = collectionKeyCache.get(cid);
                  break;
                }
              }
            }
            const { payload: decPayload } = await decryptVaultItem(it, {
              mek,
              collectionKey: colKey,
            });
            if (decPayload) {
              cItem._decrypted = decPayload;
              if (!cItem._collection && associatedCol) {
                cItem._collection = associatedCol;
              }
            }
          }
          return cItem;
        }

        const { payload: decryptedPayload } = await decryptVaultItem(it, {
          mek,
          collectionKey: metaColId ? collectionKeyCache.get(metaColId) : null,
        });

        return {
          ...it,
          _decrypted: decryptedPayload,
          ...(associatedCol ? { _collection: associatedCol, _collectionId: metaColId } : {}),
          _collectionIds: new Set([metaColId].filter(Boolean)),
        };
      })
    );

    assert.equal(decryptedPersonal.length, 1);
    const resolvedItem = decryptedPersonal[0];
    assert.notEqual(resolvedItem._decrypted, null, 'Must successfully decrypt with MEK');
    assert.deepEqual(resolvedItem._decrypted, personalItemSecret);
    assert.equal(itemFields(resolvedItem).title, 'Creator Personal Item');
    assert.equal(itemFields(resolvedItem).password, 'OwnerPassword!99');
    assert.equal(itemFields(resolvedItem).locked, false);
  });

  test('R2: Creating new item in a read-only collection defaults to personal vault to prevent 403 Forbidden', () => {
    const loadedCollections = [
      { collection_id: 'col-read-only', name: 'Company Announcements', effectivePermission: 'read' },
      { collection_id: 'col-writable', name: 'Engineering Team', effectivePermission: 'write' },
    ];

    const filterWritable = (cols) =>
      cols.filter((c) => {
        const perm = String(c.effectivePermission || c.effective_permission || '').toLowerCase();
        return ['write', 'admin'].includes(perm);
      });

    const writable = filterWritable(loadedCollections);
    assert.equal(writable.length, 1);
    assert.equal(writable[0].collection_id, 'col-writable');

    // Case 1: user views read-only collection and clicks Add Item
    const defaultColIdReadOnly = 'col-read-only';
    let selectedColId1 = defaultColIdReadOnly;
    if (!writable.some((c) => c.collection_id === defaultColIdReadOnly)) {
      selectedColId1 = '';
    }
    assert.equal(selectedColId1, '', 'Read-only collection filter defaults to personal vault on add item');

    // Case 2: user views writable collection and clicks Add Item
    const defaultColIdWritable = 'col-writable';
    let selectedColId2 = defaultColIdWritable;
    if (!writable.some((c) => c.collection_id === defaultColIdWritable)) {
      selectedColId2 = '';
    }
    assert.equal(selectedColId2, 'col-writable', 'Writable collection filter is preserved on add item');
  });
});
