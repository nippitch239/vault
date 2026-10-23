# SecureVault — Deploy on AWS Academy Learner Lab (Console GUI)

```
Desktop → Amplify → WAF → API Gateway (REST) → Lambda (VPC) → RDS PostgreSQL (Multi-AZ)
                                                    │
                          Secrets Manager / KMS (via VPC Interface Endpoint)
                          CloudWatch / CloudTrail
```

Every step uses the AWS Console GUI except for two local steps on your PC:
- the backend zip, which is already built as `backend-lambda.zip`
- building the frontend once

## Learner Lab rules to remember

- Region: **us-east-1 (N. Virginia)**. Use it for everything.
- You **cannot create IAM roles**. Use the existing **`LabRole`** everywhere.
- When the lab session ends (about 4 hours), the lab stops EC2 and RDS. They start again when you press **Start Lab**. Lambda, API Gateway and Amplify stay.
- Use small instances only (for example `db.t3.micro`). Large ones are blocked.

## Files you need (in `C:\Users\PC\Downloads\vault-aws\`)

| File | Use |
|---|---|
| `backend-lambda.zip` | Upload to Lambda (contains `pg`, `hash-wasm`, `src/server`, `src/shared`) |
| `frontend\` | React app, build once to get `dist` |

---

## Step 0 — Start the lab

Learner Lab → **Start Lab** → wait for the green dot → click **AWS**. Check the region at the top right is **us-east-1**.

## Step 1 — VPC

**VPC → Create VPC → VPC and more**
- Name: `securevault`
- IPv4 CIDR: `10.0.0.0/16`
- Number of AZs: **2** (us-east-1a, us-east-1b)
- Public subnets: **0**
- Private subnets: **2**
- NAT gateways: **None**
- VPC endpoints: **None**
- DNS hostnames and DNS resolution: **enabled**
- Click **Create VPC**.

## Step 2 — Security groups

**VPC → Security groups → Create security group** (choose the `securevault` VPC each time)

| Name | Inbound rule |
|---|---|
| `sg-lambda` | none |
| `sg-rds` | PostgreSQL 5432, source `sg-lambda` |
| `sg-endpoint` | HTTPS 443, source `sg-lambda` |

Leave outbound as **All traffic** on all three.

## Step 3 — RDS PostgreSQL

**RDS → Subnet groups → Create DB subnet group**
- Name: `securevault-db-subnets`
- VPC: `securevault`
- Add both private subnets (us-east-1a and us-east-1b)

**RDS → Create database**
- **Standard create** → **PostgreSQL**
- Template: **Dev/Test**
- Availability: **Multi-AZ DB instance**. This gives you the standby in AZ b. If the lab blocks it, use Single-AZ.
- DB identifier: `securevault-db`
- Master username: `postgres`
- Credentials: **Managed in AWS Secrets Manager**, encryption key `aws/secretsmanager` (KMS)
- Instance: **db.t3.micro**
- Storage: 20 GB gp3
- Connectivity:
  - VPC: `securevault`
  - Subnet group: `securevault-db-subnets`
  - Public access: **No**
  - Security group: remove `default`, choose `sg-rds`
- Additional configuration:
  - Initial database name: **`vault`**
  - Encryption: enabled (KMS)
- Click **Create database** and wait about 10–15 minutes until the status is **Available**.

Write down these two values:
- **Endpoint**: in the database's **Connectivity & security** tab
- **Secret ARN**: in the **Configuration** tab under Master credentials ARN (or in Secrets Manager → `rds!db-...`)

## Step 4 — JWT secret

**Secrets Manager → Store a new secret**
1. Choose **Other type of secret**.
2. Switch to the **Plaintext** tab, delete everything, and paste a long random string (at least 32 characters).
3. Secret name: `securevault/jwt`
4. Click Next → Next → **Store**.
5. Open the secret and copy its **ARN**.

## Step 5 — VPC interface endpoint (Secrets Manager)

Lambda runs in private subnets with no internet access, so it needs this endpoint to reach Secrets Manager.

**VPC → Endpoints → Create endpoint**
- Name: `securevault-secrets-ep`
- Type: **AWS services**
- Service: `com.amazonaws.us-east-1.secretsmanager`
- VPC: `securevault`. Under **Additional settings**, tick **Enable DNS name**.
- Subnets: both private subnets
- Security group: `sg-endpoint`
- Click **Create endpoint**.

## Step 6 — Lambda

**Lambda → Create function → Author from scratch**
- Name: `securevault-api`
- Runtime: **Node.js 22.x**. Node 20 will crash.
- Architecture: x86_64
- Permissions: **Use an existing role** → **`LabRole`**
- Click **Create function**.

### 6.1 Upload code
1. On the **Code** tab, click **Upload from** → **.zip file** and choose `backend-lambda.zip`. Click **Save**.
2. Under **Runtime settings** → **Edit**, set **Handler** to `src/server/lambda.handler`. Click **Save**.

### 6.2 General configuration
**Configuration → General configuration → Edit**: Memory **512 MB**, Timeout **30 sec**.

### 6.3 VPC
**Configuration → VPC → Edit**
- VPC: `securevault`
- Subnets: both private subnets
- Security group: `sg-lambda`

### 6.4 Environment variables
**Configuration → Environment variables → Edit**

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST` | RDS endpoint (step 3) |
| `DB_NAME` | `vault` |
| `DB_PORT` | `5432` |
| `DB_SECRET_ARN` | RDS secret ARN (step 3) |
| `JWT_SECRET_ARN` | JWT secret ARN (step 4) |
| `INIT_SCHEMA` | `true` |

