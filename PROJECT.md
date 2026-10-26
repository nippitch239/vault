# Project: SecureVault Organization-Based Access Control & Password Sharing

## Architecture

### System Overview
SecureVault is a zero-knowledge password management and credential sharing system built with modern Node.js, PostgreSQL/SQLite dual-engine database access, AWS Lambda / API Gateway, React 18, and native Web Crypto primitives.

This architecture introduces an Organization-based password sharing and access control model inspired by Bitwarden:
- **Multi-Tenant Organizations**: Organizations (`organizations`) serve as administrative and cryptographic boundaries for shared resources.
- **Organization Memberships & Multi-Tier RBAC**: Users belong to Organizations via `organization_members` with roles `Owner`, `Admin`, and `Member`.
- **Scoped Groups**: Groups (`groups`) are scoped to an Organization via `org_id` and contain organization members (`group_members`). Deleting a group retains user accounts and vault items.
- **Scoped Collections & Shared Items**: Collections (`collections`) are scoped to an Organization via `org_id`. Collections contain shared vault items (`collection_items` linking to `vault_items`) without duplicating item payloads.
- **Access Control & Deterministic Effective Permissions**: Collections can be shared with Groups or individual Organization Members with `Read`, `Write`, or `Manage` permissions. Effective permission resolves deterministically using a supremum algorithm: Org Owner/Admin > Collection Creator > MAX(direct grant, group grants).
- **Zero-Knowledge Encryption Model**: The server never receives or stores unencrypted credentials, Master Keys, Vault Keys, Org Keys, or Collection Keys. Org Keys and Collection Keys are 256-bit AES symmetric keys wrapped for each recipient using their RSA-OAEP 2048-bit public key.
- **Seamless Migration**: Existing standalone groups and collections are automatically migrated into a personal default organization for each user, preserving existing data, keys, and backwards compatibility.

