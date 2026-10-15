# SecureVault API contract

Single source of truth for `frontend/src/services/api.js` and `backend/src/router.js`.
Change this file in the same commit as any route change.

## Conventions

| | |
|---|---|
| Base URL | `VITE_API_URL` = `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/api/v1` (local: `/api/v1` via the Vite proxy). Routes also answer without the `/api/v1` prefix. |
| Gateway | API Gateway **REST API**, one `{proxy+}` resource → Lambda proxy integration. AWS WAF is attached to the stage. |
| Auth | `Authorization: Bearer <Cognito ID token>`. API Gateway's Cognito User Pool authorizer validates it; the Lambda reads `requestContext.authorizer.claims` (`sub`, `email`, `cognito:username`, `cognito:groups`). Routes marked **public** have no authorizer. Admin = member of the Cognito group `admin` (`COGNITO_ADMIN_GROUP`). |
| Body | JSON, `Content-Type: application/json`. A body that is not a JSON object → `400 INVALID_JSON` (routes using `readJsonBody`). |
| IDs | UUID strings. `user_id` is the Cognito `sub`. |
| Item metadata | Plaintext `metadata` may contain only `{ favorite: boolean, collection_id: uuid|null }`. Title, URL, username, notes and tags go inside `encrypted_data`; other keys → `400 METADATA_NOT_ALLOWED`, wrong types → `400 INVALID_METADATA`. |
| Ciphertext | `EncryptedPayload = { ciphertext, iv, authTag, algorithm: "AES-256-GCM", keyVersion }` (base64 fields). `WrappedKey = { ciphertext, algorithm: "RSA-OAEP", hash: "SHA-256" }`. The server never decrypts either. |
| CORS | Returned by the Lambda on every response; allowed origin(s) from `CORS_ALLOW_ORIGIN`. `OPTIONS` on any path → `204`. |

### Response envelope

```jsonc
// 2xx
{ "status": "success", "success": true, ...payload }        // payload key per route: data | collection | items | ...
// 4xx
{ "status": "fail",  "error": "MACHINE_CODE", "message": "human readable", "details": [ ... ]? }
// 5xx
{ "status": "error", "error": "INTERNAL_SERVER_ERROR" | "TIMEOUT", "message": "generic text" }
```

Errors produced before the Lambda runs come from API Gateway with body `{"message": "..."}`:
`401 Unauthorized` (missing/invalid/expired token), `403` (WAF block), `429` (throttling / WAF rate rule).

### Common errors (every authenticated route)

| Status | `error` | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No authorizer claims reached the Lambda (defense in depth) |
| 401 | `INVALID_TOKEN_USE` | Token is not an ID token |
| 403 | `FORBIDDEN` | Admin route called by a non-admin, or resource permission too low |
| 404 | `ROUTE_NOT_FOUND` | Unknown method/path |
| 500 | `INTERNAL_SERVER_ERROR` | Unhandled error (details only in CloudWatch Logs) |
| 504 | `TIMEOUT` | Handler did not finish ~0.5 s before the Lambda timeout |

---

## Auth & profile (UC-1, UC-2, UC-3, UC-7)

Sign-up, e-mail confirmation, sign-in and TOTP MFA are **Amazon Cognito** calls made by the
browser (`aws-amplify/auth`), not API routes. There is no self-service "forgot password" for now
(the user pool uses `admin_only` account recovery): a forgotten master password cannot unlock
the vault anyway (zero knowledge). The Cognito password is
`toCognitoPassword(authHash)` derived from the master password (`shared/crypto.js`).

### `GET /auth/salt?identifier={username|email}` — public
Returns the Argon2id salt to derive keys before sign-in / sign-up.
- Known user → stored `kdf_salt`. Unknown identifier → deterministic `HMAC(saltPepper, identifier)` (same answer every time, so existence is not revealed; used as the salt at sign-up).
- `200 { data: { salt } }` · `400 MISSING_PARAM`

### `GET /users/me`
`200 { data: Profile }` · `404 PROFILE_NOT_FOUND` (first sign-in, profile not created yet)

`Profile = { user_id, email, username, full_name, role, mfa_enabled, kdf_salt, public_key, encrypted_private_key: EncryptedPayload, encrypted_vault_key: EncryptedPayload, created_at }` — `role` follows the Cognito groups.

### `POST /users/me`
First sign-in: stores key material and creates the default "Personal Vault". `email` / `username` come from the token claims.

