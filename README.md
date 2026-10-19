# SecureVault Cloud

Zero-knowledge password manager. The browser derives every key from the master password;
the server only ever stores ciphertext.

```
desktop ─▶ AWS Amplify (frontend/) ─▶ AWS WAF ─▶ API Gateway (REST, Cognito authorizer)
                     │                                   │
                     └──── Amazon Cognito ◀──────────────┘
                                                         ▼
                              AWS Lambda (backend/) ── ENI in private subnets (AZ a / AZ b)
                                     │                     ├─▶ RDS PostgreSQL Multi-AZ
                                     │                     └─▶ VPC endpoints: Secrets Manager, KMS
                                     └─▶ CloudWatch Logs          (CloudTrail audits the account)
```

See `docs/architecture.png`, the API contract in [`docs/API.md`](docs/API.md) and the
AWS deployment guide in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Repository layout

| Path | What | Deployed to |
|---|---|---|
| `frontend/` | React 18 + Vite + Tailwind SPA. Talks only to API Gateway (`VITE_API_URL`) and Cognito. No DB access, no secrets. | AWS Amplify Hosting (`amplify.yml`) |
| `backend/` | Lambda handler `src/lambda.js` → `router.js` → `handlers/` → `db/`. Reads Cognito claims set by API Gateway, DB credentials from Secrets Manager. | AWS Lambda (`backend/dist/lambda.zip`) |
| `backend/local/` | Local API Gateway + Cognito emulator. **Dev/test only, never bundled.** | — |
| `shared/` | `@vault/shared`: Argon2id/HKDF/AES-GCM/RSA-OAEP crypto, password generator, validators. Used by both sides. | bundled into both |
| `integration/` | Frontend services ↔ local backend end-to-end test. | — |
| `docs/` | Architecture diagram, API contract, deployment guide. | — |
| `design/` | Design system reference (Open Design). | — |

## Key hierarchy (client side)

```
master password + kdf_salt ──Argon2id──▶ Master Key ──HKDF──┬─▶ KEK (memory only)
                                                            └─▶ Authentication Key ─▶ Cognito password
KEK ──AES-256-GCM──▶ unwraps the random Vault Key (users.encrypted_vault_key)
Vault Key ──AES-256-GCM──▶ RSA private key, personal vault items
Collection Key (per collection) ──RSA-OAEP──▶ wrapped for each member
```

## Requirements

- Node.js **22.13+** (uses `node:sqlite` for the local database). Node 24 works.
- npm 10+

## Run locally

```bash
npm ci                     # installs all workspaces
npm run dev                # backend simulator :3000 + Vite dev server :5173
```

Open http://localhost:5173 and sign up. Without an AWS account the frontend uses the
**local Cognito emulator** (`VITE_AUTH_MODE=local`): the e-mail confirmation / reset code is
printed in the backend terminal and shown on screen in local mode.

To get the admin role locally, start the backend with `LOCAL_ADMIN_USERS=<username>`:

```bash
LOCAL_ADMIN_USERS=alice npm run dev
```

Run each side separately:

```bash
npm run dev --workspace backend     # http://localhost:3000  (REST API v1 events -> src/lambda.js)
npm run dev --workspace frontend    # http://localhost:5173  (proxies /api and /local-auth to :3000)
```

Local data is stored in `data.sqlite` at the repo root (delete it to start over). To run the
backend against PostgreSQL instead:

```bash
DATABASE_URL=postgres://vault:vault@localhost:5432/securevault DB_SSL=false npm run migrate --workspace backend
DATABASE_URL=postgres://vault:vault@localhost:5432/securevault DB_SSL=false npm run dev --workspace backend
```

To use a real Cognito user pool locally, copy `frontend/.env.example` to `frontend/.env.local`
and set `VITE_AUTH_MODE=cognito`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` and
`VITE_API_URL` (a deployed API Gateway URL).

## Build, lint, test

| Command | What |
|---|---|
| `npm test` | all workspaces + integration |
| `npm run lint` | ESLint (flat config `eslint.config.js`) on every workspace |
| `npm run build` | `backend/dist/lambda.zip` + `frontend/dist/` |
| `npm run verify` | all of the above with a summary table |
| `npm test --workspace backend` / `frontend` / `shared` | one side only |
| `npm run test:integration` | frontend services against the local backend |

## Environment variables

- Frontend: [`frontend/.env.example`](frontend/.env.example) — public values only (`VITE_*` is
  compiled into the bundle).
- Backend: [`backend/.env.example`](backend/.env.example) — ARNs and endpoints; the secrets
  themselves stay in AWS Secrets Manager.