### Package & Module Boundaries
- `@vault/shared`: Cryptographic primitives (`shared/crypto.js`), Argon2id key derivation, HKDF key expansion, AES-256-GCM authenticated encryption, and RSA-OAEP key wrapping.
- `@vault/backend`: Dual-engine database adapter (`backend/src/db/adapter.js`), relational schema (`backend/src/db/schema.sql`), API Gateway event normalization, routing (`backend/src/router.js`), auth middleware (`backend/src/middleware/auth-guard.js`), and domain handlers (`handlers/organization.js`, `handlers/group.js`, `handlers/collection.js`, `handlers/vault.js`).
- `@vault/frontend`: React 18 + Vite 5 SPA with Tailwind CSS, UI primitives (`components/ui/`), responsive navigation (`TopNav.jsx`, `HeaderControls.jsx`, `navConfig.js`, `CommandPalette.jsx`), authentication & memory key storage (`AuthContext.jsx`), organization context (`OrganizationContext.jsx`), views (`OrganizationsView.jsx`, `GroupsView.jsx`, `CollectionsView.jsx`, `VaultDashboard.jsx`), and API client (`services/api.js`).
- `integration`: End-to-end integration test runner against local API Gateway + Cognito emulator.

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Organization Table & Entity | Relational table `organizations` with `org_id`, `name`, `description`, `created_by`, `status`, timestamps | M1 | R1, R5 |
| 2 | Organization Members Table & Roles | Relational table `organization_members` with roles `owner`, `admin`, `member`, `status`, unique constraint, and `encrypted_org_key` | M1 | R1, R5 |
| 3 | Scoped Foreign Keys on Groups & Collections | Add `org_id` foreign keys to `groups` and `collections` referencing `organizations(org_id) ON DELETE CASCADE` | M1 | R2, R3, R5 |
| 4 | Dual-Engine DB Adapter Support | SQLite and PostgreSQL schema DDL translation, column upgrades, and JSON column configuration for `encrypted_org_key` | M1 | R5 |
| 5 | Default Personal Organization Migration | Idempotent migration creating default personal organization for all existing users | M1 | R5 |
| 6 | Standalone Groups & Collections Backfill | Idempotent backfill linking standalone groups and collections (`org_id IS NULL`) to creator's default personal organization | M1 | R5 |
| 7 | Cryptographic Org Key Management | Client-side 256-bit Org Key generation and RSA-OAEP wrapping/unwrapping for members | M2 | R7 |
| 8 | Cryptographic Collection Key Wrapping | Asymmetric RSA-OAEP Collection Key distribution for organization members and groups | M2 | R3, R7 |
| 9 | Zero-Knowledge Vault Item Encryption | AES-256-GCM item key wrapping with Collection Key and payload encryption with fresh 12-byte IVs | M2 | R3, R7 |
| 10 | Cryptographic Security Invariants | Strict server-side payload validation rejecting unencrypted credentials, tampering detection, and anti-leak safeguards | M2 | R7 |
| 11 | Organization Creation Endpoint | `POST /organizations` creating organization and making caller Owner | M3 | R1 |
| 12 | Organization Listing & Get Endpoints | `GET /organizations` and `GET /organizations/:orgId` with caller role metadata | M3 | R1 |
| 13 | Organization Update & Delete Endpoints | `PUT /organizations/:orgId` and `DELETE /organizations/:orgId` with sole-owner protection | M3 | R1 |
| 14 | Organization Member Invitation / Add | `POST /organizations/:orgId/members` allowing Owners/Admins to invite/add members | M3 | R1 |
| 15 | Organization Member Role Management | `PUT /organizations/:orgId/members/:userId` allowing role updates (Owner, Admin, Member) | M3 | R1 |
| 16 | Organization Member Removal & Leave | `DELETE /organizations/:orgId/members/:userId` for member removal or voluntary leave | M3 | R1 |
| 17 | Organization Authorization & IDOR Defense | Strict server-side authorization middleware ensuring caller belongs to organization and non-admins cannot access admin operations | M3 | R1, R4 |
| 18 | Scoped Group CRUD Endpoints | `POST/GET/PUT/DELETE /organizations/:orgId/groups` scoped to organization | M4 | R2 |
| 19 | Scoped Group Membership Management | Add/remove members to group within organization; safe deletion preserving user accounts and vault items | M4 | R2 |
| 20 | Scoped Collection CRUD Endpoints | `POST/GET/PUT/DELETE /organizations/:orgId/collections` scoped to organization | M4 | R3 |
| 21 | Collection Access Grants & Revocation | Grant and revoke collection permissions (`read`, `write`, `manage`) for groups and members in same organization | M4 | R3, R4 |
| 22 | Deterministic Effective Permission Logic | Supremum calculation: Org Owner/Admin > Collection Creator > MAX(direct grant, group grants); support `manage`/`admin` synonyms | M4 | R4 |
| 23 | Collection Items & Keys Distribution | Link/unlink vault items to collection, retrieve user's wrapped key, list pending members, and store wrapped keys | M4 | R3, R4 |
| 24 | Frontend API Client Extensions | `api.organizations` namespace and organization-scoped parameters for groups and collections in `services/api.js` | M5 | R6 |
| 25 | Frontend Organization Context & Switcher | `OrganizationContext.jsx` and organization switcher dropdown in top navigation | M5 | R6 |
| 26 | Frontend Organization Overview & Members View | `OrganizationsView.jsx` with overview, member listing, role assignment, invite dialog, and remove member confirmation | M5 | R6 |
| 27 | Frontend Scoped Groups View | `GroupsView.jsx` enhancements for organization-scoped groups, member assignment, and assigned collections | M5 | R6 |
| 28 | Frontend Scoped Collections View | `CollectionsView.jsx` enhancements for organization-scoped collections, access management dialog, and pending keys banner | M5 | R6 |
| 29 | Frontend Navigation & Shell Polish | Integration into `TopNav.jsx`, `HeaderControls.jsx`, `navConfig.js`, and `CommandPalette.jsx` | M5 | R6 |
| 30 | E2E Integration Test Suite Pass (Tiers 1-4) | Complete 100% pass of requirement-driven E2E test suites (Feature, Boundary, Combinatorial, Real-World) | M6 | Acceptance |
| 31 | Adversarial Hardening (Tier 5) | White-box adversarial testing: IDOR attacks, privilege escalation, cross-org tampering, zero-knowledge leak probes | M6 | R4, R7 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Database Schema, Migrations & Default Personal Org Migration | Add `organizations`, `organization_members` tables; add `org_id` on `groups` and `collections`; configure SQLite adapter; run idempotent migration backfilling default personal organizations and standalone groups/collections | None | DONE |
| M2 | Cryptographic Infrastructure & Key Wrapping for Orgs & Collections | Add Org Key generation and RSA-OAEP wrapping in `@vault/shared` and frontend crypto service; verify AES-256-GCM item wrapping and zero-knowledge invariants | M1 | DONE |
| M3 | Organization & Member Management Backend Services & APIs | Organization CRUD, member listing, invitation/add, role assignment, member removal, and server-side RBAC authorization middleware | M1 | DONE |
| M4 | Organization-Scoped Groups & Collections Backend Services & Effective Permissions | Scoped groups CRUD, group membership, scoped collections CRUD, access grants (Read, Write, Manage), deterministic supremum effective permissions calculation, item linking, and key distribution endpoints | M1, M3 | PLANNED |
| M5 | Frontend UI/UX Integration | `api.organizations`, `OrganizationContext`, organization switcher, `OrganizationsView`, scoped `GroupsView`, scoped `CollectionsView`, navigation shell integration (`TopNav`, `navConfig`, `CommandPalette`) | M2, M3, M4 | PLANNED |
| M6 | Final Milestone: 100% E2E Test Suite Pass & Adversarial Coverage Hardening | Phase 1: Pass 100% of E2E tests (Tiers 1-4 from E2E Testing Track). Phase 2: Tier 5 Adversarial Coverage Hardening (IDOR, privilege escalation, zero-knowledge leak verification) | M5 | PLANNED |

