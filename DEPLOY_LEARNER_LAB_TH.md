# SecureVault — คู่มือ Deploy บน AWS Academy Learner Lab (ผ่านหน้าเว็บ Console)

> คู่มือนี้อธิบาย **ทุกขั้นตอน** พร้อมเหตุผลว่า **ทำไปทำไม** และ **ทำไมถึงเลือกแบบนี้** รวมถึงเปรียบเทียบกับคู่มือเดิม (`DEPLOY_AWS_CONSOLE (1).md`) ว่าต่างกันตรงไหน และทำไมของเดิมถึงพังที่ Lambda

---

## สารบัญ

0. [ภาพรวมสถาปัตยกรรม](#0-ภาพรวมสถาปัตยกรรม)
1. [เปรียบเทียบกับคู่มือเดิม — ทำไมของเดิมพัง](#1-เปรียบเทียบกับคู่มือเดิม--ทำไมของเดิมพัง)
2. [ทำไมใช้แค่ Private Subnet (ไม่มี Public Subnet / NAT)](#2-ทำไมใช้แค่-private-subnet-ไม่มี-public-subnet--nat)
3. [ข้อจำกัดของ Learner Lab](#3-ข้อจำกัดของ-learner-lab)
4. [ขั้นตอนที่ 0 — เริ่ม Lab](#ขั้นตอนที่-0--เริ่ม-lab)
5. [ขั้นตอนที่ 1 — สร้าง VPC](#ขั้นตอนที่-1--สร้าง-vpc)
6. [ขั้นตอนที่ 2 — Security Groups](#ขั้นตอนที่-2--security-groups)
7. [ขั้นตอนที่ 3 — RDS PostgreSQL](#ขั้นตอนที่-3--rds-postgresql)
8. [ขั้นตอนที่ 4 — JWT Secret](#ขั้นตอนที่-4--jwt-secret)
9. [ขั้นตอนที่ 5 — VPC Interface Endpoint](#ขั้นตอนที่-5--vpc-interface-endpoint-secrets-manager)
10. [ขั้นตอนที่ 6 — Lambda](#ขั้นตอนที่-6--lambda)
11. [ขั้นตอนที่ 7 — API Gateway](#ขั้นตอนที่-7--api-gateway-rest-api)
12. [ขั้นตอนที่ 8 — WAF](#ขั้นตอนที่-8--waf)
13. [ขั้นตอนที่ 9 — Build Frontend](#ขั้นตอนที่-9--build-frontend-ในเครื่อง)
14. [ขั้นตอนที่ 10 — Amplify](#ขั้นตอนที่-10--amplify)
15. [ขั้นตอนที่ 11 — CloudWatch / CloudTrail](#ขั้นตอนที่-11--cloudwatch--cloudtrail)
16. [การอัปเดตโค้ด](#การอัปเดตโค้ด)
17. [Troubleshooting รวม](#troubleshooting-รวม)

---

## 0. ภาพรวมสถาปัตยกรรม

```
 Desktop (Browser)
     │
     ▼
 Amplify  ──────────── (หน้าเว็บ React ที่ build แล้ว: HTML/JS/CSS)
     │ เรียก API ด้วย fetch()
     ▼
 WAF  ───────────────── (กรอง request อันตราย เช่น SQL injection)
     ▼
 API Gateway (REST) ─── (ประตูรับ HTTP แล้วส่งต่อให้ Lambda)
     ▼
 Lambda (อยู่ใน VPC) ── (โค้ด backend Node.js)
     │                 │
     │                 └──► VPC Interface Endpoint ──► Secrets Manager (+KMS)
     ▼                                               (ดึงรหัสผ่าน DB / JWT secret)
 RDS PostgreSQL Primary (AZ a) ══ Replication ══► RDS Standby (AZ b)

 CloudWatch = ดู log/metric     CloudTrail = บันทึกว่าใครทำอะไรกับบัญชี AWS
```

**ไฟล์ที่ใช้** (อยู่ใน `C:\Users\PC\Downloads\vault-aws\`)

| ไฟล์/โฟลเดอร์ | ใช้ทำอะไร |
|---|---|
| `backend-lambda.zip` | อัปโหลดขึ้น Lambda (มี `pg`, `hash-wasm`, `src/server`, `src/shared`, `package.json` ครบแล้ว) |
| `backend\` | source โค้ด backend (ไว้แก้แล้ว zip ใหม่) |
| `frontend\` | React app — build ครั้งเดียวได้ `dist` ไปอัปโหลด Amplify |

**ทำไมต้องแยก frontend / backend?**
โปรเจกต์ต้นฉบับ (`vault-main.zip`) รวมทุกอย่างอยู่ในโปรเจกต์เดียว (`src/client`, `src/server`, `src/shared`) ซึ่งตอน dev ในเครื่องไม่มีปัญหา แต่ตอน deploy:
- **Frontend** ต้องเป็นไฟล์ static (HTML/JS/CSS) → เหมาะกับ **Amplify** (มี CDN, HTTPS ให้ฟรี)
- **Backend** ต้องเป็นโค้ดที่รันเมื่อมี request → เหมาะกับ **Lambda** (จ่ายตามการใช้งาน, ไม่ต้องดูแล server)

ทั้งสองฝั่งใช้โค้ด `shared/` (เข้ารหัส, ตรวจรหัสผ่าน) ร่วมกัน เลยต้อง **copy `shared` ไปทั้งสองฝั่ง** ไม่งั้น import ไม่เจอ

---

## 1. เปรียบเทียบกับคู่มือเดิม — ทำไมของเดิมพัง

### 1.1 สาเหตุที่ Lambda บอกว่า "ไม่มี package"

คู่มือเดิมขั้นตอน 5 สั่งว่า:
```bash
cd src/server
npm install
zip -r ../../lambda-package.zip . -x "*.test.js"
```

| ปัญหา | อธิบาย | ผลที่เกิด |
|---|---|---|
| **ไม่มีไฟล์ `src/server/package.json`** | คู่มือบอกว่า "เตรียมไว้ให้แล้วในโปรเจกต์" แต่ในไฟล์ zip จริงไม่มี | `npm install` ไม่ติดตั้งอะไรเลย → ไม่มี `node_modules/pg` → **`Cannot find package 'pg'`** |
| **ไม่มี `"type": "module"`** | โค้ดใช้ `import/export` (ESM) ถ้าไม่มี package.json บอก Node จะคิดว่าเป็น CommonJS | **`SyntaxError: Cannot use import statement outside a module`** |
| **zip แค่ `src/server` แต่โค้ดต้องใช้ `src/shared`** | `handlers/auth.js` มี `import ... from '../../shared/crypto.js'` | **`Cannot find module '.../shared/crypto.js'`** |
| **ไม่ได้ติดตั้ง `hash-wasm`** | `shared/crypto.js` ใช้ `import { argon2id } from 'hash-wasm'` | **`Cannot find package 'hash-wasm'`** |
| **Runtime Node.js 20.x** | `db/adapter.js` บรรทัดบนสุด `import { DatabaseSync } from 'node:sqlite'` ซึ่ง **Node 20 ไม่มี** (เพิ่งมีใน Node 22) | Lambda **crash ตั้งแต่โหลดไฟล์** ก่อนจะถึงโค้ดเชื่อม DB ด้วยซ้ำ |
| **คำสั่ง `zip` ไม่มีใน Windows** | PowerShell ไม่มีคำสั่ง `zip` | ถ้า zip ด้วยการคลิกขวาที่ "โฟลเดอร์" → ไฟล์จะซ้อนอยู่ในโฟลเดอร์ย่อยอีกชั้น → Lambda หา handler ไม่เจอ |

### 1.2 สิ่งที่แก้ในโค้ด

| ไฟล์ | แก้อะไร | ทำไม |
|---|---|---|
| `backend/package.json` (ใหม่) | ประกาศ `"type": "module"` + dependency `pg`, `hash-wasm` | ให้ `npm install` ติดตั้งของที่จำเป็นจริง และให้ Node อ่าน ESM ได้ |
| `backend/src/server/lambda.js` (ใหม่) | ไฟล์ entry ของ Lambda: ดึง secret จาก Secrets Manager → ประกอบ `DATABASE_URL` → โหลด router → (ถ้า `INIT_SCHEMA=true`) สร้างตาราง | (1) ไม่ต้องเอารหัสผ่าน DB ไปแปะเป็น plain text ใน environment variable (2) ไม่ต้องเข้า CloudShell ไปรัน `psql` สร้างตารางเอง |
| `backend/src/server/db/adapter.js` | เปลี่ยน `import 'node:sqlite'` เป็นโหลดเฉพาะตอนใช้ SQLite จริง + เปิด SSL เมื่อ `NODE_ENV=production` | Lambda ใช้ PostgreSQL อย่างเดียว ไม่ควรพังเพราะ SQLite / RDS PostgreSQL 15+ **บังคับ SSL** โดยค่าเริ่มต้น |
| `frontend/shared/` (copy มา) + `services/crypto.js` | เปลี่ยน import จาก `../../../shared` เป็น `../../shared` | ให้ frontend build ได้ด้วยตัวเองโดยไม่ต้องพึ่งโฟลเดอร์นอก |

### 1.3 เปรียบเทียบสถาปัตยกรรม เดิม vs ใหม่

| หัวข้อ | คู่มือเดิม | คู่มือใหม่ | เหตุผลที่เปลี่ยน |
|---|---|---|---|
| Subnet | Public + Private + **NAT Gateway** | **Private อย่างเดียว** + VPC Endpoint | ดูหัวข้อ 2 (ปลอดภัยกว่า ถูกกว่า ตรงกับ diagram) |
| ดึงรหัสผ่าน DB | ไปเปิด Secrets Manager ดูเอง แล้ว **copy มาแปะ** เป็น `DATABASE_URL` | Lambda **ดึงเองตอน runtime** ผ่าน VPC Endpoint | รหัสผ่านไม่โผล่ใน console ของ Lambda / ถ้า RDS หมุนรหัสผ่าน ก็ไม่ต้องแก้ Lambda |
| JWT secret | แปะเป็น plain text env var | เก็บใน Secrets Manager | เหตุผลเดียวกัน — ใครเปิดหน้า Lambda ก็เห็น env var ได้ |
| สร้างตาราง | เปิด CloudShell ใน VPC แล้วรัน `psql -f schema.sql` | `INIT_SCHEMA=true` ให้ Lambda สร้างเองครั้งแรก | CloudShell VPC ใน Learner Lab ใช้ยาก/บางครั้งไม่ได้ และต้องอัปโหลดไฟล์ schema เอง |
| Lambda Runtime | Node.js 20.x | **Node.js 22.x** | Node 20 ไม่มี `node:sqlite` และ AWS SDK v3 มีมาให้ใน 22 อยู่แล้ว |
| Handler | `router.router` | `src/server/lambda.handler` | ไฟล์ entry ใหม่ที่โหลด secret ก่อน |
| API Gateway | **HTTP API** | **REST API** | **WAF ผูกกับ HTTP API ไม่ได้** ผูกได้แค่ REST API (diagram มี WAF หน้า API Gateway) |
| WAF | ไม่มี | มี | ตาม diagram |
| IAM Role | สร้าง role ใหม่ หรือ LabRole | **LabRole อย่างเดียว** | Learner Lab ห้ามสร้าง IAM role |
| RDS | Single-AZ | **Multi-AZ** (ถ้า lab อนุญาต) | diagram มี RDS Standby ใน AZ b |

---

## 2. ทำไมใช้แค่ Private Subnet (ไม่มี Public Subnet / NAT)

### 2.1 Public subnet กับ Private subnet ต่างกันยังไง

| | Public Subnet | Private Subnet |
|---|---|---|
| Route table | มี route `0.0.0.0/0 → Internet Gateway` | **ไม่มี** route ออกอินเทอร์เน็ต |
| คนนอกเข้าถึงได้ไหม | ได้ (ถ้ามี public IP + security group เปิด) | **ไม่ได้เลย** |
| ใช้กับ | Load balancer, NAT Gateway, Bastion host | Database, Lambda, server ภายใน |

### 2.2 แล้วในระบบเรา ใครต้องอยู่ public บ้าง?

ลองไล่ดูทีละตัว:

- **Amplify** → เป็น managed service ของ AWS **อยู่นอก VPC** มี URL สาธารณะของตัวเอง ไม่ต้องใช้ subnet
- **WAF / API Gateway** → managed service **อยู่นอก VPC** มี endpoint สาธารณะของตัวเอง
- **Lambda** → ถูก **API Gateway เรียกผ่าน AWS เอง** (ไม่ได้มีคนยิงเข้า IP ของ Lambda) ดังนั้นแม้จะอยู่ private subnet ก็ถูกเรียกได้ปกติ
- **RDS** → ต้องให้แค่ Lambda เข้าถึง ห้ามคนนอก → private แน่นอน

**สรุป: ไม่มีอะไรต้องอยู่ public subnet เลย** → ไม่ต้องสร้าง

### 2.3 แล้วทำไมคู่มือเดิมมี NAT Gateway?

NAT Gateway มีไว้ให้ของใน private subnet **ออก**อินเทอร์เน็ตได้ (ขาออกอย่างเดียว) คู่มือเดิมใส่ไว้เผื่อ Lambda ต้องเรียกอะไรข้างนอก

แต่ Lambda ของเราเรียกออกไปแค่ **2 ที่**:
1. **RDS** → อยู่ใน VPC เดียวกัน คุยกันตรง ๆ ไม่ต้องผ่านเน็ต
2. **Secrets Manager** → เป็นบริการ AWS ซึ่งใช้ **VPC Interface Endpoint** แทนได้ (ขั้นตอนที่ 5)

| | NAT Gateway (เดิม) | VPC Interface Endpoint (ใหม่) |
|---|---|---|
| ต้องมี public subnet | **ต้องมี** (NAT ต้องอยู่ public subnet + Elastic IP) | ไม่ต้อง |
| ทราฟฟิกวิ่งผ่าน | อินเทอร์เน็ตสาธารณะ (ไปหา endpoint สาธารณะของ AWS) | **เครือข่ายภายในของ AWS** ไม่ออกเน็ตเลย |
| ความปลอดภัย | Lambda ออกเน็ตได้ทุกที่ → ถ้าโค้ดโดนเจาะ ส่งข้อมูลออกไปข้างนอกได้ | ออกได้แค่ Secrets Manager → **ข้อมูลรั่วออกไปยาก** |
| ราคา (us-east-1 โดยประมาณ) | ~$0.045/ชม. + ค่าข้อมูล ≈ **$32+/เดือน** | ~$0.01/ชม./AZ ≈ **$15/เดือน** (2 AZ) |
| ใน Learner Lab | กิน budget ($50–100) เร็ว และ Elastic IP บางทีถูกจำกัด | ประหยัดกว่า |
| ตรงกับ diagram | ❌ diagram ไม่มี NAT/public subnet | ✅ diagram มี "Interface Endpoint" ทั้ง AZ a และ AZ b |

> **ข้อควรรู้:** ถ้าวันหนึ่งโค้ด backend ต้องเรียก API ภายนอก (เช่น ส่ง SMS ผ่าน Twilio, ส่งอีเมลผ่าน SendGrid) **ตอนนั้นค่อยเพิ่ม public subnet + NAT** เพราะ VPC Endpoint ใช้ได้กับบริการของ AWS เท่านั้น ตอนนี้โค้ดไม่มีการเรียกภายนอก จึงไม่จำเป็น

### 2.4 ทำไมต้อง 2 AZ?

- **RDS Multi-AZ** และ **DB Subnet Group** บังคับว่าต้องมี subnet อย่างน้อย 2 AZ
- ถ้า AZ a ล่ม → RDS สลับไป Standby ใน AZ b อัตโนมัติ (failover ~1–2 นาที) และ Lambda ก็ยังรันใน AZ b ได้
- VPC Endpoint ก็วางไว้ทั้ง 2 AZ ด้วยเหตุผลเดียวกัน

---

## 3. ข้อจำกัดของ Learner Lab

| ข้อจำกัด | ผลกระทบ | วิธีรับมือ |
|---|---|---|
| ใช้ได้เฉพาะ **us-east-1** (และ us-west-2 บางบริการ) | สร้างที่ region อื่นจะ error สิทธิ์ | ตรวจมุมขวาบนให้เป็น **N. Virginia** ทุกครั้ง |
| **สร้าง IAM Role ไม่ได้** | สร้าง role ให้ Lambda เองไม่ได้ | ใช้ **`LabRole`** ที่มีให้แล้ว (สิทธิ์กว้าง ครอบคลุม VPC, Secrets Manager, Logs) |
| Session ~4 ชม. หมดแล้วหยุด | RDS/EC2 ถูก stop | กด **Start Lab** ใหม่ แล้วรอ RDS กลับมา Available ก่อนทดสอบ |
| จำกัด instance ขนาดเล็ก | สร้าง DB ใหญ่ไม่ได้ | ใช้ **db.t3.micro** |
| Budget จำกัด | ถ้าหมด lab ถูกปิด | ไม่ใช้ NAT Gateway, ลบของที่ไม่ใช้ |

---

## ขั้นตอนที่ 0 — เริ่ม Lab

1. เข้า AWS Academy → Learner Lab → **Start Lab**
2. รอจุดข้าง "AWS" เป็น **สีเขียว** → คลิก **AWS**
3. มุมขวาบน เลือก region **US East (N. Virginia) us-east-1**

**ทำไม:** ทุกบริการต้องอยู่ region เดียวกัน (Lambda ต่อ RDS ข้าม region ไม่ได้ผ่าน VPC) และ Learner Lab อนุญาตแค่ us-east-1 เป็นหลัก

---

## ขั้นตอนที่ 1 — สร้าง VPC

**VPC → Create VPC → เลือก "VPC and more"**

| ช่อง | ค่า | ทำไม |
|---|---|---|
| Name tag auto-generation | `securevault` | ให้ทุก resource มีชื่อขึ้นต้นเหมือนกัน หาง่าย |
| IPv4 CIDR | `10.0.0.0/16` | ช่วง IP ส่วนตัว 65,536 IP เหลือเฟือ |
| Number of AZs | **2** | RDS Multi-AZ / Subnet group ต้องการ 2 AZ |
| Number of public subnets | **0** | ไม่มีอะไรต้อง public (ดูหัวข้อ 2) |
| Number of private subnets | **2** | 1 ต่อ AZ สำหรับ Lambda + RDS + Endpoint |
| NAT gateways | **None** | ใช้ VPC Endpoint แทน (ประหยัด + ปลอดภัยกว่า) |
| VPC endpoints | **None** | S3 Gateway endpoint ไม่ได้ใช้ (จะสร้าง Secrets Manager endpoint เองในขั้นตอน 5) |
| DNS hostnames / DNS resolution | ✅ **เปิดทั้งคู่** | **สำคัญมาก** — ถ้าไม่เปิด Interface Endpoint จะใช้ Private DNS ไม่ได้ Lambda จะหา Secrets Manager ไม่เจอ |

กด **Create VPC**

**ผลลัพธ์:** ได้ VPC 1 อัน, private subnet 2 อัน (`...-subnet-private1-us-east-1a`, `...-private2-us-east-1b`), route table ของ private subnet ที่มีแค่ route `local` (คุยกันภายใน VPC ได้อย่างเดียว)

---

## ขั้นตอนที่ 2 — Security Groups

**VPC → Security groups → Create security group** (เลือก VPC = `securevault-vpc` ทุกครั้ง)

| ชื่อ | Inbound rule | Outbound | ทำไม |
|---|---|---|---|
| `sg-lambda` | **ไม่มี** | All traffic | ไม่มีใครเรียก Lambda ผ่าน network ตรง ๆ (API Gateway เรียกผ่าน AWS API) แต่ Lambda ต้องออกไปหา RDS/Endpoint ได้ |
| `sg-rds` | PostgreSQL **5432** ← Source: `sg-lambda` | All traffic | ให้ **เฉพาะ Lambda** ต่อ DB ได้ ใครอื่นในVPC ก็เข้าไม่ได้ |
| `sg-endpoint` | HTTPS **443** ← Source: `sg-lambda` | All traffic | Secrets Manager endpoint คุยผ่าน HTTPS ให้เฉพาะ Lambda เรียกได้ |

**ทำไมใช้ Source เป็น security group แทน IP?**
Lambda ใน VPC ได้ IP แบบสุ่ม (ผ่าน ENI) เปลี่ยนได้ตลอด ถ้าใส่ IP ต้องคอยแก้ แต่ใส่เป็น "อะไรก็ตามที่อยู่ใน `sg-lambda`" จะถูกเสมอ — หลักการ **least privilege**

> ลำดับการสร้าง: สร้าง `sg-lambda` ก่อน เพราะอีก 2 กลุ่มต้องอ้างถึง

---

## ขั้นตอนที่ 3 — RDS PostgreSQL

### 3.1 DB Subnet Group

**RDS → Subnet groups → Create DB subnet group**
- Name: `securevault-db-subnets`
- VPC: `securevault-vpc`
- Availability Zones: `us-east-1a`, `us-east-1b`
- Subnets: เลือก **private subnet ทั้ง 2**

**ทำไม:** RDS ต้องรู้ว่าจะวาง Primary/Standby ไว้ subnet ไหน และบังคับ ≥ 2 AZ

### 3.2 สร้าง Database

**RDS → Create database**

| ช่อง | ค่า | ทำไม |
|---|---|---|
| Creation method | Standard create | ให้ตั้งค่าเองได้ครบ |
| Engine | **PostgreSQL** | โค้ดเขียน schema เป็น PostgreSQL (JSONB, GIN index, `gen_random_uuid()`) |
| Template | Dev/Test | Production template บังคับ instance ใหญ่ เกิน lab |
| Availability | **Multi-AZ DB instance** | ได้ Standby ใน AZ b ตาม diagram (ถ้า lab ไม่อนุญาต → Single-AZ) |
| DB instance identifier | `securevault-db` | |
| Master username | `postgres` | |
| Credentials management | **Managed in AWS Secrets Manager** | AWS สุ่มรหัสผ่านและเก็บใน Secrets Manager ให้ — **ไม่มีใครต้องรู้รหัสผ่าน** Lambda ดึงเอง |
| Encryption key (ของ secret) | `aws/secretsmanager` | secret ถูกเข้ารหัสด้วย **KMS** (ตาม diagram) |
| Instance class | **db.t3.micro** | Learner Lab จำกัด / ประหยัด |
| Storage | 20 GB gp3, ปิด autoscaling | พอสำหรับ demo |
| VPC | `securevault-vpc` | |
| DB subnet group | `securevault-db-subnets` | |
| Public access | **No** | DB ห้ามเปิดสู่อินเทอร์เน็ต |
| VPC security group | ลบ `default` → เลือก **`sg-rds`** | ให้แค่ Lambda เข้าถึงได้ |
| **Additional configuration → Initial database name** | **`vault`** | ถ้าไม่ใส่ RDS จะไม่สร้าง database ให้ (มีแค่ `postgres`) |
| Encryption (storage) | ✅ Enable | ข้อมูลบนดิสก์เข้ารหัสด้วย KMS |
| Backup | 1 วัน | |

กด **Create database** → รอ 10–15 นาที จนสถานะ **Available**

### 3.3 จดค่าไว้

1. **Endpoint** → แท็บ **Connectivity & security** (เช่น `securevault-db.xxxx.us-east-1.rds.amazonaws.com`)
2. **Secret ARN** → แท็บ **Configuration** → *Master Credentials ARN* (หรือ Secrets Manager → secret ชื่อ `rds!db-xxxx`)

**ทำไมไม่ต้องรัน `psql` สร้างตารางเหมือนคู่มือเดิม?**
เพราะ `lambda.js` จะอ่าน `schema.sql` (อยู่ใน zip แล้ว) และรันให้เองเมื่อ `INIT_SCHEMA=true` — schema ใช้ `CREATE TABLE IF NOT EXISTS` ทั้งหมด รันซ้ำก็ไม่พัง

---

## ขั้นตอนที่ 4 — JWT Secret

**Secrets Manager → Store a new secret**
1. Secret type: **Other type of secret**
2. แท็บ **Plaintext** → ลบ `{}` ออกทั้งหมด → ใส่ข้อความสุ่มยาว ≥ 32 ตัวอักษร
   (เช่น สุ่มจาก PowerShell: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})`)
3. Secret name: `securevault/jwt`
4. Next → Next → **Store**
5. เปิด secret → copy **Secret ARN**

**ทำไม:** JWT secret ใช้เซ็น token login ถ้ารั่ว คนอื่นปลอม token เป็น user ใดก็ได้ ถ้าไม่ตั้ง โค้ดจะใช้ค่า default `securevault-jwt-insecure-default-secret-key-32b` ซึ่ง **ใครอ่าน source code ก็รู้** → อันตรายมาก

**ทำไมใช้ Plaintext (ไม่ใช่ JSON)?** `lambda.js` อ่านค่า secret ทั้งก้อนเป็น JWT secret ตรง ๆ

---

## ขั้นตอนที่ 5 — VPC Interface Endpoint (Secrets Manager)

**VPC → Endpoints → Create endpoint**

| ช่อง | ค่า | ทำไม |
|---|---|---|
| Name | `securevault-secrets-ep` | |
| Service category | AWS services | |
| Service | `com.amazonaws.us-east-1.secretsmanager` | ให้ Lambda เรียก Secrets Manager ได้ |
| VPC | `securevault-vpc` | |
| Additional settings → **Enable DNS name** | ✅ | ทำให้ชื่อ `secretsmanager.us-east-1.amazonaws.com` ใน VPC ชี้มาที่ endpoint นี้ (IP ภายใน) — โค้ด/SDK **ไม่ต้องแก้อะไร** |
| Subnets | private ทั้ง 2 AZ | ถ้า AZ หนึ่งล่ม อีก AZ ยังใช้ได้ (ตาม diagram มี endpoint ทั้ง AZ a/b) |
| Security groups | **`sg-endpoint`** | รับ 443 จาก Lambda เท่านั้น |

กด **Create endpoint** → รอสถานะ **Available**

**ถ้าไม่ทำขั้นตอนนี้จะเกิดอะไร?**
Lambda อยู่ private subnet ไม่มีทางออกเน็ต → เรียก Secrets Manager แล้ว **ค้างจน timeout** (ไม่มี error ชัดเจน แค่ `Task timed out after 30 seconds`)

---

## ขั้นตอนที่ 6 — Lambda

**Lambda → Create function → Author from scratch**

| ช่อง | ค่า | ทำไม |
|---|---|---|
| Function name | `securevault-api` | |
| Runtime | **Node.js 22.x** | Node 20 ไม่มี `node:sqlite` และ 22 มี AWS SDK v3 ในตัว (`@aws-sdk/client-secrets-manager`) |
| Architecture | x86_64 | |
| Execution role | **Use an existing role → `LabRole`** | Learner Lab สร้าง role เองไม่ได้ LabRole มีสิทธิ์ VPC ENI + CloudWatch Logs + Secrets Manager |

กด **Create function**

### 6.1 อัปโหลดโค้ด
1. แท็บ **Code** → **Upload from → .zip file** → เลือก `backend-lambda.zip` → **Save**
2. เลื่อนลง **Runtime settings → Edit** → Handler: **`src/server/lambda.handler`** → Save

**อธิบาย handler:** รูปแบบคือ `<path ไฟล์ไม่มีนามสกุล>.<ชื่อฟังก์ชันที่ export>`
→ ไฟล์ `src/server/lambda.js` ที่ export ฟังก์ชันชื่อ `handler`

**ข้างใน zip มีอะไร (ที่ root ของ zip):**
```
package.json          ← "type": "module" + dependencies
node_modules/         ← pg, hash-wasm (และ dependency ย่อย)
src/server/lambda.js  ← entry point
src/server/router.js
src/server/handlers/...
src/server/middleware/...
src/server/db/adapter.js, schema.sql
src/shared/...        ← crypto/validator/generator ที่ handler ต้อง import
```

### 6.2 General configuration
**Configuration → General configuration → Edit**
- Memory: **512 MB** — Lambda แบ่ง CPU ตาม memory; การ hash รหัสผ่าน (argon2/hash-wasm) ใช้ CPU เยอะ 128 MB จะช้ามาก
- Timeout: **30 sec** — ค่า default 3 วินาที **ไม่พอ** สำหรับ cold start ครั้งแรก (ดึง secret + ต่อ DB + สร้างตาราง)

### 6.3 VPC
**Configuration → VPC → Edit**
- VPC: `securevault-vpc`
- Subnets: private ทั้ง 2
- Security groups: **`sg-lambda`**

**ทำไม Lambda ต้องอยู่ใน VPC?** RDS เป็น private (Public access = No) ถ้า Lambda อยู่นอก VPC จะมองไม่เห็น DB เลย การผูก VPC ทำให้ AWS สร้าง **ENI** (การ์ดเครือข่ายเสมือน) ใน subnet ของเรา → Lambda ได้ IP ภายใน VPC (ตรงกับ ENI ใน diagram)

> การบันทึกขั้นนี้ใช้เวลา 1–2 นาที (AWS กำลังสร้าง ENI)

### 6.4 Environment variables
**Configuration → Environment variables → Edit**

| Key | Value | ใช้ทำอะไร |
|---|---|---|
| `NODE_ENV` | `production` | เปิด SSL ต่อ RDS (RDS PG15+ บังคับ SSL) |
| `DB_HOST` | RDS Endpoint (ขั้น 3.3) | ที่อยู่ DB |
| `DB_NAME` | `vault` | ชื่อ database ที่ตั้งตอนสร้าง |
| `DB_PORT` | `5432` | |
| `DB_SECRET_ARN` | Secret ARN ของ RDS (ขั้น 3.3) | Lambda ใช้ดึง username/password |
| `JWT_SECRET_ARN` | Secret ARN ของ JWT (ขั้น 4) | Lambda ใช้ดึง JWT secret |
| `INIT_SCHEMA` | `true` | สร้างตารางครั้งแรก — **ทดสอบผ่านแล้วเปลี่ยนเป็น `false`** (ไม่งั้นทุก cold start จะรัน schema ซ้ำ เสียเวลาเปล่า) |

**สังเกต:** ไม่มีรหัสผ่านอยู่ใน env var เลย มีแค่ "ARN" (ที่อยู่ของ secret) ซึ่งรั่วไปก็ไม่เป็นไร เพราะต้องมีสิทธิ์ IAM ถึงจะอ่านได้

**การทำงานตอน cold start (`lambda.js`):**
```
1. อ่าน DB_SECRET_ARN → เรียก Secrets Manager (ผ่าน VPC Endpoint) → ได้ {username, password}
2. ประกอบเป็น DATABASE_URL = postgres://user:pass@DB_HOST:5432/vault
3. อ่าน JWT_SECRET_ARN → ได้ JWT_SECRET
4. ค่อย import router.js  (ต้องหลังข้อ 3 เพราะ auth-guard อ่าน JWT_SECRET ตอน import)
5. ถ้า INIT_SCHEMA=true → รัน schema.sql
6. ส่ง event ให้ router จัดการ
```
ครั้งถัด ๆ ไป (warm) ข้ามข้อ 1–5 ไปข้อ 6 เลย จึงเร็ว

### 6.5 ทดสอบ
แท็บ **Test** → Create new event → ชื่อ `health` → วาง:
```json
{
  "httpMethod": "GET",
  "path": "/api/v1/health",
  "headers": {},
  "queryStringParameters": null,
  "body": null
}
```
กด **Test** → ต้องได้ `"statusCode": 200`

(event นี้เป็นรูปแบบเดียวกับที่ REST API Gateway ส่งมา)

ถ้าผ่าน → กลับไปแก้ `INIT_SCHEMA` = `false`

---

## ขั้นตอนที่ 7 — API Gateway (REST API)

**ทำไม REST API ไม่ใช่ HTTP API (แบบคู่มือเดิม)?**

| | HTTP API | REST API |
|---|---|---|
| ราคา | ถูกกว่า | แพงกว่าเล็กน้อย |
| **ผูก WAF ได้** | ❌ **ไม่ได้** | ✅ ได้ |
| Usage plan / API key | ไม่มี | มี |

diagram มี **WAF อยู่หน้า API Gateway** → ต้องเป็น REST API เท่านั้น
(โค้ด `router.js` รองรับ event ทั้ง 2 แบบอยู่แล้ว: อ่าน `event.httpMethod` / `event.path`)

**API Gateway → Create API → REST API → Build**
- API name: `securevault-api`
- API endpoint type: **Regional** (WAF แบบ Regional ผูกได้)
- **Create API**

1. **สร้าง proxy resource:** เลือก `/` → **Create resource**
   - เปิด **Proxy resource**
   - Resource path: `/` , Resource name: `{proxy+}`
   - ✅ **CORS (Cross Origin Resource Sharing)**
   - **Create resource**

   **ทำไม `{proxy+}`:** ส่ง **ทุก path ทุก method** เข้า Lambda ตัวเดียว แล้วให้ `router.js` แยกเอง (มี route ~40 ตัว ไม่ต้องสร้างทีละอัน)

2. **ผูก Lambda:** คลิก method **ANY** ใต้ `/{proxy+}` → **Edit integration**
   - Integration type: **Lambda function**
   - ✅ **Lambda proxy integration** — ส่ง request ทั้งก้อน (header, body, path) ให้ Lambda และใช้ response ของ Lambda ตรง ๆ
   - Lambda function: `securevault-api`
   - **Save** → ถ้าถามเรื่อง permission กด **OK** (ให้ API Gateway มีสิทธิ์ invoke Lambda)

3. **CORS:** เลือก `/{proxy+}` → **Enable CORS** → ติ๊กทุก method → Access-Control-Allow-Origin: `*` → Save
   **ทำไม:** หน้าเว็บอยู่โดเมน `amplifyapp.com` แต่ API อยู่ `execute-api...` คนละโดเมน → browser จะบล็อกถ้าไม่มี CORS (Lambda ก็ใส่ header CORS ให้ใน response อยู่แล้ว)

4. **Deploy API** → Stage: *New stage* → ชื่อ **`prod`** → Deploy
   **ทำไม:** แก้อะไรใน API Gateway จะยังไม่มีผลจนกว่าจะ Deploy

copy **Invoke URL** เช่น `https://abc123.execute-api.us-east-1.amazonaws.com/prod`

ทดสอบใน browser: `https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/v1/health`

---

## ขั้นตอนที่ 8 — WAF

**WAF & Shield → Web ACLs → Create web ACL**

| ช่อง | ค่า | ทำไม |
|---|---|---|
| Resource type | **Regional resources** | API Gateway เป็น regional (CloudFront ถึงใช้ Global) |
| Region | us-east-1 | |
| Name | `securevault-waf` | |
| Associated AWS resources | API Gateway → `securevault-api - prod` | ป้องกัน API |

**Add rules → Add managed rule groups → AWS managed rule groups:**

| Rule group | กันอะไร |
|---|---|
| **Core rule set** | XSS, path traversal, request แปลก ๆ (OWASP Top 10) |
| **SQL database** | SQL injection |
| **Known bad inputs** | payload อันตรายที่รู้จัก (เช่น Log4j) |

- Default action: **Allow** (ผ่าน ถ้าไม่ match กฎข้างบน)
- Next จนจบ → **Create web ACL**

> **ถ้าบันทึก vault item แล้วได้ 403:** ข้อมูลเข้ารหัสเป็น JSON ก้อนใหญ่ อาจโดนกฎ `SizeRestrictions_BODY` (จำกัด body 8 KB) → เข้า Core rule set → ตั้ง rule นั้นเป็น **Count** (นับอย่างเดียว ไม่บล็อก)

---

## ขั้นตอนที่ 9 — Build Frontend (ในเครื่อง)

**ทำไมต้อง build ในเครื่อง?** Vite จะ "ฝัง" URL ของ API ลงในไฟล์ JS ตอน build (`import.meta.env.VITE_API_BASE_URL`) ดังนั้นต้องรู้ URL ของ API Gateway **ก่อน** build

1. สร้างไฟล์ `C:\Users\PC\Downloads\vault-aws\frontend\.env.production` ใส่:
   ```
   VITE_API_BASE_URL=https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/v1
   ```
   (เปลี่ยน `abc123` เป็นของจริง, ต้องลงท้าย `/prod/api/v1`, **ไม่มี** `/` ปิดท้าย)

2. เปิด PowerShell:
   ```powershell
   cd C:\Users\PC\Downloads\vault-aws\frontend
   npm install
   npm run build
   cd dist
   tar.exe -a -c -f ..\..\frontend-dist.zip *
   ```

**ทำไม zip จากข้างใน `dist`:** Amplify ต้องการ `index.html` อยู่ **root ของ zip** ถ้า zip โฟลเดอร์ `dist` ทั้งโฟลเดอร์ จะกลายเป็น `dist/index.html` → เว็บขึ้น 404
**ทำไมใช้ `tar.exe`:** มีใน Windows 10/11 อยู่แล้ว และสร้าง zip ที่ path ถูกต้อง (`Compress-Archive` ของ PowerShell 5.1 ใช้ `\` ใน path ทำให้บางระบบอ่านผิด)

---

## ขั้นตอนที่ 10 — Amplify

**Amplify → Create new app → Deploy without Git → Next**
1. App name: `securevault-frontend`, Branch name: `prod`
2. ลาก `frontend-dist.zip` วาง → **Save and deploy**
3. **Hosting → Rewrites and redirects → Manage redirects → Add rewrite:**

| Source address | Target address | Type |
|---|---|---|
| `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|woff2\|ttf\|map\|json\|wasm)$)([^.]+$)/>` | `/index.html` | 200 (Rewrite) |

**ทำไมต้องมี rewrite:** React เป็น Single Page App ถ้ากด refresh ที่ `/vault` Amplify จะหาไฟล์ `vault` ไม่เจอ → 404 กฎนี้บอกว่า "path ไหนไม่ใช่ไฟล์ static ให้ส่ง `index.html` กลับไป" แล้ว React จัดการ routing เอง (มี `wasm` เพราะ `hash-wasm` ใช้ WebAssembly)

**ทำไมไม่ใช้ Git (แบบ `amplify.yml`)?** ใช้ได้เหมือนกัน แต่ต้อง push ขึ้น GitHub และตั้ง env var ใน Amplify — การลาก zip ง่ายกว่าสำหรับ lab

เปิด URL ของ Amplify (`https://prod.xxxx.amplifyapp.com`) → ทดสอบ **Register** → **Login**

**(แนะนำ)** กลับไป API Gateway → Enable CORS เปลี่ยน `*` เป็น URL Amplify → **Deploy API** อีกครั้ง — จำกัดให้เฉพาะเว็บเราเรียก API ได้

---

## ขั้นตอนที่ 11 — CloudWatch / CloudTrail

- **CloudWatch → Log groups → `/aws/lambda/securevault-api`** → ดู log ทุก request / error
  - **Actions → Edit retention setting → 7 days** (ไม่งั้นเก็บตลอดไป เสียเงิน)
- **CloudWatch → Metrics → Lambda** → ดู Invocations, Errors, Duration
- **CloudTrail → Event history** → เปิดอยู่แล้ว (90 วัน) เห็นว่าใครสร้าง/แก้/ลบ resource อะไร
  - ถ้า lab อนุญาต **Create trail** → เก็บ log ลง S3 ถาวร

**ต่างกันยังไง:** CloudWatch = **แอปของเรา** ทำงานยังไง / CloudTrail = **คน/ระบบ** ทำอะไรกับบัญชี AWS

---

## การอัปเดตโค้ด

**Backend:**
```powershell
cd C:\Users\PC\Downloads\vault-aws\backend
npm install --omit=dev
tar.exe -a -c -f ..\backend-lambda.zip package.json src node_modules
```
Lambda → Code → **Upload from → .zip file**

**Frontend:**
```powershell
cd C:\Users\PC\Downloads\vault-aws\frontend
npm run build
cd dist
tar.exe -a -c -f ..\..\frontend-dist.zip *
```
Amplify → แอป → branch `prod` → **Deploy updates** → ลากไฟล์ใหม่

---

## Troubleshooting รวม

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| `Cannot find package 'pg'` / `'hash-wasm'` | zip ไม่มี `node_modules` | ใช้ `backend-lambda.zip` ที่เตรียมไว้ หรือ zip ใหม่ตามหัวข้ออัปเดต |
| `Cannot find module '.../lambda'` | Handler ผิด หรือ zip ซ้อนโฟลเดอร์ | Handler = `src/server/lambda.handler`, zip ต้องมี `package.json` ที่ root |
| `Cannot use import statement outside a module` | ไม่มี `package.json` ที่มี `"type": "module"` | ใช้ zip ที่เตรียมไว้ |
| `No such built-in module: node:sqlite` | Runtime Node 20 | เปลี่ยนเป็น **Node.js 22.x** |
| `Task timed out` (ตอนดึง secret) | ไม่มี VPC Endpoint / DNS name ปิด / `sg-endpoint` ไม่เปิด 443 | ตรวจขั้นตอน 1 (DNS) และ 5 |
| `Task timed out` / `ECONNREFUSED` (ตอนต่อ DB) | `sg-rds` ไม่เปิด 5432 จาก `sg-lambda` / RDS ไม่ Available | ตรวจขั้นตอน 2, 3 |
| `no pg_hba.conf entry ... no encryption` | ต่อ RDS โดยไม่ใช้ SSL | ตั้ง `NODE_ENV=production` |
| `database "vault" does not exist` | ไม่ได้ใส่ Initial database name | ตั้ง `DB_NAME=postgres` แทน |
| `AccessDeniedException` | ไม่ได้ใช้ LabRole | Configuration → Permissions → เลือก `LabRole` |
| หน้าเว็บ: CORS error ใน console | ลืม Enable CORS / ลืม Deploy API | ทำขั้นตอน 7.3–7.4 ใหม่ |
| หน้าเว็บ: เรียก API แล้ว 404 | `VITE_API_BASE_URL` ผิด (ลืม `/prod` หรือ `/api/v1`) | แก้ `.env.production` แล้ว build + อัปโหลดใหม่ |
| บันทึก item แล้ว 403 | WAF บล็อก body ใหญ่ | ตั้ง `SizeRestrictions_BODY` เป็น Count |
| refresh หน้าเว็บแล้ว 404 | ไม่มี rewrite rule | ทำขั้นตอน 10.3 |
| กลับมาเปิด lab แล้ว API error | RDS ยังไม่ start | รอ RDS เป็น Available |

---

## หมายเหตุ

- **Cognito** (ใน diagram): แอปนี้มีระบบ login ของตัวเอง (JWT + MFA + zero-knowledge ที่ hash รหัสผ่านฝั่ง client) จึงไม่ได้เชื่อม Cognito ในโค้ด ถ้าจะใช้ต้องแก้ทั้ง frontend และ backend — ในรายงานอาจระบุเป็น future improvement
- **KMS** ถูกใช้แล้วโดยอัตโนมัติ: เข้ารหัส RDS storage และ Secrets Manager secret
- **`@aws-sdk/client-secrets-manager` ไม่ได้อยู่ใน zip** — ตั้งใจ เพราะ Node.js 22 runtime ของ Lambda มีให้ในตัว (ลดขนาด zip)
- **ค่าใช้จ่ายหลักใน lab:** RDS Multi-AZ (~2 เท่าของ Single-AZ) + VPC Endpoint 2 AZ — ถ้า budget ใกล้หมด ลบ endpoint/RDS เมื่อไม่ใช้
