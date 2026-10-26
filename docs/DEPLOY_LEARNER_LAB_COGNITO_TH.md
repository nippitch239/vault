# อัปเกรด SecureVault บน Learner Lab เป็นเวอร์ชัน `main` (Cognito)

คู่มือนี้ใช้ต่อจากระบบที่ deploy ไว้แล้วตาม `DEPLOY_LEARNER_LAB_TH.md` (branch `aws-deploy`)
**ของเดิมที่ใช้ต่อได้เลย:** VPC, subnet, security group, RDS, Interface Endpoint (Secrets Manager), WAF, API Gateway, Amplify app

**ของที่ต้องทำเพิ่มหรือแก้**

| # | ขั้นตอน | ทำที่ |
|---|---|---|
| 1 | สร้าง secret `saltPepper` | Secrets Manager |
| 2 | สร้าง Cognito User Pool + App Client + group `admin` | Cognito |
| 3 | อัปโหลดโค้ด Lambda ใหม่ + แก้ handler / env / timeout | Lambda |
| 4 | ล้างฐานข้อมูลเก่าแล้วสร้าง schema ใหม่ | Lambda (Test) |
| 5 | ใส่ Cognito authorizer + route public | API Gateway |
| 6 | Build และอัปโหลดหน้าเว็บใหม่ | Amplify |
| 7 | ทดสอบ | เบราว์เซอร์ / curl |

> **คำเตือน:** ขั้นตอนที่ 4 ลบข้อมูลทั้งหมดใน RDS (user, รหัสผ่าน, collection เดิม) เพราะ schema ใหม่ไม่เข้ากับของเดิม
> ทุกคนต้องสมัครบัญชีใหม่

---

## ทำไมต้องเปลี่ยน

| เรื่อง | เวอร์ชันเดิม (`aws-deploy`) | เวอร์ชันใหม่ (`main`) |
|---|---|---|
| Login / สมัคร / MFA | Lambda ทำเอง ออก JWT เอง (JWT secret ใน Secrets Manager) | **Amazon Cognito** จัดการทั้งหมด: ยืนยันอีเมล, TOTP MFA, token |
| ตรวจ token | Lambda ตรวจเอง | **API Gateway Cognito authorizer** ตรวจก่อนถึง Lambda (request ปลอมไม่ถึง Lambda เลย) |
| Admin | env `ADMIN_EMAILS` | Cognito group `admin` |
| Key ของ vault | MEK จาก password เข้ารหัส item ตรง ๆ | Vault Key สุ่ม ห่อด้วย KEK จาก password (เปลี่ยนรหัสได้โดยไม่ต้องเข้ารหัสทุก item ใหม่) |
| ฟีเจอร์ | vault, share, collection, group | + organization, folder, collection แบบใหม่ |
| Lambda package | zip ของ source + node_modules | **bundle ไฟล์เดียว** (`index.mjs`) ขนาด ~75 KB |

ตรงกับ diagram เดิมที่มี Cognito อยู่ระหว่าง Amplify กับ API Gateway

---

## ขั้นตอนที่ 1 — Secret `saltPepper`

backend ใช้ค่านี้สร้าง salt ปลอมให้ username ที่ยังไม่มีในระบบ (กันคนเดาว่า username ไหนมีอยู่จริง)

**Secrets Manager → Store a new secret**

| ช่อง | ค่า |
|---|---|
| Secret type | **Other type of secret** |
| Key/value | Key: `saltPepper` Value: สตริงสุ่มยาว ๆ (ด้านล่าง) |
| Encryption key | `aws/secretsmanager` |
| Secret name | `securevault/app` |
| Rotation | ปิด |

สร้างค่าสุ่มใน PowerShell:
```powershell
-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
```

เสร็จแล้วเปิด secret → copy **Secret ARN** เก็บไว้ (`APP_SECRET_ARN`)

> **ห้ามเปลี่ยนค่านี้ภายหลัง** ถ้าเปลี่ยน salt ของ username ที่ยังไม่สมัครจะเปลี่ยนตาม

---

## ขั้นตอนที่ 2 — Cognito User Pool

**Cognito → User pools → Create user pool**

หน้าแรก (Set up resources for your application):

