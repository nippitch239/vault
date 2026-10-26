# SecureVault Cloud — Organization-Based Access Control & Password Sharing E2E Test Infrastructure

## 1. Test Philosophy & Principles

The SecureVault E2E test infrastructure enforces an uncompromising, specification-driven quality standard for the Organization-Based Access Control and Password Sharing subsystem:

- **Opaque-Box Testing**: All test assertions execute strictly against external interfaces (HTTP REST APIs and public cryptographic contracts). Tests possess zero dependency on internal implementation details, database queries, ORM internals, or private variables.
- **Requirement-Driven Verification**: Every test case traces directly to authoritative requirements in `ORIGINAL_REQUEST.md` (Requirements R1–R7) and `PROJECT.md` (Features 1–31).
- **Zero-Knowledge Cryptographic Invariants**: The test framework independently validates that unencrypted credentials, Master Encryption Keys (MEK), and Vault Keys are never transmitted to or stored by the server. All key wrapping (RSA-OAEP-SHA256) and item encryption (AES-256-GCM) are validated end-to-end client-side.
- **Progressive Testability**: Tests are structured hierarchically across Tiers 1 through 4, tagged with corresponding milestones (M1 through M6). As implementation milestones complete, test suites turn green progressively without test refactoring.
- **Independence & Isolation**: Each test case or scenario manages its own lifecycle, provisions ephemeral user identities with unique timestamps and cryptographic keypairs, executes isolated HTTP interactions, and cleans up without order-dependent side effects.

---

## 2. Feature Inventory & Test Matrix (Features 1–31)

| # | Feature | Milestone | Source | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Combinations) | Tier 4 (Real-World) |
|---|---------|-----------|--------|:-----------------:|:-----------------:|:---------------------:|:-------------------:|
| 1 | Organization Table & Entity | M1 | R1, R5 | ✓ | ✓ | ✓ | ✓ |
| 2 | Organization Members Table & Roles | M1 | R1, R5 | ✓ | ✓ | ✓ | ✓ |
| 3 | Scoped Foreign Keys on Groups & Collections | M1 | R2, R3, R5 | ✓ | ✓ | ✓ | ✓ |
| 4 | Dual-Engine DB Adapter Support | M1 | R5 | ✓ | ✓ | ✓ | ✓ |
| 5 | Default Personal Organization Migration | M1 | R5 | ✓ | ✓ | ✓ | ✓ |
| 6 | Standalone Groups & Collections Backfill | M1 | R5 | ✓ | ✓ | ✓ | ✓ |
| 7 | Cryptographic Org Key Management | M2 | R7 | ✓ | ✓ | ✓ | ✓ |
| 8 | Cryptographic Collection Key Wrapping | M2 | R3, R7 | ✓ | ✓ | ✓ | ✓ |
| 9 | Zero-Knowledge Vault Item Encryption | M2 | R3, R7 | ✓ | ✓ | ✓ | ✓ |
| 10 | Cryptographic Security Invariants | M2 | R7 | ✓ | ✓ | ✓ | ✓ |
| 11 | Organization Creation Endpoint (`POST /organizations`) | M3 | R1 | ✓ | ✓ | ✓ | ✓ |
| 12 | Organization Listing & Get Endpoints (`GET /organizations`) | M3 | R1 | ✓ | ✓ | ✓ | ✓ |
| 13 | Organization Update & Delete Endpoints (`PUT/DELETE /organizations/:id`) | M3 | R1 | ✓ | ✓ | ✓ | ✓ |
| 14 | Organization Member Invitation / Add (`POST /organizations/:id/members`) | M3 | R1 | ✓ | ✓ | ✓ | ✓ |
| 15 | Organization Member Role Management (`PUT /organizations/:id/members/:userId`) | M3 | R1 | ✓ | ✓ | ✓ | ✓ |
| 16 | Organization Member Removal & Leave (`DELETE /organizations/:id/members/:userId`) | M3 | R1 | ✓ | ✓ | ✓ | ✓ |
| 17 | Organization Authorization & IDOR Defense | M3 | R1, R4 | ✓ | ✓ | ✓ | ✓ |
| 18 | Scoped Group CRUD Endpoints (`/organizations/:id/groups`) | M4 | R2 | ✓ | ✓ | ✓ | ✓ |
| 19 | Scoped Group Membership Management | M4 | R2 | ✓ | ✓ | ✓ | ✓ |
| 20 | Scoped Collection CRUD Endpoints (`/organizations/:id/collections`) | M4 | R3 | ✓ | ✓ | ✓ | ✓ |
| 21 | Collection Access Grants & Revocation (`/collections/:id/access`) | M4 | R3, R4 | ✓ | ✓ | ✓ | ✓ |
| 22 | Deterministic Effective Permission Logic (Supremum Calculation) | M4 | R4 | ✓ | ✓ | ✓ | ✓ |
| 23 | Collection Items & Keys Distribution | M4 | R3, R4 | ✓ | ✓ | ✓ | ✓ |
| 24 | Frontend API Client Extensions (`api.organizations`) | M5 | R6 | ✓ | ✓ | ✓ | ✓ |
| 25 | Frontend Organization Context & Switcher | M5 | R6 | ✓ | ✓ | ✓ | ✓ |
| 26 | Frontend Organization Overview & Members View | M5 | R6 | ✓ | ✓ | ✓ | ✓ |
| 27 | Frontend Scoped Groups View | M5 | R6 | ✓ | ✓ | ✓ | ✓ |
| 28 | Frontend Scoped Collections View | M5 | R6 | ✓ | ✓ | ✓ | ✓ |
| 29 | Frontend Navigation & Shell Polish | M5 | R6 | ✓ | ✓ | ✓ | ✓ |
| 30 | E2E Integration Test Suite Pass (Tiers 1–4) | M6 | Acceptance | ✓ | ✓ | ✓ | ✓ |
| 31 | Adversarial Hardening (Tier 5 IDOR & Leak Defense) | M6 | R4, R7 | ✓ | ✓ | ✓ | ✓ |