---

## Interface Contracts

### 1. Database Schema & Models
- `organizations`:
  - `org_id`: UUID PK
  - `name`: VARCHAR(255) NOT NULL
  - `description`: TEXT DEFAULT NULL
  - `created_by`: UUID NOT NULL REFERENCES `users(user_id)` ON DELETE CASCADE
  - `status`: VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'suspended'))
  - `created_at`, `updated_at`: TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
- `organization_members`:
  - `org_member_id`: UUID PK
  - `org_id`: UUID NOT NULL REFERENCES `organizations(org_id)` ON DELETE CASCADE
  - `user_id`: UUID NOT NULL REFERENCES `users(user_id)` ON DELETE CASCADE
  - `role`: VARCHAR(32) NOT NULL DEFAULT 'member' CHECK (`role` IN ('owner', 'admin', 'member'))
  - `status`: VARCHAR(32) NOT NULL DEFAULT 'confirmed' CHECK (`status` IN ('confirmed', 'invited', 'suspended'))
  - `encrypted_org_key`: JSONB DEFAULT NULL (`{ ciphertext, algorithm, hash }`)
  - `created_at`, `updated_at`: TIMESTAMP WITH TIME ZONE
  - UNIQUE(`org_id`, `user_id`)
- `groups`:
  - Existing columns + `org_id UUID REFERENCES organizations(org_id) ON DELETE CASCADE`
- `collections`:
  - Existing columns + `org_id UUID REFERENCES organizations(org_id) ON DELETE CASCADE`

### 2. Cryptographic Contracts (`shared/crypto.js`)
- `generateOrgKey()`: Returns `Uint8Array(32)` (256-bit random key).
- `wrapOrgKey(orgKey, recipientPublicKey)`: Wraps 256-bit symmetric key with RSA-OAEP public key. Output: `{ ciphertext: string, algorithm: 'RSA-OAEP', hash: 'SHA-256' }`.
- `unwrapOrgKey(wrappedOrgKey, recipientPrivateKey)`: Unwraps 256-bit symmetric key using RSA-OAEP private key. Returns `CryptoKey`.
- `wrapCollectionKey(collectionKey, recipientPublicKey)`: Same as existing.
- `unwrapCollectionKey(wrappedCollectionKey, recipientPrivateKey)`: Same as existing.

### 3. Backend HTTP APIs
- **Organization Management**:
  - `POST /api/v1/organizations` -> Body: `{ name, description }` -> Response `201`: `{ organization }`
  - `GET /api/v1/organizations` -> Response `200`: `{ organizations: [ { org_id, name, description, role, member_count, ... } ] }`
  - `GET /api/v1/organizations/:orgId` -> Response `200`: `{ organization }`
  - `PUT /api/v1/organizations/:orgId` -> Body: `{ name, description }` -> Response `200`: `{ organization }`
  - `DELETE /api/v1/organizations/:orgId` -> Response `200`: `{ deleted: true }`
