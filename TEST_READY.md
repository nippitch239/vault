# TEST_READY: SecureVault Organization-Based Access Control E2E Test Suite

## Status: READY

The end-to-end testing infrastructure and comprehensive opaque-box test suites for Organization-Based Access Control & Password Sharing have been established and verified.

---

## 1. Test Suite Architecture

- **Test File**: `integration/e2e-organizations.test.js`
- **Specification Document**: `TEST_INFRA.md`
- **Runner**: Node.js Native Test Runner (`node:test`, `node:assert/strict`)
- **Execution Harness**: In-process ephemeral API Gateway + Cognito simulation (`backend/local/local-runner.js`)
- **Crypto Engine**: Web Crypto API (`@vault/shared/crypto.js` and `frontend/src/services/crypto.js`)
- **Total Test Cases**: 42 discrete automated test cases across 4 tiers.

---

## 2. Test Execution Commands

```bash
# 1. Run the entire Organization E2E Test Suite
node --test integration/e2e-organizations.test.js

# 2. Run all integration test suites (Base E2E + Organizations)
npm run test:integration

# 3. Progressive Milestone-Filtered Runs
node --test --test-name-pattern="\[M1\]" integration/e2e-organizations.test.js
node --test --test-name-pattern="\[M2\]" integration/e2e-organizations.test.js
node --test --test-name-pattern="\[M3\]" integration/e2e-organizations.test.js
node --test --test-name-pattern="\[M4\]" integration/e2e-organizations.test.js
node --test --test-name-pattern="\[M5\]" integration/e2e-organizations.test.js

# 4. Tier-Filtered Runs
node --test --test-name-pattern="Tier 1" integration/e2e-organizations.test.js
node --test --test-name-pattern="Tier 2" integration/e2e-organizations.test.js
node --test --test-name-pattern="Tier 3" integration/e2e-organizations.test.js
node --test --test-name-pattern="Tier 4" integration/e2e-organizations.test.js
```

---

## 3. Coverage Summary by Tier & Feature

### Tier 1: Feature Coverage (Isolation & Happy Path) — 18 Tests
- **[M1] Schema & Migrations**:
  - `[Tier 1][F1/F2/F3]` Relational schema definitions (`organizations`, `organization_members`, `org_id` scoped foreign keys).
  - `[Tier 1][F4]` Dual-Engine DB Adapter includes `encrypted_org_key` in JSON columns.
  - `[Tier 1][F5/F6]` Personal default organization migration preserves standalone resources.
- **[M2] Cryptographic Infrastructure**:
  - `[Tier 1][F7]` Client-side 256-bit Org Key generation and RSA-OAEP wrapping/unwrapping.
  - `[Tier 1][F8]` Cryptographic Collection Key distribution via RSA-OAEP.
  - `[Tier 1][F9/F10]` Zero-Knowledge AES-256-GCM Vault Item encryption under Collection Key with fresh 12-byte IV.
- **[M3] Organization & Member Management**:
  - `[Tier 1][F11]` `POST /api/v1/organizations` creates organization and sets caller as owner.
  - `[Tier 1][F12]` `GET /api/v1/organizations` lists organizations with caller role.
  - `[Tier 1][F12]` `GET /api/v1/organizations/:id` retrieves organization details.
  - `[Tier 1][F13]` `PUT /api/v1/organizations/:id` updates organization metadata.
  - `[Tier 1][F14]` `POST /api/v1/organizations/:id/members` invites/adds member.
  - `[Tier 1][F14]` `GET /api/v1/organizations/:id/members` lists organization members.
  - `[Tier 1][F15]` `PUT /api/v1/organizations/:id/members/:userId` updates member role.
  - `[Tier 1][F16]` `DELETE /api/v1/organizations/:id/members/:userId` removes member.