| Field | Type | Rule |
|---|---|---|
| `full_name` | string | 1–128 chars (falls back to the `name` claim) |
| `kdf_salt` | string | base64, ≥ 16 bytes |
| `public_key` | string | RSA-2048 SPKI base64, ≤ 4096 chars |
| `encrypted_private_key` | EncryptedPayload | private key encrypted with the Vault Key |
| `encrypted_vault_key` | EncryptedPayload | Vault Key wrapped with the KEK |

`201 { data: Profile }` · `400 VALIDATION_FAILED` (`details: [{ field, message }]`) · `400 INCOMPLETE_CLAIMS` · `409 PROFILE_EXISTS`

### `PATCH /users/me`
Body `{ full_name?: string(1–128), mfa_enabled?: boolean }` → `200 { data: Profile }` · `400 VALIDATION_FAILED` · `404 PROFILE_NOT_FOUND`

### `PUT /users/me/keys`
Replace key material after a master password change (`reason: "change"`, Vault Key re-wrapped). `reason: "reset"` (new Vault Key — old ciphertext becomes unreadable) is accepted but no longer used by the app.
Body: `kdf_salt`, `encrypted_vault_key`, `encrypted_private_key` (required), `public_key` (optional), `reason`.
`200 { data: Profile }` · `400 VALIDATION_FAILED` · `404 PROFILE_NOT_FOUND`

### `POST /auth/session`
Called right after a successful Cognito sign-in; writes `LOGIN_SUCCESS` to the activity log.
`200 { message }` · `404 PROFILE_NOT_FOUND`

---

## Vaults & items (UC-4/5/6)

### `GET /api/v1/vaults`
- Auth: Cognito ID token
- Request: none
- Side effect: if caller has no vault, a `Personal Vault` is created.
- 200: `{ status: 'success', data: [ { vault_id, user_id, name, description, is_shared, created_at, updated_at } ] }` (ordered by `created_at` ASC)
- Errors: common only.

### `GET /api/v1/vaults/{vaultId}/items` · `GET /api/v1/items`
- Auth: Cognito ID token
- Path: `vaultId` (vault-scoped form only). Without it, returns all items owned by caller across vaults.
- 200: `{ status: 'success', data: [ { item_id, vault_id, user_id, item_type, encrypted_data, metadata, version, created_at, updated_at } ] }` (by `updated_at` DESC)
- Errors:
  - `404 VAULT_NOT_FOUND` — vault does not exist or is not owned by caller

### `GET /api/v1/vaults/{vaultId}/items/{itemId}` · `GET /api/v1/items/{itemId}`
- Auth: Cognito ID token
- Path: `itemId` (required); `vaultId` accepted but ignored.
- Access: owner, or recipient of a share.
- 200: `{ status: 'success', data: <full vault_items row> }`; for share recipients `data.share_info = { share_id, permission_level, encrypted_key_for_recipient }`
- Errors:
  - `400 MISSING_PARAM` — no itemId
  - `404 ITEM_NOT_FOUND`
  - `403 FORBIDDEN` — not owner and no share

### `POST /api/v1/vaults/{vaultId}/items` · `POST /api/v1/items`
- Auth: Cognito ID token
- Path: `vaultId` (optional; else body)
- Body:

| Field | Type | Req | Notes |
|---|---|---|---|
| `vault_id` / `vaultId` | string (UUID) | no | used when no path param; if absent, caller's oldest vault (auto-created if none) |
| `encrypted_data` / `encryptedData` | object | yes | see below |
| `encrypted_data.ciphertext` | string | yes | non-empty after trim |
| `encrypted_data.iv` | string | yes | non-empty after trim |
| `encrypted_data.auth_tag` / `authTag` | string | yes | non-empty after trim; stored as `auth_tag` |
| `encrypted_data.algorithm` | string | no | default `AES-256-GCM` |
| `encrypted_data.key_version` / `keyVersion` | number | no | default `1` |
| `encrypted_item_key` / `encryptedItemKey` | object | no (app always sends it) | the item's own Item Key, AES-256-GCM-wrapped with the Vault Key, or with the Collection Key when `metadata.collection_id` is set; same shape as `encrypted_data`. Items without it are legacy (payload under the Vault Key / Collection Key directly) and cannot be shared |
| `metadata` | object | no | default `{}`; only `favorite` (boolean) and `collection_id` (UUID) allowed |
| `item_type` / `itemType` | string | no | default `login`; DB CHECK: `login`, `secure_note`, `credit_card`, `server`, `identity` (not validated in handler) |

