# E2E Test Infra: Secure Vault Cloud - Collections & Groups

## Test Philosophy
- Opaque-box, requirement-driven. Derived strictly from `ORIGINAL_REQUEST.md` and user-facing specifications, not internal implementation quirks.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.
- Progressive testability: Tiers progress from basic isolated features to extreme boundaries, pairwise combinations, and complete multi-user zero-knowledge sharing workflows.

## Feature Inventory & Test Matrix
| # | Feature | Source | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Combinations) | Tier 4 (Real-World) |
|---|---------|--------|:-----------------:|:-----------------:|:---------------------:|:-------------------:|
| 1 | Group CRUD (`/api/v1/groups`) | R1 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 2 | Group Membership (`/api/v1/groups/:id/members`) | R1 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 3 | Collection CRUD (`/api/v1/collections`) | R1 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 4 | Collection Access RBAC (`/api/v1/collections/:id/access`) | R1, R3 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 5 | Collection Keys Distribution (`/api/v1/collections/:id/keys`) | R1, R2 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 6 | Collection Items Association (`/api/v1/collections/:id/items`) | R1 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 7 | Zero-Knowledge Asymmetric Key Wrapping | R2 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 8 | Client-Side Collection Item Decryption | R2 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 9 | Group Inheritance Authorization Guard | R3 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 10 | Individual User Access Overrides | R3 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 11 | Non-Member 403 Forbidden Access Boundary | R3 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 12 | Database Schema Parity (PostgreSQL & SQLite) | R1, R5 | ≥5 tests | ≥5 tests | ✓ | ✓ |

## Test Architecture
- Test runner invocation: `node tests/e2e-collections.test.js` or `npm test`
- Environment: Standalone Node.js native test runner (`node:test`, `node:assert/strict`) using in-memory SQLite database via `src/server/db/adapter.js` and `src/server/local-runner.js` simulation.
- Pass/Fail Semantics: Exit code 0 on all tests passing; nonzero on failure.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Engineering Team Shared Server Credentials | Groups, Group Membership, Collection Creation, Key Wrapping, Write Permission, Item Decryption | High |
| 2 | Cross-Department Collaboration (Finance + Ops) | Multiple Groups, Inherited Permissions, Conflicting Grants Resolution (Max Permission) | High |
| 3 | Direct External Contractor Sharing | Direct User Grant alongside Group Grants, Read-Only Boundary Enforcement | Medium |
| 4 | Member Offboarding & Revocation Flow | Member Removal from Group, Verification of Immediate 403 Forbidden Access Denial | High |
| 5 | Full Zero-Knowledge Item Roundtrip | Client Key Generation, RSA Public Key Wrapping, Server Ciphertext Storage, Client Private Key Unwrapping, Secret Plaintext Recovery | High |

## Coverage Thresholds
- Tier 1: ≥5 test cases per feature (≥60 tests total across 12 feature areas)
- Tier 2: ≥5 boundary & corner cases per feature (≥60 tests total)
- Tier 3: Pairwise combinations across roles (read, write, admin), target types (user, group), and inheritance chains (≥20 tests)
- Tier 4: ≥5 realistic multi-user end-to-end application scenarios
- Total Target: ≥145 comprehensive programmatic tests verifying Collections and Groups.