`INIT_SCHEMA=true` creates all the tables on the first run. After the test in 6.5 succeeds, change it to **`false`**.

### 6.5 Test
On the **Test** tab, create a new event named `health` and paste this:

```json
{
  "httpMethod": "GET",
  "path": "/api/v1/health",
  "headers": {},
  "queryStringParameters": null,
  "body": null
}
```

Click **Test**. You should get `statusCode: 200`.

| Error | Fix |
|---|---|
| `Cannot find module` / `Cannot find package` | Wrong handler, or a wrong zip was uploaded. Use `src/server/lambda.handler` with `backend-lambda.zip`. |
| Timeout on Secrets Manager | Endpoint from step 5 is missing, or **Enable DNS name** is off, or `sg-endpoint` doesn't allow 443 from `sg-lambda`. |
| Timeout / `ECONNREFUSED` on database | `sg-rds` doesn't allow 5432 from `sg-lambda`, or RDS is not Available. |
| `AccessDenied` | The function isn't using `LabRole`. |

## Step 7 — API Gateway (REST API)

Use a **REST API**. WAF can't attach to an HTTP API.

**API Gateway → Create API → REST API → Build**
- Name: `securevault-api`
- Endpoint type: **Regional**
- Click **Create API**.

Then:
1. Select `/` → **Create resource**: turn on **Proxy resource**, Resource path `/`, name `{proxy+}`, tick **CORS**. Click Create.
2. Select the **ANY** method under `/{proxy+}` → **Integration**: **Lambda function**, turn on **Lambda proxy integration**, choose `securevault-api`. Click Save. If it asks to add permission, click **OK**.
3. Select `/{proxy+}` → **Enable CORS**: tick all methods, Access-Control-Allow-Origin `*` (change it to your Amplify URL later). Click Save.
4. Click **Deploy API**: choose New stage, name it **`prod`**, and Deploy.

Copy the **Invoke URL**, for example `https://abc123.execute-api.us-east-1.amazonaws.com/prod`.

Test in a browser: `https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/v1/health`

## Step 8 — WAF

**WAF & Shield → Web ACLs → Create web ACL**
- Resource type: **Regional resources**, region us-east-1
- Name: `securevault-waf`
- **Add AWS resources**: choose API Gateway → `securevault-api - prod`
- **Add rules → Add managed rule groups → AWS managed**: tick these three:
  - Core rule set
  - SQL database
  - Known bad inputs
- Default action: **Allow**
- Click Next until the end, then **Create web ACL**.

If WAF blocks normal saves (vault items are large encrypted JSON), open Core rule set → set **SizeRestrictions_BODY** to **Count**.

## Step 9 — Build the frontend (on your PC, once)

1. Create the file `C:\Users\PC\Downloads\vault-aws\frontend\.env.production` containing:
   ```
   VITE_API_BASE_URL=https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/v1
   ```
2. In PowerShell, run:
   ```powershell
   cd C:\Users\PC\Downloads\vault-aws\frontend
   npm install
   npm run build
   cd dist
   tar.exe -a -c -f ..\..\frontend-dist.zip *
   ```

`frontend-dist.zip` has `index.html` at the root of the zip, which Amplify needs.

## Step 10 — Amplify

**Amplify → Create new app → Deploy without Git**
1. App name: `securevault-frontend`, Branch: `prod`.
2. Drag and drop `frontend-dist.zip`, then click **Save and deploy**.
3. Go to **Hosting → Rewrites and redirects → Manage** and add:

| Source | Target | Type |
|---|---|---|
| `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|woff2\|ttf\|map\|json\|wasm)$)([^.]+$)/>` | `/index.html` | 200 (Rewrite) |

Open the Amplify URL (`https://prod.xxxx.amplifyapp.com`), then register an account and log in.

Optional: go back to API Gateway, change CORS Allow-Origin from `*` to your Amplify URL, and **Deploy API** again.

## Step 11 — CloudWatch and CloudTrail

- **CloudWatch → Log groups → `/aws/lambda/securevault-api`**: here you see each request and any errors. Use **Actions → Edit retention** to keep logs for 7 days.
- **CloudTrail**: the 90-day Event history is on by default. If the lab allows it, use **Create trail** to keep logs longer.

---

## Updating the app

**Backend:**
```powershell
cd C:\Users\PC\Downloads\vault-aws\backend
npm install --omit=dev
tar.exe -a -c -f ..\backend-lambda.zip package.json src node_modules
```
Then Lambda → **Upload from → .zip file**.

**Frontend:** run `npm run build` again, re-zip `dist` (step 9), then Amplify → **Deploy updates** and drop in the new zip.

## Notes

- **Cognito:** the app has its own login (JWT + MFA), so Cognito isn't connected to the code. You can still show it in the diagram as a future improvement.
- **The AWS SDK isn't in the zip on purpose.** `@aws-sdk/client-secrets-manager` is built into the Node.js 22 Lambda runtime.
- **When you return to the lab:** press Start Lab and wait until RDS is **Available** again before you test.