- 201: `{ status: 'success', message, data: { item_id, vault_id, version: 1, created_at } }`
- Errors:
  - `404 VAULT_NOT_FOUND` — vault missing / not owned by caller
  - `400 INVALID_ENCRYPTED_PAYLOAD` — `encrypted_data` not an object, or missing/empty `ciphertext` / `iv` / `auth_tag`
  - `500 INTERNAL_SERVER_ERROR` — e.g. `item_type` outside DB enum
- Logs `PASSWORD_CREATE` activity.

### `PUT /api/v1/vaults/{vaultId}/items/{itemId}` · `PUT /api/v1/items/{itemId}`
- Auth: Cognito ID token
- Path: `itemId` (required); `vaultId` ignored.
- Access: owner, or share recipient with `permission_level = 'modify'`.
- Body:

| Field | Type | Req | Notes |
|---|---|---|---|
| `version` / `currentVersion` | integer | no | optimistic lock; if sent, must strictly equal (`!==`) current version |
| `encrypted_data` / `encryptedData` | object | no | validated as in create when present; otherwise unchanged |
| `encrypted_item_key` / `encryptedItemKey` | object | no | **owner only** (re-wrap when moving into/out of a collection, or first Item Key for a legacy item); ignored for editors so shares stay valid |
| `metadata` | object | no | replaces metadata when truthy; otherwise unchanged |

- Behaviour: current version archived into `password_history`, version incremented.
- 200: `{ status: 'success', message, data: { item_id, version, updated_at } }`
- Errors:
  - `400 MISSING_PARAM` — no itemId
  - `404 ITEM_NOT_FOUND`
  - `403 FORBIDDEN` — not owner and no `modify` share
  - `409 ITEM_CONCURRENTLY_MODIFIED` — supplied version differs from stored version
  - `400 INVALID_ENCRYPTED_PAYLOAD` — supplied `encrypted_data` invalid
- Logs `PASSWORD_UPDATE` activity.

### `DELETE /api/v1/vaults/{vaultId}/items/{itemId}` · `DELETE /api/v1/items/{itemId}`
- Auth: Cognito ID token
- Path: `itemId` (required); `vaultId` ignored.
- Access: owner only. FK cascade removes history and shares.
- 200: `{ status: 'success', message, data: { item_id } }`
- Errors:
  - `400 MISSING_PARAM`
  - `404 ITEM_NOT_FOUND`
  - `403 FORBIDDEN` — caller not owner
- Logs `PASSWORD_DELETE` activity + audit log (severity `WARNING`).

---

## Sharing (UC-10)

Every item has its own random **Item Key**. Sharing gives the recipient that Item Key wrapped
with their RSA-OAEP public key — never the owner's Vault Key. Recipients must share at least one
group with the owner.

### `GET /api/v1/users/lookup`
- Auth: Cognito ID token
- Query: `username` (required; trimmed, case-insensitive exact match)
- Visibility: only the caller and users who share a group with the caller.
- 200: `{ status: 'success', data: { user_id, username, full_name, public_key } }` (no e-mail)
- Errors:
  - `400 MISSING_PARAM` — `username` missing/empty
  - `404 RECIPIENT_USER_NOT_FOUND` — no such user **or** not in a shared group (indistinguishable)

### `POST /api/v1/vaults/{vaultId}/items/{itemId}/share` · `POST /api/v1/items/{itemId}/share`
- Auth: Cognito ID token
- Path: `itemId`; `vaultId` ignored.
- Access: item owner only.
- Body:

| Field | Type | Req | Notes |
|---|---|---|---|
| `item_id` / `itemId` | string | no | fallback if no path itemId (unreachable via current routes) |
| `recipient_user_id` / `recipientUserId` | string (UUID) | one of | takes precedence over username |
| `recipient_username` / `recipientUsername` | string | one of | case-insensitive |
| `permission_level` / `permission` | string | no | `read` (default) or `modify`, case-insensitive |
| `encrypted_key_for_recipient` / `encryptedKeyForRecipient` | object | yes | the item's Item Key wrapped with the recipient's public key: `{ algorithm: 'RSA-OAEP', hash: 'SHA-256', ciphertext }` |