| ช่อง | ค่า | ทำไม |
|---|---|---|
| Application type | **Single-page application (SPA)** | เว็บ React ไม่มี client secret |
| Name your application | `securevault-web` | |
| Options for sign-in identifiers | ✅ **Username** ✅ **Email** | แอปให้ login ด้วย username หรืออีเมลก็ได้ |
| Self-registration | ✅ Enable | ให้ผู้ใช้สมัครเองจากหน้าเว็บ |
| Required attributes for sign-up | **email** | |
| Return URL | เว้นว่าง | แอปไม่ได้ใช้ Hosted UI |

กด **Create user directory** แล้วไปแก้ต่อใน user pool ที่ได้:

### 2.1 MFA
**Authentication → Sign-in → Multi-factor authentication → Edit**
- MFA enforcement: **Optional MFA**
- MFA methods: ✅ **Authenticator apps** (ไม่ต้องติ๊ก SMS / Email)

**ทำไม:** ผู้ใช้เลือกเปิด TOTP เองได้ในหน้าตั้งค่า (UC-3) ส่วน SMS ใน Learner Lab ส่งไม่ได้

### 2.2 Account recovery
**Authentication → Sign-in → User account recovery → Edit**
- ❌ ปิด *Enable self-service account recovery* (หรือเลือก *None – admin only*)

**ทำไม:** ทีมตัดสินใจไม่มี forgot password (ลืม master password = เปิด vault ไม่ได้อยู่แล้วตามหลัก zero-knowledge)

### 2.3 App client
**Applications → App clients → securevault-web**
- ตรวจ **Authentication flows** มี ✅ `ALLOW_USER_SRP_AUTH` และ ✅ `ALLOW_REFRESH_TOKEN_AUTH`
- **Client secret:** ต้อง *ไม่มี* (SPA สร้างแบบไม่มีให้อยู่แล้ว)
- (แนะนำ) **Edit → Prevent user existence errors: Enabled**

### 2.4 Group admin
**User management → Groups → Create group** → Name: `admin`

ตั้งใครเป็น admin: หลังเขาสมัครแล้ว → **Users** → คลิก user → **Add user to group** → `admin`
(ผู้ใช้ต้อง logout/login ใหม่ token ถึงจะมี group)

### 2.5 จดค่า
| ค่า | หาที่ไหน |
|---|---|
| **User pool ID** เช่น `us-east-1_AbCdEf123` | หน้า Overview |
| **User pool ARN** | หน้า Overview |
| **Client ID** | Applications → App clients |

> อีเมลยืนยันส่งโดย Cognito เอง จำกัด ~50 ฉบับ/วัน พอสำหรับ demo ถ้าไม่เห็นอีเมลให้ดูใน Spam

---

## ขั้นตอนที่ 3 — อัปเดต Lambda

### 3.1 Code
**Lambda → function เดิม → Code → Upload from → .zip file** → เลือก `backend-lambda-cognito.zip`

### 3.2 Runtime settings
**Code → Runtime settings → Edit**
- Runtime: **Node.js 22.x**
- Handler: **`index.handler`** (เดิม `src/server/lambda.handler`)

**ทำไม:** โค้ดใหม่ build เป็นไฟล์เดียว `index.mjs` ด้วย esbuild รวม `pg` ไว้ข้างในแล้ว ส่วน AWS SDK ใช้ของที่ Lambda มีให้

### 3.3 General configuration
**Configuration → General configuration → Edit**
- Memory: **512 MB**
- Timeout: **15 sec**

### 3.4 Environment variables
**Configuration → Environment variables → Edit** — ลบของเดิมให้หมด แล้วใส่ชุดนี้:

| Key | Value | หมายเหตุ |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DB_SECRET_ARN` | ARN ของ secret `rds!db-xxxx` (ตัวเดิม) | username/password ของ RDS |
| `DB_HOST` | endpoint ของ RDS (ตัวเดิม) | secret ที่ RDS สร้างไม่มี host |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `vault` | ชื่อ DB เดิมที่สร้างตอนสร้าง RDS |
| `APP_SECRET_ARN` | ARN จากขั้นตอนที่ 1 | |
| `NODE_EXTRA_CA_CERTS` | `/var/runtime/ca-cert.pem` | **สำคัญ** โค้ดใหม่ตรวจ certificate ของ RDS จริง (`rejectUnauthorized: true`) ไฟล์นี้มี CA ของ RDS |
| `COGNITO_ADMIN_GROUP` | `admin` | |
| `CORS_ALLOW_ORIGIN` | `https://prod.djeyvvn95x6kw.amplifyapp.com` | โดเมน Amplify (ไม่มี `/` ท้าย) |
| `DB_POOL_MAX` | `2` | |