---

## 3. Test Architecture & Runner Format

### Runner & Environment
- **Framework**: Native Node.js test runner (`node:test`, `node:assert/strict`).
- **Server Harness**: `backend/local/local-runner.js` booting ephemeral in-memory API Gateway + Cognito simulation on random port (`port: 0`).
- **Cryptographic Services**: `@vault/shared/crypto.js` and `frontend/src/services/crypto.js` executing native Web Crypto API (`globalThis.crypto.subtle`).
- **Client Protocol**: Standard HTTP REST requests using `Bearer` token authorization headers against `/api/v1/*` routes.
- **Zero-External Dependencies**: Runs in standard CI and local dev environments without external databases or AWS credentials.

### Invocation Commands
```bash
# Run entire E2E Organization test suite
node --test integration/e2e-organizations.test.js

# Run all integration suites (base e2e + organizations)
npm run test:integration

# Run specific tier by pattern
node --test --test-name-pattern="Tier 1" integration/e2e-organizations.test.js
node --test --test-name-pattern="Tier 2" integration/e2e-organizations.test.js
node --test --test-name-pattern="Tier 3" integration/e2e-organizations.test.js
node --test --test-name-pattern="Tier 4" integration/e2e-organizations.test.js
```

### Exit Semantics
- Code `0`: All executed test assertions passed.
- Non-zero: One or more test assertions failed or threw uncaught exceptions.

---

## 4. Test Tiers Specification

### Tier 1: Feature Coverage (Isolation & Happy Path)
Tests each feature independently with valid parameters:
1. **Organization Creation**: `POST /api/v1/organizations` returns 201 Created, sets caller as `owner`, sets `status='active'`, generates valid UUID.
2. **Organization Listing & Get**: `GET /api/v1/organizations` returns list with role metadata; `GET /api/v1/organizations/:orgId` returns details.
3. **Organization Update & Deletion**: `PUT /api/v1/organizations/:orgId` updates metadata; `DELETE /api/v1/organizations/:orgId` removes organization.
4. **Member Invitation & Add**: `POST /api/v1/organizations/:orgId/members` adds member with specified role (`admin`, `member`) and wrapped org key.
5. **Member Role Updates**: `PUT /api/v1/organizations/:orgId/members/:userId` updates role from member to admin or owner.
6. **Member Removal & Voluntary Leave**: `DELETE /api/v1/organizations/:orgId/members/:userId` removes member from organization.
7. **Scoped Groups Management**: `POST/GET/PUT/DELETE /api/v1/organizations/:orgId/groups` manages groups scoped to organization.
8. **Group Membership**: Add and remove members to scoped group; verify account retention on group deletion.
9. **Scoped Collections Management**: `POST/GET/PUT/DELETE /api/v1/organizations/:orgId/collections` manages collections scoped to organization.
10. **Collection Access Grants**: Grant `read`, `write`, `manage` permissions to users and groups.
11. **Collection Items Association**: Link vault item to collection, list collection items, unlink item.
12. **Cryptographic Key Management**: Generate 256-bit Org Key, wrap/unwrap with RSA-OAEP; wrap/unwrap Collection Key; encrypt/decrypt collection item with AES-256-GCM.
13. **Migration & Default Personal Org**: Verify default personal org creation and automatic standalone resource backfill.