- Behaviour: upsert — an existing share for (item, recipient) is updated (in one transaction with the activity log).
- 201 (also on update): `{ status: 'success', message, data: { share_id, permission_level, recipient_user_id, recipient_username } }`
- Errors:
  - `400 MISSING_PARAM` — itemId missing / not a UUID
  - `404 ITEM_NOT_FOUND`
  - `403 FORBIDDEN` — caller not owner
  - `409 ITEM_KEY_REQUIRED` — legacy item without `encrypted_item_key`; re-save it with an Item Key first (the app does this automatically)
  - `404 RECIPIENT_USER_NOT_FOUND` — recipient not found, not in a shared group, or neither id nor username supplied
  - `400 CANNOT_SHARE_WITH_SELF`
  - `400 INVALID_PERMISSION_LEVEL` — not `read`/`modify`
  - `400 MISSING_WRAPPED_KEY` — wrapped key missing or without a `ciphertext` string
- Logs `PASSWORD_SHARE` activity.

### `GET /api/v1/shared-items`
- Auth: Cognito ID token
- 200: `{ status: 'success', data: [ { share_id, permission_level, encrypted_key_for_recipient, shared_at, item_id, vault_id, user_id (owner), item_type, encrypted_data, metadata, version, shared_by_email, shared_by_username, shared_by_name } ] }` (by share `created_at` DESC)
- Errors: common only.

### `DELETE /api/v1/vaults/{vaultId}/items/{itemId}/share/{userId}` · `DELETE /api/v1/shares/{shareId}`
- Auth: Cognito ID token
- Path:
  - vault form: `itemId`, `userId` (recipient); deletes only if caller is `shared_by_user_id`; `vaultId` ignored.
  - `shares/{shareId}` form: caller must be sharer **or** recipient.
- 200: `{ status: 'success', message, data: { share_id } }`
- Errors:
  - `400 MISSING_PARAM` — neither `shareId` nor (`itemId` + `userId`)
  - `404 SHARE_NOT_FOUND` — no matching share or caller not authorized
- Logs `PASSWORD_SHARE_REVOKED` activity.

---

## History (UC-11)

### `GET /api/v1/vaults/{vaultId}/items/{itemId}/history` · `GET /api/v1/items/{itemId}/history`
- Auth: Cognito ID token
- Path: `itemId`; `vaultId` ignored.
- Access: owner or any share recipient (read or modify).
- 200 (no `data` wrapper): `{ status: 'success', item_id, history: [ { history_id, item_id, version, encrypted_data, metadata, created_at, changed_by, changed_by_username } ] }` (version DESC)
- Errors:
  - `400 MISSING_PARAM`
  - `404 ITEM_NOT_FOUND`
  - `403 FORBIDDEN` — not owner, no share

### `POST /api/v1/vaults/{vaultId}/items/{itemId}/rollback` · `POST /api/v1/items/{itemId}/rollback`
- Auth: Cognito ID token
- Path: `itemId`; `vaultId` ignored.
- Access: owner or recipient with `modify` share.
- Body: `version` (required; history version to restore; no type check, no camelCase alias, no optimistic-lock field)
- Behaviour: archives current version, copies snapshot's `encrypted_data`/`metadata`, sets `version = current + 1`.
- 200: `{ status: 'success', message, data: { item_id, version, restored_from_version } }`
- Errors:
  - `400 REQUIRED_FIELDS` — no itemId or `version` missing
  - `404 ITEM_NOT_FOUND`
  - `403 FORBIDDEN` — not owner, no `modify` share
  - `404 VERSION_NOT_FOUND` — no history row for that version
- Logs `PASSWORD_RESTORE` activity.

---

## Logs & security (UC-8/9/12)

### `GET /api/v1/admin/security/notifications`
- Auth: Cognito ID token, **admin group required**
- 200: `{ status: 'success', data: [ { notification_id, severity, type, source, description, timestamp, status: 'ACTIVE' } ] }`
  - Up to 20 latest `WARNING`/`CRITICAL` audit logs (source `AuditSystem`) followed by the in-memory alert list (seeded with one static `sec-001` GuardDuty alert).
- Errors: common only.

### `POST /api/v1/admin/security/simulate-event`
- Auth: Cognito ID token, **admin group required**
- Body (all optional, none validated):

