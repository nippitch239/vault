# SecureVault — AWS Deployment Guide

Architecture: **Amplify (frontend) → WAF → API Gateway (REST) → Lambda (in VPC) → RDS PostgreSQL (Multi-AZ)**, with Secrets Manager, KMS, CloudWatch and CloudTrail.

## Project layout

```
vault-aws\
├─ backend\              ← Lambda code (node_modules installed)
├─ backend-lambda.zip    ← upload this to Lambda
├─ frontend\             ← React app for Amplify (has amplify.yml)
└─ DEPLOY.md
```

## What was fixed

1. **`pg` was missing.** Added `backend/package.json` with `pg` and `hash-wasm`, and installed them.
2. **No Lambda handler.** Added `backend/src/server/lambda.js`. On cold start it reads the DB password and JWT secret from Secrets Manager, builds `DATABASE_URL`, and optionally creates tables (`INIT_SCHEMA=true`).
3. **`node:sqlite` always loaded.** Now loaded only for local SQLite. SSL is enabled for RDS when `NODE_ENV=production` (or `DB_SSL=true`).
4. **Frontend imported files outside its folder.** Shared code copied into `frontend/shared/`, imports fixed. Added `amplify.yml` and `.env.example`.

---

## Step 1 — VPC

1. Create a VPC with **2 private subnets** (AZ a and AZ b).
2. Create security groups:
   - `sg-lambda` — no inbound rules.
   - `sg-rds` — inbound **5432** from `sg-lambda`.
   - `sg-endpoint` — inbound **443** from `sg-lambda`.

## Step 2 — RDS PostgreSQL

- Engine: PostgreSQL
- **Multi-AZ: on** (standby in AZ b)
- Subnets: the private subnets; Public access: **No**
- Security group: `sg-rds`
- Credentials: **Manage master credentials in AWS Secrets Manager** (KMS encrypted)
- Initial database name: `vault`

Copy the **endpoint** and the **secret ARN**.

## Step 3 — JWT secret

Secrets Manager → Store a new secret → **Other type** → **Plaintext** → a long random string. Copy its ARN.

## Step 4 — VPC endpoint

VPC → Endpoints → Create → **Interface** → `com.amazonaws.<region>.secretsmanager`, both private subnets, security group `sg-endpoint`, Private DNS enabled.

(Without it, Lambda inside the VPC cannot reach Secrets Manager.)

## Step 5 — Lambda

1. Create function → runtime **Node.js 22.x** → **Upload from → .zip** → `backend-lambda.zip`.
2. Runtime settings → **Handler:** `src/server/lambda.handler`
3. Configuration → General: **timeout 15 s**, **memory 512 MB**.
4. Configuration → VPC: your VPC, both private subnets, `sg-lambda`.
5. Environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST` | RDS endpoint |
| `DB_NAME` | `vault` |
| `DB_SECRET_ARN` | RDS secret ARN |
| `JWT_SECRET_ARN` | JWT secret ARN |
| `INIT_SCHEMA` | `true` (first run only, then `false`) |

6. Permissions (execution role): add `secretsmanager:GetSecretValue` on both secrets, plus `kms:Decrypt` if you use a customer-managed KMS key. `AWSLambdaVPCAccessExecutionRole` is added when you set the VPC.

## Step 6 — API Gateway (REST API)

Use **REST API**, not HTTP API — WAF only attaches to REST APIs.

1. Create resource `{proxy+}` → method **ANY** → **Lambda proxy integration** → your function.
2. **Enable CORS**.
3. Deploy to stage `prod`.
4. Test: `https://xxx.execute-api.<region>.amazonaws.com/prod/api/v1/health`

## Step 7 — WAF

Create a Web ACL (Regional) with AWS managed rules (**Core rule set**, **SQL database**), associate it with the API Gateway `prod` stage.

## Step 8 — Amplify (frontend)

1. Push the `frontend` folder to a GitHub repo.
2. Amplify → **Host web app** → GitHub → select repo (it detects `amplify.yml`).
3. Environment variable:
   `VITE_API_BASE_URL` = `https://xxx.execute-api.<region>.amazonaws.com/prod/api/v1`
4. Deploy.

## Step 9 — Monitoring

- **CloudWatch:** Lambda logs are on by default.
- **CloudTrail:** create a trail for API auditing.

---

## Updating the backend

```powershell
cd backend
npm install --omit=dev
tar.exe -a -c -f ..\backend-lambda.zip package.json src node_modules
```

Then Lambda → **Upload from → .zip**.

## Notes

- **Cognito:** the app uses its own JWT + MFA login, so Cognito is not wired into the code.
- **Desktop tool option:** VS Code + **AWS Toolkit** can deploy the Lambda (right-click the `backend` folder). Use the web console for the other services.
- `@aws-sdk/client-secrets-manager` is not in the zip on purpose — it's built into the Node.js 22 Lambda runtime.