ลบทิ้ง: `JWT_SECRET_ARN`, `INIT_SCHEMA`, `ADMIN_EMAILS`, `SES_FROM_EMAIL`, `DATABASE_URL` (ถ้ามี)

> `JWT_SECRET_ARN` ไม่ใช้แล้วเพราะ Cognito เป็นคนออก token — secret `securevault/jwt` ลบทิ้งได้

VPC, subnet, security group, execution role (`LabRole`) ใช้ของเดิม **ไม่ต้องแก้**

---

## ขั้นตอนที่ 4 — ล้างฐานข้อมูลเก่าและสร้าง schema ใหม่

**Lambda → Test → Create new event**
- Event name: `reset-db`
- Event JSON:
```json
{ "vaultTask": "reset", "confirm": "DROP ALL DATA" }
```
กด **Test** → ต้องได้ `"ok": true, "task": "reset"`

**ทำไมใช้ Lambda:** RDS อยู่ private subnet เครื่องเราต่อตรงไม่ได้ Lambda อยู่ใน VPC อยู่แล้วจึงสั่ง SQL แทนได้
event นี้เรียกได้จาก console/IAM เท่านั้น ไม่ผ่าน API Gateway คนนอกจึงสั่งไม่ได้

**หลังจากนี้** ถ้าอัปเดตโค้ดที่มี schema เพิ่ม ให้ใช้ event แบบไม่ลบข้อมูล:
```json
{ "vaultTask": "migrate" }
```
**ห้ามกด `reset-db` ซ้ำ** หลังเริ่มใช้งานจริง — ลบ event นั้นทิ้งได้เลยกันกดพลาด

| Error | สาเหตุ |
|---|---|
| `self-signed certificate in certificate chain` | ลืม `NODE_EXTRA_CA_CERTS` |
| `Task timed out` | RDS stop อยู่ (lab เพิ่งเริ่ม) หรือ SG ผิด |
| `password authentication failed` | `DB_SECRET_ARN` ผิดตัว |
| `database "securevault" does not exist` | ลืมตั้ง `DB_NAME=vault` |

---

## ขั้นตอนที่ 5 — API Gateway: Cognito authorizer

### 5.1 สร้าง authorizer
**API Gateway → securevault-api → Authorizers → Create authorizer**

| ช่อง | ค่า |
|---|---|
| Name | `cognito` |
| Type | **Cognito** |
| Cognito user pool | เลือก pool จากขั้นตอนที่ 2 |
| Token source | `Authorization` |

### 5.2 ให้ทุก route ต้องมี token
**Resources → `/{proxy+}` → ANY → Method request → Edit**
- Authorization: **cognito**
- Save

`OPTIONS` ของ `/{proxy+}` (ที่สร้างตอน Enable CORS) **ปล่อยเป็น NONE** — browser ส่ง preflight โดยไม่มี token

### 5.3 route public 2 ตัว (ใช้ก่อน login)
ต้องสร้าง resource ตามชื่อ path จริง (ใต้ `/` ไม่ใช่ใต้ `{proxy+}`):

1. เลือก `/` → **Create resource** → name `api`
2. เลือก `/api` → Create resource → `v1`
3. เลือก `/api/v1` → Create resource → `auth` → แล้วใต้ `/api/v1/auth` สร้าง `salt` (✅ CORS)
4. เลือก `/api/v1` → Create resource → `health` (✅ CORS)
5. เลือก `/api/v1/auth/salt` → **Create method** → `GET`
   - Integration type: **Lambda function**, ✅ **Lambda proxy integration**, เลือก function เดิม
   - Authorization: **NONE**
6. ทำแบบเดียวกันกับ `/api/v1/health` → `GET`

