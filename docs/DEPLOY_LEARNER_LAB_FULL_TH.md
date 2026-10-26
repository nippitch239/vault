# Deploy SecureVault บน AWS Learner Lab (ตั้งแต่ศูนย์, ผ่านหน้า Console)

คู่มือนี้ deploy โค้ด branch `main` (login ด้วย Amazon Cognito) ลงบัญชี Learner Lab ใหม่ทั้งหมด
ทำตามลำดับ ขั้นหลังใช้ค่าที่จดจากขั้นก่อน

```
Browser ──► Amplify (หน้าเว็บ React)
   │
   ├──► Cognito (สมัคร / login / MFA) ──► ID token
   │
   └──► WAF ──► API Gateway (REST, Cognito authorizer) ──► Lambda (Node 22, ใน VPC)
                                                            │  ENI ใน private subnet a / b
                                                            ├──► RDS PostgreSQL (sg-rds :5432)
                                                            └──► Interface Endpoint ──► Secrets Manager (+KMS)
CloudWatch (log, metric, dashboard)   CloudTrail (ประวัติการเรียก AWS API)
```

---

## สารบัญ

0. [ก่อนเริ่ม: กฎ Learner Lab และการประหยัดงบ](#0-ก่อนเริ่ม)
1. [VPC](#1-vpc)
2. [Security Groups](#2-security-groups)
3. [RDS PostgreSQL](#3-rds-postgresql)
4. [Secret ของแอป](#4-secret-ของแอป-saltpepper)
5. [Interface Endpoint (Secrets Manager)](#5-interface-endpoint-secrets-manager)
6. [Cognito User Pool](#6-cognito-user-pool)
7. [Lambda](#7-lambda)
8. [สร้างตารางในฐานข้อมูล](#8-สร้างตารางในฐานข้อมูล)
9. [API Gateway](#9-api-gateway)
10. [WAF](#10-waf)
11. [Amplify (หน้าเว็บ)](#11-amplify-หน้าเว็บ)
12. [ตั้ง CORS ให้ตรงโดเมน](#12-ตั้ง-cors-ให้ตรงโดเมน)
13. [ทดสอบ](#13-ทดสอบ)
14. [Monitoring สำหรับรายงาน](#14-monitoring-สำหรับรายงาน)
15. [เปิด Multi-AZ ตอน demo](#15-เปิด-multi-az-ตอน-demo)
16. [แก้ปัญหา](#16-แก้ปัญหา)

---

## 0. ก่อนเริ่ม

### กฎของ Learner Lab
| ข้อจำกัด | ผลกับเรา |
|---|---|
| ใช้ได้เฉพาะ **us-east-1** | ทุกขั้นเลือก N. Virginia |
| สร้าง IAM Role ไม่ได้ | Lambda ใช้ **`LabRole`** ที่มีอยู่แล้ว / ปิด Enhanced Monitoring ของ RDS |
| session ละ ~4 ชม. | หมดเวลาแล้ว lab stop RDS ให้ → API ตอบ `Internal server error` จนกว่าจะ Start Lab ใหม่และรอ RDS 3–5 นาที |
| **งบจำกัด** | **งบหมด = บัญชีถูกปิดทันที** (`AWS account deactivated`) ของทั้งหมดหาย |

### ประหยัดงบ (สำคัญมาก — บัญชีก่อนหน้าโดนปิดเพราะเรื่องนี้)
| ทำ | เหตุผล |
|---|---|
| RDS **db.t4g.micro + Single-AZ** ระหว่างพัฒนา | Multi-AZ = จ่ายสองเท่า เปิดเฉพาะตอน demo (ขั้นที่ 15) |
| Storage **20 GB gp3**, ปิด storage autoscaling | |
| ปิด Performance Insights / Enhanced Monitoring | |
| **กด End Lab ทุกครั้ง** ที่เลิกใช้ | Interface Endpoint และ WAF คิดเงินตามชั่วโมงแม้ไม่มีคนใช้ |
| ดู **"Used $X of $Y"** ที่หน้า Learner Lab ทุกครั้งที่เข้า | ถ้าใช้เกิน 70% ให้ลบของที่ไม่จำเป็น |

ค่าใช้จ่ายโดยประมาณ (ระหว่าง lab เปิด):

| Service | ราคาโดยประมาณ |
|---|---|
| RDS db.t4g.micro Single-AZ | ~$0.016/ชม. (Multi-AZ ~$0.032) |
| Interface Endpoint × 2 subnet | ~$0.02/ชม. |
| WAF (1 Web ACL + 3 rule) | ~$8/เดือน คิดตามสัดส่วน |
| Lambda, API Gateway, Cognito, Amplify | แทบเป็น $0 ที่ปริมาณ demo |

### ไฟล์ที่ต้องมี
| ไฟล์ | ได้จาก |
|---|---|
| `backend-lambda-cognito.zip` | `npm ci` แล้ว `npm run build --workspace backend` → `backend/dist/lambda.zip` |
| `frontend-dist-cognito.zip` | build ในขั้นที่ 11 (ต้องมีค่า Cognito + API URL ก่อน) |

### ตารางจดค่า (กรอกระหว่างทำ)
| ค่า | ได้จากขั้น | ค่าของเรา |
|---|---|---|
| VPC ID | 1 | |
| RDS endpoint | 3 | |
| DB secret ARN (`rds!db-...`) | 3 | |
| App secret ARN | 4 | |
| User pool ID | 6 | |
| Client ID | 6 | |
| API invoke URL | 9 | |
| Amplify domain | 11 | |

---

## 1. VPC

**VPC → Create VPC → VPC and more**

| ช่อง | ค่า | ทำไม |
|---|---|---|
| Name tag auto-generation | `securevault` | |
| IPv4 CIDR | `10.0.0.0/16` | |
| Number of AZs | **2** | Lambda และ RDS กระจาย 2 AZ (รองรับ Multi-AZ) |
| Number of public subnets | **0** | ไม่มีอะไรต้องเปิดสู่อินเทอร์เน็ตโดยตรง |
| Number of private subnets | **2** | us-east-1a, us-east-1b |
| NAT gateways | **None** | NAT แพง (~$32/เดือน) Lambda ใช้ Interface Endpoint แทน |
| VPC endpoints | **None** | สร้างเองในขั้นที่ 5 |
| DNS hostnames / DNS resolution | ✅ ทั้งคู่ | **จำเป็น** ถ้าปิด Interface Endpoint จะใช้ private DNS ไม่ได้ |

กด **Create VPC**

**ทำไมไม่มี public subnet:** ทางเข้าจากผู้ใช้คือ API Gateway ซึ่งอยู่นอก VPC (เป็น service ของ AWS) เรียก Lambda ได้โดยตรง
ส่วน RDS และ Lambda ไม่ต้องให้ใครเข้าจากอินเทอร์เน็ต จึงวางใน private subnet ทั้งหมด

---

## 2. Security Groups

**VPC → Security groups → Create security group** (เลือก VPC `securevault-vpc` ทุกตัว) สร้างตามลำดับ:

| ชื่อ | Inbound | Outbound | ติดกับ |
|---|---|---|---|
| `sg-lambda` | (ไม่มี) | All traffic (default) | Lambda |
| `sg-rds` | PostgreSQL **5432** ← Source: `sg-lambda` | default | RDS |
| `sg-endpoint` | HTTPS **443** ← Source: `sg-lambda` | default | Interface Endpoint |

**ทำไม source เป็น SG ไม่ใช่ IP:** IP ของ Lambda เปลี่ยนตลอด อ้างเป็น SG แล้ว Lambda ทุก instance ผ่านได้ ส่วนอย่างอื่นเข้าไม่ได้ (least privilege)

---

## 3. RDS PostgreSQL

### 3.1 Subnet group
**RDS → Subnet groups → Create DB subnet group**
- Name: `securevault-db-subnets`, VPC: `securevault-vpc`
- Availability Zones: `us-east-1a`, `us-east-1b`
- Subnets: **ติ๊กทั้ง 2 private subnet** (ต้องเลือก subnet ด้วย ไม่ใช่แค่ AZ ไม่งั้นขึ้น *Subnet IDs are required*)

### 3.2 Database
**RDS → Create database → Standard create**

| ช่อง | ค่า | หมายเหตุ |
|---|---|---|
| Engine | **PostgreSQL** (16.x) | |
| Templates | **Dev/Test** | |
| Availability | **Single-AZ DB instance** | ประหยัดงบ เปิด Multi-AZ ตอน demo (ขั้นที่ 15) |
| DB instance identifier | `securevault-db` | |
| Master username | `postgres` | |
| Credentials management | **Managed in AWS Secrets Manager** | AWS สุ่มรหัสและเก็บให้ ไม่มีใครต้องรู้รหัส |
| Encryption key (ของ secret) | `aws/secretsmanager` | |
| Instance class | Burstable → **db.t4g.micro** | ถ้าไม่มีให้ใช้ db.t3.micro |
| Storage type / size | **gp3 / 20 GiB** | |
| Storage autoscaling | ❌ ปิด | |
| Compute resource | Don't connect to an EC2 | |
| VPC / Subnet group | `securevault-vpc` / `securevault-db-subnets` | |
| Public access | **No** | |
| VPC security group | ลบ `default` → เลือก **`sg-rds`** | |
| Database authentication | Password authentication | |
| Performance Insights | ❌ ปิด | |
| **Additional configuration → Initial database name** | **`securevault`** | ถ้าไม่ใส่ จะไม่มี DB ให้ Lambda ใช้ |
| Backup retention | 1 day | |
| Encryption | ✅ Enable (aws/rds) | ดิสก์ RDS เข้ารหัสด้วย KMS |
| Enhanced Monitoring | ❌ **ปิด** | Learner Lab สร้าง role ไม่ได้ ถ้าเปิดจะ error |

กด **Create database** (รอ ~10 นาที)

เสร็จแล้วจด:
- **Endpoint** (แท็บ Connectivity & security)
- **Secret ARN** (แท็บ Configuration → *Master Credentials ARN* หรือ Secrets Manager → `rds!db-xxxx`)

---

## 4. Secret ของแอป (saltPepper)

backend ใช้ค่านี้สร้าง salt ให้ username ที่ยังไม่มีในระบบ (กันคนเดาว่า username ไหนมีจริง)

สร้างค่าสุ่มใน PowerShell:
```powershell
-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
```

**Secrets Manager → Store a new secret**
- Secret type: **Other type of secret**
- Key/value: `saltPepper` = ค่าสุ่มด้านบน
- Encryption key: `aws/secretsmanager`
- Secret name: `securevault/app` → Next → (ไม่เปิด rotation) → Store

จด **Secret ARN** · **ห้ามเปลี่ยนค่านี้ภายหลัง**

---

## 5. Interface Endpoint (Secrets Manager)

**VPC → Endpoints → Create endpoint**

| ช่อง | ค่า | ทำไม |
|---|---|---|
| Name | `securevault-secrets-ep` | |
| Type | AWS services | |
| Service | `com.amazonaws.us-east-1.secretsmanager` | |
| VPC | `securevault-vpc` | |
| Additional settings → **Enable DNS name** | ✅ | ทำให้ `secretsmanager.us-east-1.amazonaws.com` ใน VPC ชี้มาที่ endpoint นี้ โค้ดไม่ต้องแก้ |
| Subnets | ติ๊ก **ทั้ง 2 AZ** (เลือก private subnet) | |
| Security groups | **`sg-endpoint`** | |
| Policy | Full access | |

**ทำไมต้องมี:** Lambda อยู่ private subnet ไม่มีทางออกอินเทอร์เน็ต ถ้าไม่มี endpoint การดึง secret จะค้างจน timeout

---

## 6. Cognito User Pool

**Cognito → User pools → Create user pool**

| ช่อง | ค่า |
|---|---|
| Application type | **Single-page application (SPA)** |
| Name your application | `securevault-web` |
| Options for sign-in identifiers | ✅ **Username** ✅ **Email** |
| Self-registration | ✅ Enable |
| Required attributes for sign-up | **email** |
| Return URL | เว้นว่าง |

กด **Create user directory** แล้วตั้งค่าต่อใน pool ที่สร้าง:

1. **Authentication → Sign-in → Multi-factor authentication → Edit**
   - **Optional MFA**, methods: ✅ **Authenticator apps** เท่านั้น
2. **Authentication → Sign-in → User account recovery → Edit**
   - ❌ ปิด self-service account recovery (ทีมเลือกไม่มี forgot password)
3. **Applications → App clients → securevault-web**
   - Authentication flows ต้องมี `ALLOW_USER_SRP_AUTH` และ `ALLOW_REFRESH_TOKEN_AUTH`
   - ไม่มี client secret
4. **User management → Groups → Create group** → `admin`

จด **User pool ID**, **User pool ARN**, **Client ID**

**ทำไมใช้ Cognito:** ได้การยืนยันอีเมล, MFA แบบ TOTP, token ที่เซ็นโดย AWS และ API Gateway ตรวจ token ให้ก่อนถึง Lambda
รหัสผ่านที่ส่งให้ Cognito ไม่ใช่ master password แต่เป็น Authentication Key ที่ browser derive ด้วย Argon2id (zero-knowledge)

---

## 7. Lambda

### 7.1 สร้าง function
**Lambda → Create function → Author from scratch**

| ช่อง | ค่า |
|---|---|
| Function name | `securevault-api` |
| Runtime | **Node.js 22.x** |
| Architecture | x86_64 |
| Execution role | **Use an existing role → `LabRole`** |
| Advanced settings → **Enable VPC** | ✅ |
| VPC | `securevault-vpc` |
| Subnets | **ทั้ง 2 private subnet** |
| Security groups | **`sg-lambda`** |

### 7.2 Code
**Code → Upload from → .zip file** → `backend-lambda-cognito.zip`
**Runtime settings → Edit → Handler:** `index.handler`

### 7.3 General configuration
**Configuration → General configuration → Edit** — Memory **512 MB**, Timeout **15 sec**

### 7.4 Environment variables
**Configuration → Environment variables → Edit**

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DB_SECRET_ARN` | ARN ของ `rds!db-xxxx` (ขั้นที่ 3) |
| `DB_HOST` | RDS endpoint (ขั้นที่ 3) |
| `DB_PORT` | `5432` |
| `DB_NAME` | `securevault` |
| `APP_SECRET_ARN` | ARN ของ `securevault/app` (ขั้นที่ 4) |
| `NODE_EXTRA_CA_CERTS` | `/var/runtime/ca-cert.pem` |
| `COGNITO_ADMIN_GROUP` | `admin` |
| `CORS_ALLOW_ORIGIN` | `*` ไปก่อน (แก้เป็นโดเมนจริงในขั้นที่ 12) |
| `DB_POOL_MAX` | `2` |

**`NODE_EXTRA_CA_CERTS` สำคัญ:** โค้ดตรวจ certificate ของ RDS จริง ไฟล์นี้มี CA ของ RDS ถ้าไม่ใส่จะต่อ DB ไม่ได้

### 7.5 Concurrency
Learner Lab จำกัด concurrency ทั้งบัญชีไว้ต่ำอยู่แล้ว (~10) จึง **ไม่ต้องตั้ง reserved concurrency**
(ถ้าตั้ง console จะ error เพราะต้องเหลือ unreserved อย่างน้อย 10) — ปริมาณ request คุมด้วย throttling ในขั้นที่ 9.7 แทน

---

## 8. สร้างตารางในฐานข้อมูล

**Lambda → Test → Create new event** ชื่อ `migrate`:
```json
{ "vaultTask": "migrate" }
```
กด **Test** → ต้องได้ `"ok": true, "task": "migrate"`

**ทำไมใช้ Lambda:** RDS อยู่ private subnet เครื่องเราต่อตรงไม่ได้ Lambda อยู่ใน VPC จึงรัน `schema.sql` แทนได้
event นี้เรียกได้จาก console/IAM เท่านั้น คนนอกเรียกผ่าน API ไม่ได้ และรันซ้ำได้ปลอดภัย (`CREATE ... IF NOT EXISTS`)

---

## 9. API Gateway

### 9.1 สร้าง API
**API Gateway → Create API → REST API → Build**
- New API, name `securevault-api`, Endpoint type **Regional**

**ทำไม REST ไม่ใช่ HTTP API:** WAF ผูกได้กับ REST API stage เท่านั้น

### 9.2 Resource `{proxy+}`
1. เลือก `/` → **Create resource** → ✅ **Proxy resource**, name `{proxy+}`, ✅ **CORS** → Create
2. คลิก **ANY** ใต้ `/{proxy+}` → **Edit integration** → Lambda function, ✅ Lambda proxy integration, เลือก `securevault-api` → Save
   (ถ้ามีถาม permission ให้กด OK เพื่อให้ API Gateway เรียก Lambda ได้)

### 9.3 Cognito authorizer
**Authorizers → Create authorizer** — Name `cognito`, Type **Cognito**, User pool จากขั้นที่ 6, Token source `Authorization`

แล้ว **Resources → `/{proxy+}` → ANY → Method request → Edit → Authorization: `cognito`** → Save
`OPTIONS` ของ `/{proxy+}` **ปล่อย NONE** (preflight ของ browser ไม่มี token)

### 9.4 Route public (ใช้ก่อน login)
สร้าง resource ตาม path จริงใต้ `/`:
1. `/` → Create resource `api` → ใต้ `/api` สร้าง `v1` → ใต้ `/api/v1` สร้าง `auth` → ใต้ `/api/v1/auth` สร้าง `salt` (✅ CORS)
2. ใต้ `/api/v1` สร้าง `health` (✅ CORS)
3. `/api/v1/auth/salt` → **Create method GET** → Lambda function, ✅ proxy, `securevault-api`, Authorization **NONE**
4. `/api/v1/health` → **Create method GET** แบบเดียวกัน

**ทำไม:** ก่อน login browser ต้องขอ `kdf_salt` ไปคำนวณกุญแจ ตอนนั้นยังไม่มี token
API Gateway เลือก resource ที่เจาะจงกว่า `{proxy+}` ก่อนเสมอ path อื่นทั้งหมดยังต้องมี token

### 9.5 CORS ของ error จาก API Gateway
**Gateway responses → Default 4XX → Edit** เพิ่ม header:
- `Access-Control-Allow-Origin` = `'*'`
- `Access-Control-Allow-Headers` = `'Content-Type,Authorization'`

ทำเหมือนกันกับ **Default 5XX** — ทำให้ browser อ่าน error 401/403/429 ได้แทนที่จะขึ้น CORS error

### 9.6 Deploy
**Deploy API → New stage: `prod`** → จด **Invoke URL** แล้วต่อท้าย `/api/v1`
เช่น `https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/v1`

แก้ resource/method ครั้งไหนต้อง **Deploy API** ใหม่ทุกครั้ง (อัปโหลดโค้ด Lambda ไม่ต้อง)

### 9.7 จำกัดปริมาณ request (throttling)
**Stages → prod → Stage details → Edit → Throttling** ✅
- Rate: **20** requests/sec
- Burst: **40**

**ทำไม:** เกินนี้ API Gateway ตอบ **429** เอง request ไม่ถึง Lambda/RDS จึงไม่มีทางยิงจนค่าใช้จ่ายพุ่ง
หรือดูเหมือน DoS ไม่ว่าจะเผลอ loop ยิงหรือมีคนนอกยิงเข้ามา

---

## 10. WAF

**WAF & Shield → Create protection pack (web ACL)**

| ช่อง | ค่า |
|---|---|
| Resource type | **Regional resources** (region us-east-1) |
| Resources to protect | **Add resources → API Gateway REST API → `securevault-api - prod`** |
| Rules | **Build your own / Add rules → AWS managed rule groups** |
| | ✅ **Core rule set** → Edit → rule `SizeRestrictions_BODY` = **Count** (กัน payload ciphertext ใหญ่โดนบล็อก) |
| | ✅ **SQL database** |
| | ✅ **Known bad inputs** |
| | ✅ **Rate-based rule** (Add my own rules → Rule type: Rate-based) ชื่อ `rate-limit-ip`, Rate limit **300** / 5 นาที ต่อ IP, Action **Block** |
| Default action | **Allow** |
| CloudWatch metrics | ✅ เปิด (ทั้ง web ACL และทุก rule) |
| Name | `securevault-waf` |

> หน้า WAF อาจขึ้น *Access denied to ListResourcesForWebACL* — เป็นข้อจำกัดสิทธิ์ของ LabRole ไม่กระทบการทำงาน
> ตรวจว่าผูกแล้วที่ **API Gateway → Stages → prod → Web ACL**

WAF ใช้เวลา 1–2 นาทีหลังผูกถึงจะเริ่มบล็อก

---

## 11. Amplify (หน้าเว็บ)

### 11.1 Build
ส่ง **User pool ID**, **Client ID**, **API URL** ให้ Claude build ให้ หรือ build เอง:
```powershell
cd C:\Users\PC\Downloads\vault-main-latest
@"
VITE_API_URL=https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/v1
VITE_AUTH_MODE=cognito
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
"@ | Out-File -Encoding utf8 frontend\.env.production
npm run build --workspace frontend
tar.exe -a -c -f frontend-dist-cognito.zip -C frontend\dist *
```
ค่าเหล่านี้เป็น public identifier ไม่ใช่ secret

### 11.2 Deploy
**Amplify → Create new app → Deploy without Git → Drag and drop** → `frontend-dist-cognito.zip`
- App name `securevault`, Branch `prod`

### 11.3 SPA rewrite
**Hosting → Rewrites and redirects → Manage → Add rule**
- Source: `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|wasm)$)([^.]+$)/>`
- Target: `/index.html`, Type: **200 (Rewrite)**

ถ้าไม่ใส่ กด refresh ที่หน้าอื่นนอกจาก `/` จะได้ 404

จด **Domain** เช่น `https://prod.d1abc234.amplifyapp.com`

---

## 12. ตั้ง CORS ให้ตรงโดเมน

ตอนนี้รู้โดเมน Amplify แล้ว ปิด `*` ให้เหลือเฉพาะเว็บเรา:
1. **Lambda → Environment variables:** `CORS_ALLOW_ORIGIN` = `https://prod.d1abc234.amplifyapp.com` (ไม่มี `/` ท้าย)
2. **API Gateway → Gateway responses → Default 4XX / 5XX:** `Access-Control-Allow-Origin` = `'https://prod.d1abc234.amplifyapp.com'`
3. **Deploy API** ใหม่

---

## 13. ทดสอบ

```powershell
$API = "https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/v1"
curl.exe -s "$API/health"                                    # "database":"connected"
curl.exe -s "$API/auth/salt?identifier=someone"              # ได้ salt
curl.exe -s -o NUL -w "%{http_code}`n" "$API/collections"    # 401 = authorizer ทำงาน
curl.exe -s -o NUL -w "%{http_code}`n" "$API/health?id=1%27%20OR%20%271%27%3D%271"  # 403 = WAF ทำงาน
```

ผ่านหน้าเว็บ:
1. สมัคร → รับรหัส 6 หลักทางอีเมล (ดู Spam) → ยืนยัน
2. Login → ครั้งแรกระบบสร้าง Vault Key → เข้าหน้า vault
3. เพิ่ม / แก้ / ลบรหัสผ่าน, ดูประวัติ
4. สมัครบัญชีที่สอง → แชร์รหัสผ่าน / สร้าง collection ให้สิทธิ์ → login บัญชีที่สองดู
5. ตั้ง MFA (Authenticator app) → logout → login ต้องถามรหัส 6 หลัก
6. ตั้ง admin: **Cognito → Users → เลือก user → Add user to group → admin** → login ใหม่ → เห็นเมนู admin

---

## 14. Monitoring สำหรับรายงาน

| ดูอะไร | ที่ไหน |
|---|---|
| WAF บล็อกการโจมตี | WAF → `securevault-waf` → Dashboard / Sampled requests |
| Lambda ขยายตัว | Lambda → Monitor → Invocations, Concurrent executions |
| API | API Gateway → Dashboard → Count, Latency, 4XX/5XX |
| DB | RDS → Monitoring → CPU, DatabaseConnections |
| Log ของแอป | CloudWatch → Log groups → `/aws/lambda/securevault-api` |
| ใครเรียก AWS API | CloudTrail → Event history (กรอง `GetSecretValue`, `Decrypt`) |
| ผู้ใช้ทั้งหมด | Cognito → Users |

รวมกราฟไว้หน้าเดียว: **CloudWatch → Dashboards → Create** → เพิ่ม Lambda `Invocations`/`ConcurrentExecutions`,
ApiGateway `Count`/`Latency`, RDS `CPUUtilization`/`DatabaseConnections`, WAFV2 `AllowedRequests`/`BlockedRequests`

### Load test แบบปลอดภัย (ไม่ให้บัญชีโดนปิด)

กฎของ AWS อนุญาตให้ทดสอบ resource ของเราเองได้ แต่ **ห้ามยิงแบบ DoS / flood** และ Learner Lab ตรวจการใช้งานผิดปกติด้วย
ให้ทดสอบภายในกรอบนี้:

| กฎ | ค่า |
|---|---|
| request ต่อรอบ | **ไม่เกิน 200** |
| ความเร็ว | **ไม่เกิน ~10 req/s** (ต่ำกว่า throttling 20 ที่ตั้งไว้) |
| จำนวนรอบ | 1–2 รอบพอ (ใช้แคปกราฟ) |
| เป้าหมาย | URL API ของเราเท่านั้น ห้ามยิง endpoint ของ AWS อื่นหรือของคนอื่น |
| เครื่องมือ | curl จากเครื่องตัวเอง ห้ามใช้ EC2 หลายเครื่อง / เครื่องมือ stress test ขนาดใหญ่ |
| ทดสอบ WAF | ส่ง payload SQLi/XSS/Log4j **ไม่กี่ครั้ง** พอให้เห็นกราฟ Blocked |

```powershell
# 200 request, 10 job x 20 ครั้ง, หน่วง 1 วินาทีต่อครั้ง ≈ 10 req/s
$jobs = 1..10 | % { Start-Job { param($u) 1..20 | % { curl.exe -s -o NUL -w "%{http_code}`n" $u; Start-Sleep 1 } } -ArgumentList "$API/health" }
$jobs | Wait-Job | Receive-Job | Group-Object | Select Name, Count; $jobs | Remove-Job
```
ผลที่ควรได้: 200 ทั้งหมด ถ้ามี **429** แปลว่า throttling ทำงาน (ใส่ในรายงานได้ว่าระบบกันโหลดเกินได้)

ทดสอบ rate-based rule ของ WAF: ไม่ต้องยิงจริงถึง 300 ครั้ง ให้ชี้ในรายงานว่าตั้งไว้ แล้วแคปหน้า rule ก็พอ

---

## 15. เปิด Multi-AZ ตอน demo

ทำก่อน demo/แคปหลักฐาน ~30 นาที แล้วปิดกลับหลังเสร็จ
1. **RDS → securevault-db → Modify → Availability: Multi-AZ DB instance** → Continue → **Apply immediately**
2. รอสถานะ *Available* (10–20 นาที)
3. ทดสอบ failover: **Actions → Reboot → ✅ Reboot with failover** → ดู **Logs & events** ต้องมี *Multi-AZ instance failover completed*
4. เสร็จแล้ว Modify กลับเป็น **Single-AZ** เพื่อประหยัดงบ

---

## 16. แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `Internal server error` หลังเปิด lab | RDS กำลัง start รอ 3–5 นาที |
| Lambda `Task timed out` | ไม่มี Interface Endpoint / ไม่ได้เปิด DNS name / `sg-endpoint` ไม่เปิด 443 จาก `sg-lambda` / RDS stop อยู่ |
| `self-signed certificate in certificate chain` | ลืม `NODE_EXTRA_CA_CERTS` |
| `database "securevault" does not exist` | ไม่ได้ใส่ Initial database name ตอนสร้าง RDS → ตั้ง `DB_NAME=postgres` แทน |
| `relation "users" does not exist` | ยังไม่ได้รัน event `migrate` (ขั้นที่ 8) |
| ทุก API ได้ 401 แม้ login แล้ว | authorizer เลือก user pool ผิด / ยังไม่ Deploy API |
| `/auth/salt` ได้ 401 | resource public ผิด path หรือยังไม่ Deploy API |
| เบราว์เซอร์ขึ้น CORS error | `CORS_ALLOW_ORIGIN` ไม่ตรงโดเมน Amplify / Gateway responses ไม่มี header |
| Login: `USER_SRP_AUTH is not enabled` | App client ไม่ได้ติ๊ก `ALLOW_USER_SRP_AUTH` |
| สมัครแล้วไม่ได้อีเมล | ดู Spam / Cognito จำกัด ~50 ฉบับต่อวัน / Cognito → Users → **Confirm account** แทน |
| เมนู admin ไม่ขึ้น | ยังไม่อยู่ใน group `admin` หรือยังไม่ได้ login ใหม่ |
| SQLi ไม่โดนบล็อก (ไม่ได้ 403) | WAF ยังไม่ผูก stage `prod` หรือรอไม่ถึง 2 นาที |
| `AWS account deactivated` | งบ Learner Lab หมด → ติดต่ออาจารย์ |