- **[M4] Organization-Scoped Groups & Collections**:
  - `[Tier 1][F18]` `POST/GET/PUT /api/v1/organizations/:id/groups` manages scoped groups.
  - `[Tier 1][F19]` Scoped group membership management.
  - `[Tier 1][F20]` `POST/GET/PUT /api/v1/organizations/:id/collections` manages scoped collections.
  - `[Tier 1][F21]` Collection Access Grants & Revocation.
  - `[Tier 1][F22]` Deterministic Effective Permission Logic (Supremum calculation).
  - `[Tier 1][F23]` Collection Items Association and Key Distribution.
- **[M5] Frontend API Client Extensions**:
  - `[Tier 1][F24]` `api.organizations` client extensions comply with interface contract.

### Tier 2: Boundary & Corner Cases — 10 Tests
- `[Tier 2][F11]` Organization creation rejects empty or whitespace-only name (`400 Bad Request`).
- `[Tier 2][F11]` Organization creation rejects name exceeding 255 characters (`400 Bad Request`).
- `[Tier 2][F14]` Inviting non-existent username/email returns `404 Not Found`.
- `[Tier 2][F14]` Inviting already existing member returns `409 Conflict`.
- `[Tier 2][F13/F16]` Removing sole owner of organization is rejected (`400/409 Conflict`).
- `[Tier 2][F15]` Demoting sole owner without transferring ownership is rejected (`400/409 Conflict`).
- `[Tier 2][F17]` Standard Member attempting admin operations returns `403 Forbidden`.
- `[Tier 2][F17]` IDOR: Cross-organization access attempts return `403 Forbidden` or `404 Not Found`.
- `[Tier 2][F21]` Invalid permission grant string returns `400 Bad Request`.
- `[Tier 2][F3/F13]` Deleting organization cascades to scoped groups and collections.
- `[Tier 2][F2/F19]` Deleting a group retains member user accounts and vault items intact.

### Tier 3: Cross-Feature Combinations — 5 Tests
- `[Tier 3][F21/F22]` Multi-Group Permission Union: User in Group A (`read`) and Group B (`write`) gets effective `write`.
- `[Tier 3][F21/F22]` Direct Grant Overrides Group Grant: Direct `manage` overrides group `write`.
- `[Tier 3][F15/F22]` Role Transition: Demoting Admin to Member correctly shifts effective permission to explicit direct grants.
- `[Tier 3][F21]` Partial Access Revocation: Revoking direct grant preserves group grant.
- `[Tier 3][F16/F17/F20]` Organization Member Removal immediately cuts off all scoped collection access (`403 Forbidden`).

### Tier 4: Real-World Enterprise Scenarios — 5 Workflows
- **Scenario 1**: Enterprise Engineering & DevOps Credential Sharing (multi-team groups, granular RBAC, read/write division).
- **Scenario 2**: External Contractor Temporary Onboarding & Instant Offboarding (invitation, restricted collection, immediate revocation).
- **Scenario 3**: Enterprise Multi-Tier RBAC Approval & Safe Ownership Transfer (member promotion, admin powers, succession).
- **Scenario 4**: Multi-Tenant Enterprise Isolation (Cross-Tenant Firewall between distinct organizations).
- **Scenario 5**: Complete Zero-Knowledge Cryptographic Roundtrip & Key Distribution (client key gen, RSA-OAEP wrapping, AES-256-GCM item save/open, zero server leak).

---

## 4. Progressive Testability & Baseline Verification

- **Current Implementation State**: Milestones M1 through M5 are in implementation by Track 2.
- **Baseline Test Execution**:
  - All cryptographic key generation, RSA-OAEP wrapping/unwrapping, and AES-256-GCM payload encryption tests pass.
  - Database schema inspection tests pass.
  - Cross-tenant isolation rejections pass.
  - Endpoints not yet mounted in `router.js` return explicit assertion failures (`404 !== 201`, `404 !== 200`), providing an exact roadmap for backend and frontend milestone developers.
  - As M1, M2, M3, M4, and M5 complete, the corresponding milestone suites will turn green progressively until reaching 100% pass at Milestone 6.