| Field | Default | Notes |
|---|---|---|
| `severity` | `CRITICAL` | DB CHECK: `INFO`/`WARNING`/`CRITICAL` (else 500) |
| `type` | `AnomalousAccessDetected` | stored as `event_action` (VARCHAR 64) |
| `description` | `Simulated security event` | |
| `source` | `GuardDuty` | |

- 201: `{ status: 'success', message, data: { notification_id: 'sec-<ms>', severity, type, source, description, timestamp, status: 'ACTIVE' } }`
- Errors: common only (`500` on DB constraint violations).

### `GET /api/v1/admin/audit-logs`
- Auth: Cognito ID token, **admin group required**
- Query:

| Param | Aliases | Notes |
|---|---|---|
| `severity` | — | upper-cased, exact match |
| `action` | `event_action` | exact match on `event_action` |
| `actor_id` | `userId` | exact match on `actor_user_id` |
| `start_date` | `startDate` | `created_at >=` (not validated) |
| `end_date` | `endDate` | `created_at <=` (not validated) |
| `limit` | — | default 50, clamped 1–500 |
| `offset` | — | default 0, min 0 |
| `format` | — | `json` (default) or `csv`; anything else → JSON |

- 200 JSON: `{ status: 'success', pagination: { total, limit, offset }, data: [ { audit_id, actor_user_id, actor_role, event_action, event_severity, target_resource, target_resource_id, ip_address, status, details, created_at } ] }`
- 200 CSV: `text/csv`, `content-disposition: attachment; filename="audit_logs.csv"`; columns `audit_id, created_at, actor_user_id, actor_role, event_action, event_severity, target_resource, ip_address, status` (current page only).
- Errors: common only.

### `GET /api/v1/user/activity-logs`
- Auth: Cognito ID token
- Query: `limit` (default 20, clamped 1–100), `offset` (default 0), `action_type` / `action` (exact match)
- 200: `{ status: 'success', data: [ { log_id, user_id, action_type, target_item_id, ip_address, user_agent, status, details, created_at } ] }` (no pagination block)
- Errors: common only.

---

## Monitoring (UC-13)

### `GET /api/v1/health`
- Auth: public (no authorizer)
- 200 / 503: `{ status: 'healthy' | 'degraded', version: '1.0.0', engine: <db.type>, database: 'connected' | 'disconnected' | 'error: <message>', timestamp }`
  - 503 when the `SELECT 1` probe fails.

### `GET /api/v1/admin/monitoring/metrics`
- Auth: Cognito ID token, **admin group required**
- 200 (no `data` wrapper): `{ status: 'success', metrics: {...} }`
  - `system_health` (always `'HEALTHY'`), `uptime_seconds`, `active_db_connections`
  - `db_pool_status: { total_connections, idle_connections, waiting_clients }`
  - `request_statistics: { total_requests_24h, error_rate_percentage, p95_latency_ms }`
  - `security_indicators: { failed_logins_last_hour, active_security_alarms, mfa_adoption_percentage }`
  - `inventory: { total_users, total_vault_items }`
- Errors: common only (DB query failures are swallowed and yield zeros).

---

## Groups

Group objects are returned in dual case: `{ id, group_id, name, description, createdBy, created_by, createdAt, created_at, updatedAt, updated_at }`.
Member objects: `{ id, group_member_id, groupId, group_id, userId, user_id, role, createdAt, created_at }` (+ `username`, `email`, `fullName`, `full_name` when listed).
"System admin" below = caller in Cognito admin group; "group admin/manager" = `group_members.role`.

### `POST /api/v1/groups`
- Auth: Cognito ID token
- Body: `name` (string, required, non-empty after trim; stored trimmed), `description` (any, optional, default `null`)
- Behaviour: creator added as member with role `admin`; audit `GROUP_CREATED`.
- 201: `{ status: 'success', success: true, group: <group> }`
- Errors:
  - `400 BAD_REQUEST` — name missing/not string/blank

### `GET /api/v1/groups`
- Auth: Cognito ID token
- System admin: all groups; others: groups created by or containing caller.
- 200: `{ status: 'success', success: true, groups: [<group>] }` (by `created_at` DESC)

### `GET /api/v1/groups/{groupId}`
- Auth: Cognito ID token
- Access: system admin, creator, or any member.
- 200: `{ status: 'success', success: true, group: <group> }`
- Errors: `404 NOT_FOUND` — group not found; `403 FORBIDDEN` — not a member