- **Member Management**:
  - `GET /api/v1/organizations/:orgId/members` -> Response `200`: `{ members: [ { user_id, username, email, full_name, role, status, public_key, joined_at } ] }`
  - `POST /api/v1/organizations/:orgId/members` -> Body: `{ usernameOrEmail, role, encryptedOrgKey? }` -> Response `201`: `{ member }`
  - `PUT /api/v1/organizations/:orgId/members/:userId` -> Body: `{ role }` -> Response `200`: `{ member }`
  - `DELETE /api/v1/organizations/:orgId/members/:userId` -> Response `200`: `{ removed: true }`
- **Scoped Groups**:
  - `GET /api/v1/organizations/:orgId/groups` -> Response `200`: `{ groups: [ { group_id, name, description, member_count } ] }`
  - `POST /api/v1/organizations/:orgId/groups` -> Body: `{ name, description }` -> Response `201`: `{ group }`
- **Scoped Collections**:
  - `GET /api/v1/organizations/:orgId/collections` -> Response `200`: `{ collections: [ { collection_id, name, description, effective_permission, item_count } ] }`
  - `POST /api/v1/organizations/:orgId/collections` -> Body: `{ name, description }` -> Response `201`: `{ collection }`
- **Collection Access & Effective Permissions**:
  - `POST /api/v1/collections/:collectionId/access` -> Body: `{ targetType: 'user'|'group', targetId, permission: 'read'|'write'|'manage' }` -> Response `201`: `{ access }`
  - Effective permissions supremum calculation: `Manage` (rank 3) > `Write` (rank 2) > `Read` (rank 1). `'manage'` and `'admin'` are synonyms.

### 4. Frontend State & Context (`OrganizationContext`)
```javascript
export const OrganizationContext = createContext({
  organizations: [],
  currentOrg: null, // null for Personal Vault, or { org_id, name, role }
  setCurrentOrg: (orgIdOrNull) => {},
  userOrgRole: null, // 'owner' | 'admin' | 'member' | null
  loading: false,
  refreshOrganizations: async () => {},
});
```

---

## Code Layout

```
├── package.json                         # Workspace root package manifest & scripts
├── PROJECT.md                           # Master project architecture & status
├── TEST_INFRA.md                        # E2E test suite architecture & methodology
├── TEST_READY.md                        # Published when E2E test suite is complete
├── shared/
│   ├── package.json
│   ├── crypto.js                        # Cryptographic primitives & key wrapping
│   └── test/
│       └── crypto.test.js               # Crypto unit tests
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.sql               # Relational DDL with organizations & memberships
│   │   │   ├── adapter.js               # PostgreSQL / SQLite dual adapter & JSON columns
│   │   │   └── migration.js             # Idempotent personal default org migration
│   │   ├── middleware/
│   │   │   └── auth-guard.js            # Authentication, org membership guard & supremum RBAC
│   │   ├── handlers/
│   │   │   ├── organization.js          # Organization & member handlers
│   │   │   ├── group.js                 # Scoped group handlers
│   │   │   ├── collection.js            # Scoped collection handlers
│   │   │   └── vault.js                 # Vault item handlers & validation
│   │   └── router.js                    # Route table & parameter dispatch
│   └── test/
│       ├── organization.test.js         # Backend organization tests
│       ├── group.test.js                # Backend group tests
│       └── collection.test.js           # Backend collection tests
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── context/
│   │   │   ├── AuthContext.jsx          # Auth & memory keys
│   │   │   └── OrganizationContext.jsx  # Active organization state & role
│   │   ├── services/
│   │   │   ├── api.js                   # API client with organizations namespace
│   │   │   └── crypto.js                # Frontend crypto adapter
│   │   ├── components/
│   │   │   ├── Layout/
│   │   │   │   ├── TopNav.jsx           # Top navigation with Org switcher
│   │   │   │   └── navConfig.js         # Navigation tab labels & config
│   │   │   ├── Organizations/
│   │   │   │   ├── OrganizationsView.jsx# Org overview, member list, invite dialog
│   │   │   │   └── MemberRoleModal.jsx  # Role management modal
│   │   │   ├── Groups/
│   │   │   │   └── GroupsView.jsx       # Scoped groups view
│   │   │   └── Collections/
│   │   │       └── CollectionsView.jsx  # Scoped collections view
│   └── test/
│       ├── organizations.test.js        # Frontend organization tests
│       └── collections.test.js          # Frontend collection tests
└── integration/
    ├── e2e.test.js                      # Base end-to-end integration test
    └── e2e-organizations.test.js        # Organization & sharing E2E suite
```