**ทำไม:** ก่อน login เบราว์เซอร์ต้องขอ `kdf_salt` ไปคำนวณกุญแจจาก master password ตอนนั้นยังไม่มี token
API Gateway เลือก resource ที่เจาะจงกว่า `{proxy+}` ก่อนเสมอ ส่วน path อื่นทั้งหมดยังโดน authorizer

### 5.4 Deploy
**Deploy API → Stage: prod** (แก้ resource/method ทุกครั้งต้อง deploy ใหม่)

WAF ที่ผูกกับ stage `prod` อยู่แล้ว **ไม่ต้องทำใหม่**

---

## ขั้นตอนที่ 6 — Amplify (หน้าเว็บใหม่)

### 6.1 Build
ส่งค่า **User pool ID** และ **Client ID** ให้ Claude build ให้ หรือ build เอง:

```powershell
cd C:\Users\PC\Downloads\vault-main-latest
@"
VITE_API_URL=https://engq4g7fz6.execute-api.us-east-1.amazonaws.com/prod/api/v1
VITE_AUTH_MODE=cognito
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
"@ | Out-File -Encoding utf8 frontend\.env.production
npm run build --workspace frontend
tar.exe -a -c -f frontend-dist-cognito.zip -C frontend\dist *
```

ค่าพวกนี้เป็น public identifier ไม่ใช่ secret (อยู่ใน JS ที่ browser โหลดอยู่แล้ว)

### 6.2 Deploy
**Amplify → app เดิม → Hosting → Deploy updates → Drag and drop** → `frontend-dist-cognito.zip`

### 6.3 SPA rewrite (ถ้ายังไม่มี)
**Hosting → Rewrites and redirects → Manage** เพิ่ม:
- Source: `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|wasm)$)([^.]+$)/>`
- Target: `/index.html` Type: **200 (Rewrite)**

---

## ขั้นตอนที่ 7 — ทดสอบ

```powershell
$API = "https://engq4g7fz6.execute-api.us-east-1.amazonaws.com/prod/api/v1"
curl.exe -s "$API/health"                                     # engine=postgres, database=connected
curl.exe -s "$API/auth/salt?identifier=someone"               # ได้ salt (route public)
curl.exe -s -o NUL -w "%{http_code}`n" "$API/collections"     # 401 = authorizer ทำงาน
curl.exe -s -o NUL -w "%{http_code}`n" "$API/auth/salt?identifier=1%27%20OR%20%271%27%3D%271"  # 403 = WAF
```

ผ่านหน้าเว็บ:
1. สมัครสมาชิก → ได้อีเมลรหัส 6 หลัก → ยืนยัน
2. Login → ครั้งแรกระบบสร้าง Vault Key → เห็นหน้า vault
3. เพิ่มรหัสผ่าน / สร้าง collection / แชร์ให้บัญชีที่สอง
4. ตั้ง MFA (Authenticator) → logout → login ใหม่ต้องถามรหัส 6 หลัก
5. ตรวจใน AWS: **Cognito → Users** เห็น user ใหม่ / **CloudWatch Logs** ของ Lambda ไม่มี `"level":"error"`

---

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ทุก API ได้ **401** แม้ login แล้ว | authorizer เลือก user pool ผิด หรือยังไม่ได้ Deploy API |
| `/auth/salt` ได้ 401 | resource public สร้างผิด path หรือยังไม่ deploy |
| เบราว์เซอร์ขึ้น **CORS error** | `CORS_ALLOW_ORIGIN` ไม่ตรงโดเมน Amplify (ต้องมี `https://` และไม่มี `/` ท้าย) |
| สมัครแล้วไม่ได้อีเมล | ดู Spam / Cognito จำกัด ~50 ฉบับต่อวัน / ยืนยันแทนได้ที่ Cognito → Users → **Confirm account** |
| Login ขึ้น `USER_SRP_AUTH is not enabled` | App client ไม่ได้ติ๊ก `ALLOW_USER_SRP_AUTH` |
| `Internal server error` หลังเปิด lab ใหม่ | RDS ยังไม่ start ให้รอ 3–5 นาที (เหมือนเดิม) |
| Admin เมนูไม่ขึ้น | ยังไม่ได้เพิ่มเข้า group `admin` หรือยังไม่ได้ login ใหม่ |