### `PUT /api/v1/groups/{groupId}`
- Auth: Cognito ID token
- Access: system admin, creator, or member with role `admin`/`manager`.
- Body: `name` (optional; if present must be non-blank string), `description` (optional, any type; `undefined` keeps old value)
- 200: `{ status: 'success', success: true, group: <group> }`
- Errors: `404 NOT_FOUND`; `403 FORBIDDEN`; `400 BAD_REQUEST` — empty/non-string name

### `DELETE /api/v1/groups/{groupId}`
- Auth: Cognito ID token
- Access: system admin or creator.
- Behaviour: deletes `collection_access` rows targeting the group, all members, then the group.
- 200: `{ status: 'success', success: true, message }`
- Errors: `404 NOT_FOUND`; `403 FORBIDDEN`

### `POST /api/v1/groups/{groupId}/members`
- Auth: Cognito ID token
- Access: system admin, creator, or group `admin`/`manager`.
- Body: `username` **or** `userId` / `user_id` (one required; the app sends `username`), `role` (optional, default `member`; `member`/`manager`/`admin`, case-insensitive). This is the only place a user can be found without already sharing a group, and only group admins/managers reach it.
- 201: `{ status: 'success', success: true, member: <member + username, full_name> }`
- Errors:
  - `404 NOT_FOUND` — group not found / target user (id or username) not found
  - `403 FORBIDDEN` — insufficient group role
  - `400 BAD_REQUEST` — neither `username` nor `userId`, or invalid role
  - `409 CONFLICT` — already a member

### `GET /api/v1/groups/{groupId}/members`
- Auth: Cognito ID token
- Access: system admin, creator, or any member.
- 200: `{ status: 'success', success: true, members: [<member + username, email, full_name, public_key>] }` (by join date ASC; public keys let a collection admin wrap the collection key for a whole group)
- Errors: `404 NOT_FOUND`; `403 FORBIDDEN`

### `DELETE /api/v1/groups/{groupId}/members/{userId}`
- Auth: Cognito ID token
- Access: caller removing themselves, system admin, creator, or group `admin`/`manager`.
- 200: `{ status: 'success', success: true, message }`
- Errors: `404 NOT_FOUND` — group not found / user not a member; `403 FORBIDDEN`

---

---

## Collections (shared folders, R1–R3)

Permission levels: `read` < `write` < `admin`. Effective permission = highest of: creator (→ `admin`), direct user grant, grants of every group the user belongs to. System admins (Cognito `admin` group) get `admin` on every collection.

`Collection = { id, collection_id, name, description, createdBy, created_by, createdAt, created_at, updatedAt, updated_at, effectivePermission, effective_permission }`

All ids in paths and bodies must be UUIDs → otherwise `400 INVALID_ID`. Invalid JSON → `400 INVALID_JSON`. Unknown collection → `404 NOT_FOUND`; permission below the minimum → `403 FORBIDDEN`. Every change is written to the audit log.