### Tier 2: Boundary & Corner Cases (Adversarial Boundaries & Errors)
Validates extreme boundaries, malformed inputs, and strict authorization gates:
1. **Empty / Whitespace Org Name**: Submitting empty string or whitespace-only name returns 400 Bad Request.
2. **Excessive Field Lengths**: Submitting names > 255 characters returns 400 Bad Request.
3. **Non-Existent User Invite**: Inviting non-existent username/email returns 404 Not Found.
4. **Duplicate Member Addition**: Inviting already existing member returns 409 Conflict.
5. **Sole Owner Protection**: Deleting sole owner or sole owner leaving organization is strictly rejected (400/409).
6. **Demoting Sole Owner**: Demoting sole owner without transferring ownership first is rejected (400/409).
7. **Unauthorized Member Actions**: Standard `member` attempting admin operations (invite, change roles, delete org) receives 403 Forbidden.
8. **IDOR Cross-Organization Access**: User belonging to Org A attempting to access or modify groups, collections, or members in Org B receives 403 Forbidden or 404 Not Found.
9. **Invalid Permission Grants**: Granting unsupported permission strings (e.g., `'superuser'`) returns 400 Bad Request.
10. **Cascading Deletion Integrity**: Deleting organization cascades to scoped groups and collections; deleting group never deletes user accounts or vault items.

### Tier 3: Cross-Feature Combinations (Pairwise RBAC & Interactions)
Validates interactions between multiple subsystems:
1. **Multi-Group Permission Union**: User in Group A (`read`) and Group B (`write`) on same collection receives effective permission `write` (supremum rule).
2. **Direct Grant Overrides Group Grant**: User with Group grant (`read`) and direct user grant (`manage`) receives effective permission `manage`.
3. **Role Downgrade with Retained Direct Grant**: Admin demoted to Member retains explicit direct collection grants, while losing implicit org-wide administrative supremacy.
4. **Partial Access Revocation**: Revoking group grant while user possesses direct grant preserves direct grant; revoking direct grant preserves group grant.
5. **Group Deletion with Collection Grants**: Deleting group cleanly cleans up group access entries without corrupting collection items or user accounts.
6. **Organization Removal Access Cutoff**: Removing user from organization immediately invalidates all access to scoped groups and collections (subsequent requests yield 403 Forbidden).
7. **Item Editing Roundtrip in Scoped Collection**: Item created in scoped collection, edited by member with `write` permission, decrypted by member with `read` permission.

### Tier 4: Real-World Application Scenarios
Simulates production enterprise workflows across multiple actors:
1. **Enterprise Engineering & DevOps Credential Sharing**:
   - Multi-role structure: CTO (Owner), DevOps Lead (Admin), Frontend Dev (Member).
   - Scoped groups, collection creation, cryptographic key distribution via RSA public keys.
   - Granular RBAC: DevOps has Write; Frontend has Read-Only (attempted writes rejected with 403).
2. **External Contractor Onboarding & Rapid Offboarding**:
   - Contractor invited, granted access to specific project collection.
   - Contractor decrypts shared secrets.
   - Contract terminates: Contractor removed from organization.
   - Immediate verification of access termination (403 Forbidden on all resources).
3. **Enterprise Multi-Tier RBAC & Ownership Succession**:
   - Member joins, cannot view admin audit logs or manage members.
   - Promoted to Admin, gains management capabilities.
   - Ownership transferred safely to new Owner; original owner transitions cleanly.
4. **Multi-Tenant Enterprise Isolation (Cross-Tenant Firewall)**:
   - Two distinct organizations (Org 1, Org 2) with distinct members.
   - Cross-tenant IDOR probes across organizations, groups, collections, and keys.
   - 100% isolation enforced: no data or key leakage across organization boundaries.
5. **End-to-End Zero-Knowledge Cryptographic Roundtrip**:
   - Client generates 256-bit Org Key and Collection Key.
   - Keys wrapped with recipient RSA public keys and stored on server.
   - Payload encrypted with fresh 12-byte IV and AES-256-GCM.
   - Recipient fetches ciphertext, unwraps key using private key, and recovers plaintext.
   - Zero plaintext or master keys ever hit server memory or disk.

---

## 5. Coverage Thresholds & Quality Gates

| Metric | Target Threshold |
|--------|------------------|
| Features Covered | 31 / 31 (100%) |
| Tier 1 Feature Tests | ≥ 20 tests |
| Tier 2 Boundary / Negative Tests | ≥ 15 tests |
| Tier 3 Combinatorial Tests | ≥ 10 tests |
| Tier 4 Real-World Scenarios | ≥ 5 comprehensive workflows |
| Total Automated E2E Tests | ≥ 50 discrete test assertions |
| Zero-Knowledge Leak Violations | 0 allowed |
| IDOR Bypass Vulnerabilities | 0 allowed |