| Method & path | Min. permission | Request | Success | Errors (besides the above) |
|---|---|---|---|---|
| `POST /collections` | — | `{ name: string 1–255, description?: string ≤ 2000 | null, encryptedKeyForRecipient?: WrappedKey }` (creator's wrapped key). Collection, creator grant and key are created atomically. | `201 { collection }` | `400 VALIDATION_FAILED` (`details[]`) |
| `GET /collections` | read | — | `200 { collections: Collection[] }` — caller's collections with effective permission (one query) | — |
| `GET /collections/{collectionId}` | read | — | `200 { collection }` | — |
| `PUT /collections/{collectionId}` | admin | `{ name?: string 1–255, description?: string ≤ 2000 | null }` | `200 { collection }` | `400 VALIDATION_FAILED` |
| `DELETE /collections/{collectionId}` | admin | — | `200 { message }` — access, keys and item links removed atomically; vault items stay | — |
| `GET /collections/{collectionId}/access` | admin | — | `200 { access: AccessEntry[] }` | — |
| `POST /collections/{collectionId}/access` | admin | `{ targetType: "user"|"group", targetId: uuid, permission?: "read"|"write"|"admin" (default read) }` — upsert, case-insensitive | `201 { access }` | `400 BAD_REQUEST` (enum), `404 NOT_FOUND` (target) |
| `DELETE /collections/{collectionId}/access/{targetType}/{targetId}` | admin | — | `200 { message, keysRemoved }` — wrapped keys of users left without access are deleted | `404 NOT_FOUND` (grant) |
| `GET /collections/{collectionId}/keys/pending` | admin | — | `200 { pending: [{ user_id, username, email, full_name, public_key }] }` — members with access but no wrapped key (e.g. joined a granted group later) | — |
| `GET /collections/{collectionId}/keys` | read | — | `200 { key: { id, collectionId, userId, encryptedKeyForRecipient: WrappedKey, ... } }` — caller's own wrapped key | `404 KEY_NOT_FOUND` |
| `POST /collections/{collectionId}/keys` | **admin** | `{ userId: uuid, encryptedKeyForRecipient: WrappedKey }` — upsert. Grant access first. | `201 { message }` | `400 BAD_REQUEST`, `400 TARGET_HAS_NO_ACCESS`, `404 NOT_FOUND` (user) |
| `GET /collections/{collectionId}/items` | read | — | `200 { items: VaultItem[] }` (ciphertext + metadata) | — |
| `POST /collections/{collectionId}/items` | write | `{ itemId: uuid }` — caller must **own** the item | `201 { collectionItem }` | `400 BAD_REQUEST`, `403 ITEM_NOT_OWNED`, `404 NOT_FOUND` (item), `409 CONFLICT` |
| `DELETE /collections/{collectionId}/items/{itemId}` | write | — | `200 { message }` (vault item stays) | `404 NOT_FOUND` (link) |

Items in a collection: members with **read** can `GET /items/{itemId}` (response includes `collection_permission`), members with **write** can `PUT /items/{itemId}` (the item keeps its collection; only the owner can move it). Deleting and sharing an item stay owner-only.

Group membership changes (`DELETE /groups/{groupId}/members/{userId}`) also delete the removed member's wrapped keys for collections that the group had access to. Group managers can only assign/remove the roles `member` and `manager`.

`AccessEntry = { id, access_id, collectionId, targetType, targetId, permission, createdAt, updatedAt }` (snake_case duplicates included).

> Fixes applied to this contract are listed in `REVIEW.md`.

## Known inconsistencies (to be fixed, tracked in REVIEW.md)


**Envelopes / response shape**
- History list returns `{ status, item_id, history }` instead of `data` (`handlers/history.js:102-106`).
- Monitoring metrics returns `{ status, metrics }` (`handlers/monitoring.js:113-139`); health uses `status: 'healthy'|'degraded'` instead of `success` (`monitoring.js:59-65`).
- Group handlers return `success: true` plus resource-named keys (`group`, `groups`, `member`, `members`) (`group.js:152-163, 187-191, 422-432, 477-481`); all other handlers use `data` and no `success`. `http/response.js:41` `ok()` (adds `success: true`) is unused by these handlers.
- Audit logs has a `pagination` block (`logs.js:249-257`); activity logs paginates via limit/offset but returns no pagination/total (`logs.js:296-299`).
- Every handler file re-defines `jsonResponse` with a hard-coded `access-control-allow-origin: '*'` (e.g. `vault.js:17-26`, `logs.js:237-243`); the router overwrites it, so it is dead/misleading. Shared `http/response.js` helpers (`fail`, `readJsonBody`) are not used.

**Error codes**
- Version conflict is `409 ITEM_CONCURRENTLY_MODIFIED` (`vault.js:368-372`), not a generic `VERSION_CONFLICT`/`CONFLICT`; groups use `409 CONFLICT` (`group.js:408-412`).
- Missing-param code differs: `MISSING_PARAM` (vault/share/history GET) vs `REQUIRED_FIELDS` (rollback, `history.js:122-128`) vs `BAD_REQUEST` (groups, `group.js:119-123, 378-383`).
- Not-found codes: specific (`ITEM_NOT_FOUND`, `VAULT_NOT_FOUND`, `SHARE_NOT_FOUND`) in vault/share/history vs generic `NOT_FOUND` for both group and user in groups (`group.js:205-209, 396-400, 510-514`).
- Share with neither recipient id nor email → `404 RECIPIENT_USER_NOT_FOUND` instead of 400 (`share.js:128-150`).
- Re-sharing an existing (item, recipient) pair updates it but still returns `201` (`share.js:188-214`).

**Input validation**
- Invalid JSON bodies silently become `{}` (`parseBody` in each handler, e.g. `vault.js:28-36`), so a malformed PUT is a no-op update that still bumps the version.
- `item_type` not validated against the DB enum → 500 instead of 400 (`vault.js:277`, `schema.sql:51-52`); item type can never be changed on update.
- `metadata` not type-checked on create/update (`vault.js:276, 391`).
- Optimistic locking is optional (only checked if `version` sent), uses `body.version || body.currentVersion` (0 falls through) and strict `!==` (string `"3"` ≠ `3` → 409) (`vault.js:366-367`). No transaction: concurrent updates can both pass and then collide on `uq_item_version` → 500 (`vault.js:395-415`, `schema.sql:77`).
- Rollback has no optimistic-lock check and `version` is not type-checked (`history.js:120, 157-160`).
- `encrypted_key_for_recipient` only checked with `typeof === 'object'` (arrays pass) (`share.js:172-179`); recipient's `public_key` existence not checked.
- Non-string `recipient_email`, `permission_level`, or group `role` → `.trim()`/`.toLowerCase()` throws → 500 (`share.js:128, 162`; `group.js:376`).
- simulate-event: `severity`/`type` unvalidated; DB CHECK/VARCHAR(64) violations become 500 (`logs.js:99-102`, `schema.sql:122-124`).
- Audit/activity logs: non-numeric `limit`/`offset` yield `NaN` (`Math.max(NaN,1)` is `NaN`) passed into SQL → 500 (`logs.js:184-185, 274-275`); dates and severity unvalidated (`logs.js:177-181`); unknown `format` silently falls back to JSON.
- Group `description` accepts any JSON type; no length limits on `name` (`group.js:117-130, 278`).

**Authorization**
- `vaultId` path param is ignored on get/update/delete/share/history/rollback/revoke; an item is reachable via any `vaultId` (`vault.js:173, 321, 448`; `share.js:94, 275`; `history.js:45, 119`).
- `listVaultItemsHandler` comment says "owns vault or vault is shared" but only owner is allowed (`vault.js:126-130`); shared vaults (`is_shared`) are never honoured.
- `GET /users/lookup` lets any authenticated user enumerate registered emails and public keys (`share.js:42-82`).
- `DELETE /shares/{shareId}` allows the recipient to revoke, while the vault-scoped form allows only the sharer (`share.js:283-296`).
- Members can remove themselves even if they are the creator/last admin; managers can remove group admins (`group.js:517-530`).
- `listGroupsHandler` checks `'admin' || 'ADMIN'` while other group handlers check only `'admin'` (`group.js:175` vs `213, 253, 313, 359, 454, 517`).

**Logging / data quality**
- IP recorded as hard-coded `'127.0.0.1'` in share, revoke, rollback, simulate-event and group audit logs (`share.js:210, 317`; `history.js:199`; `logs.js:120`; `group.js:98`), but real `sourceIp` in vault handlers (`vault.js:291, 420, 487`).
- simulate-event writes `actor_role = 'system'` even though an admin user is the actor (`logs.js:120`).
- Simulated alerts are both pushed to the in-memory list and inserted into `audit_logs`; `CRITICAL`/`WARNING` ones then appear twice in notifications (`logs.js:114-122, 61-79`). The in-memory list is per-Lambda-container and includes a static fake `sec-001` alert (`logs.js:35-45`).
- Group delete / add member / remove member / update write no audit log, only create does (`group.js:144-150`).
- Monitoring metrics contain hard-coded/placeholder values: `system_health: 'HEALTHY'`, connection counts 1/2, `active_security_alarms: 0`, p95 default `12.5`, `total_requests_24h` is per-container since cold start with min 1, `failed_logins_last_hour` counts all-time failures (`monitoring.js:93, 102, 116-131`). DB failures are swallowed (`monitoring.js:95-97`).
- Health exposes raw DB error messages to unauthenticated callers (`monitoring.js:54`).
- `GET /vaults` has a write side-effect (auto-creates vault, `vault.js:98-104`); `createVaultItemHandler` auto-creates a vault with no description, unlike list (`vault.js:243-246`).
- History query uses INNER JOIN on `users`, so snapshots whose `changed_by_user_id` no longer exists would be dropped (`history.js:96-97`) — mitigated by FK `ON DELETE CASCADE`, which instead deletes them.
- CSV export does not neutralise spreadsheet formula prefixes (`=`, `+`, `-`, `@`) (`logs.js:156-160`) and exports only the current page.
