# Deploy SecureVault ขึ้น AWS (AWS CLI / Console)

เอกสารนี้ทำตาม `docs/architecture.png`:

```
desktop ─▶ AWS Amplify (frontend/) ─▶ AWS WAF ─▶ API Gateway (REST, Cognito authorizer)
                 │                                         │
                 └────────── Amazon Cognito ◀──────────────┘
                                                           ▼
                         AWS Lambda (backend/) ── ENI ใน private subnet AZ a / AZ b
                               │                    ├─▶ RDS PostgreSQL Multi-AZ (Primary a / Standby b)
                               │                    └─▶ Interface VPC Endpoint: Secrets Manager, KMS (a + b)
                               └─▶ CloudWatch Logs           CloudTrail ตรวจสอบทั้งบัญชี
```

> **สถานะ:** เป็นเอกสารเท่านั้น ยังไม่มีการสร้าง resource จริง ทุกคำสั่งรันได้ใน **AWS CloudShell** หรือ
> bash ที่มี AWS CLI v2 + `jq` ตัวแปรที่ตั้งในแต่ละขั้นถูกใช้ต่อในขั้นถัดไป ให้รันใน shell เดียวกันตามลำดับ
> (หรือเก็บค่าไว้ในไฟล์ `deploy.env` แล้ว `source deploy.env`)
>
> **ห้าม** ใส่ secret จริงในไฟล์ใด ๆ ของ repo — ค่า secret อยู่ใน Secrets Manager เท่านั้น

## สารบัญ

1. [สิ่งที่ต้องเตรียม](#1-สิ่งที่ต้องเตรียม)
2. [VPC, subnet, route table, security group](#2-vpc-private-subnet-2-az-route-table-security-group)
3. [KMS key และ Secrets Manager](#3-kms-key-และ-secrets-manager)
4. [Interface VPC Endpoint](#4-interface-vpc-endpoint-secrets-manager--kms)
5. [RDS PostgreSQL Multi-AZ + schema](#5-rds-postgresql-multi-az)
6. [Cognito User Pool + App Client](#6-cognito-user-pool-และ-app-client)
7. [Lambda](#7-lambda)
8. [API Gateway (REST)](#8-api-gateway-rest-api)
9. [WAF](#9-aws-waf)
10. [Amplify](#10-aws-amplify-hosting)
11. [CloudWatch + CloudTrail](#11-cloudwatch-และ-cloudtrail)
12. [ตรวจว่า deploy สำเร็จ](#12-ตรวจว่า-deploy-สำเร็จ)
13. [CI/CD](#13-cicd)
14. [Rollback และการดู log](#14-rollback-และการดู-log)
15. [ค่าใช้จ่ายโดยประมาณ](#15-ค่าใช้จ่ายโดยประมาณต่อเดือน)
16. [ข้อสังเกตเรื่อง architecture](#16-ข้อสังเกตเรื่อง-architecture)
17. [ลบทุกอย่าง (teardown)](#17-ลบทุกอย่างหลังทดสอบ)

---

## 1. สิ่งที่ต้องเตรียม

| สิ่งที่ต้องมี | รายละเอียด |
|---|---|
| AWS account | เปิด MFA ให้ root user แล้วเลิกใช้ root ในงานประจำวัน |
| ผู้ใช้สำหรับ deploy | IAM Identity Center user (แนะนำ) หรือ IAM user/role ที่มีสิทธิ์ด้านล่าง ใช้ `aws configure sso` หรือ CloudShell |
| AWS CLI v2, `jq`, Node.js 22, npm 10 | CloudShell มี AWS CLI + jq ให้แล้ว ติดตั้ง Node 22 ด้วย `nvm install 22` |
| GitHub | repo `nippitch239/vault` (Amplify จะเชื่อมผ่าน GitHub App) |
| อีเมลรับ alarm | ใช้ในขั้นที่ 11 |

**สิทธิ์ที่ผู้ deploy ต้องมี** (ตอนตั้งระบบครั้งแรก): ใช้ AWS managed policies
`AmazonVPCFullAccess`, `AmazonRDSFullAccess`, `AWSLambda_FullAccess`, `AmazonAPIGatewayAdministrator`,
`AmazonCognitoPowerUser`, `AWSWAFFullAccess`, `AdministratorAccess-Amplify`, `CloudWatchFullAccess`,
`AWSCloudTrail_FullAccess`, `SecretsManagerReadWrite`, `AWSKeyManagementServicePowerUser`,
`AmazonS3FullAccess` (สำหรับ bucket ของ CloudTrail) และ `IAMFullAccess` (สร้าง role ของ Lambda/CI)
— หลังตั้งระบบเสร็จให้ลดเหลือสิทธิ์ของ CI (ขั้นที่ 13) เท่านั้น

**เลือก region:** แนะนำ `ap-southeast-1` (Singapore) — ทุก service ในรูปใช้ได้ครบและใกล้ไทย
`ap-southeast-7` (Thailand) ใกล้กว่าแต่ต้องตรวจก่อนว่า Amplify Hosting / WAF / Cognito รุ่นที่ต้องการเปิดให้บริการแล้ว

```bash
export AWS_REGION=ap-southeast-1
export APP=securevault
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AZ_A=${AWS_REGION}a
export AZ_B=${AWS_REGION}b
echo "Account $ACCOUNT_ID in $AWS_REGION ($AZ_A, $AZ_B)"
```

ทุก resource จะติด tag `Project=securevault` เพื่อดูค่าใช้จ่ายและลบทีหลังได้ง่าย

---

## 2. VPC: private subnet 2 AZ, route table, security group

ตามรูป **ไม่มี public subnet / Internet Gateway / NAT** — Lambda ออกอินเทอร์เน็ตไม่ได้โดยตั้งใจ

```bash
TAGS="Key=Project,Value=$APP"

VPC_ID=$(aws ec2 create-vpc --cidr-block 10.20.0.0/16 \
  --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$APP-vpc},{$TAGS}]" \
  --query Vpc.VpcId --output text)
# Private DNS ของ VPC endpoint ต้องใช้สองค่านี้
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support '{"Value":true}'
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames '{"Value":true}'

SUBNET_A=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.20.1.0/24 --availability-zone $AZ_A \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$APP-private-a},{$TAGS}]" \
  --query Subnet.SubnetId --output text)
SUBNET_B=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.20.2.0/24 --availability-zone $AZ_B \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$APP-private-b},{$TAGS}]" \
  --query Subnet.SubnetId --output text)

# Route table ของ private subnet: มีแค่ route "local" (10.20.0.0/16) — ไม่มี 0.0.0.0/0
RTB_ID=$(aws ec2 create-route-table --vpc-id $VPC_ID \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$APP-private-rt},{$TAGS}]" \
  --query RouteTable.RouteTableId --output text)
aws ec2 associate-route-table --route-table-id $RTB_ID --subnet-id $SUBNET_A
aws ec2 associate-route-table --route-table-id $RTB_ID --subnet-id $SUBNET_B
```

**Security group** (3 กลุ่ม อ้างถึงกันเองด้วย SG id ไม่ใช้ CIDR):

| SG | Inbound | Outbound |
|---|---|---|
| `sg-lambda` | — | TCP 5432 → `sg-rds`, TCP 443 → `sg-endpoints` |
| `sg-rds` | TCP 5432 จาก `sg-lambda` | — |
| `sg-endpoints` | TCP 443 จาก `sg-lambda` | — |

```bash
SG_LAMBDA=$(aws ec2 create-security-group --vpc-id $VPC_ID --group-name $APP-lambda \
  --description "SecureVault Lambda ENIs" --query GroupId --output text)
SG_RDS=$(aws ec2 create-security-group --vpc-id $VPC_ID --group-name $APP-rds \
  --description "SecureVault RDS" --query GroupId --output text)
SG_VPCE=$(aws ec2 create-security-group --vpc-id $VPC_ID --group-name $APP-endpoints \
  --description "SecureVault interface endpoints" --query GroupId --output text)

# ลบ egress "allow all" ที่ AWS ใส่ให้โดยอัตโนมัติ
for SG in $SG_LAMBDA $SG_RDS $SG_VPCE; do
  aws ec2 revoke-security-group-egress --group-id $SG --protocol -1 --cidr 0.0.0.0/0
done

# Lambda -> RDS 5432 และ Lambda -> endpoints 443
aws ec2 authorize-security-group-egress --group-id $SG_LAMBDA \
  --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$SG_RDS}]"
aws ec2 authorize-security-group-egress --group-id $SG_LAMBDA \
  --ip-permissions "IpProtocol=tcp,FromPort=443,ToPort=443,UserIdGroupPairs=[{GroupId=$SG_VPCE}]"
aws ec2 authorize-security-group-ingress --group-id $SG_RDS \
  --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$SG_LAMBDA}]"
aws ec2 authorize-security-group-ingress --group-id $SG_VPCE \
  --ip-permissions "IpProtocol=tcp,FromPort=443,ToPort=443,UserIdGroupPairs=[{GroupId=$SG_LAMBDA}]"
```

ใน Console: **VPC → Your VPCs → Create VPC → "VPC only"** แล้วสร้าง subnet/route table/SG ตามตารางเดียวกัน

---

## 3. KMS key และ Secrets Manager

KMS key เดียว (customer managed) ใช้เข้ารหัส RDS storage, RDS master secret และ application secret

```bash
KMS_KEY_ID=$(aws kms create-key --description "SecureVault data key" \
  --tags TagKey=Project,TagValue=$APP --query KeyMetadata.KeyId --output text)
aws kms create-alias --alias-name alias/$APP --target-key-id $KMS_KEY_ID
aws kms enable-key-rotation --key-id $KMS_KEY_ID
KMS_KEY_ARN=arn:aws:kms:$AWS_REGION:$ACCOUNT_ID:key/$KMS_KEY_ID
```

Secret 2 ตัว:

| Secret | สร้างโดย | เนื้อหา | Lambda env |
|---|---|---|---|
| DB master credential | RDS (`--manage-master-user-password`) ในขั้นที่ 5 | `{"username","password"}` | `DB_SECRET_ARN` |
| `securevault/app` | คำสั่งด้านล่าง | `{"saltPepper": "<สุ่ม 32 ไบต์>"}` | `APP_SECRET_ARN` |

```bash
# สุ่มค่าในเครื่องแล้วส่งตรงเข้า Secrets Manager — ไม่เขียนลงไฟล์ใด ๆ
APP_SECRET_ARN=$(aws secretsmanager create-secret --name $APP/app \
  --kms-key-id $KMS_KEY_ARN \
  --secret-string "{\"saltPepper\":\"$(openssl rand -base64 32)\"}" \
  --tags Key=Project,Value=$APP --query ARN --output text)
```

> `saltPepper` ใช้สร้าง KDF salt ของผู้ใช้ที่ยังไม่มีโปรไฟล์ (กันการเดาว่ามีบัญชีหรือไม่) — **อย่าเปลี่ยนค่า**
> หลังมีผู้ใช้สมัครแล้ว (ผู้ที่สมัครแต่ยังไม่เคยเข้าสู่ระบบครั้งแรกจะเข้าระบบไม่ได้)

---

## 4. Interface VPC Endpoint (Secrets Manager + KMS)

Lambda อยู่ใน private subnet ที่ไม่มี NAT จึงเรียก Secrets Manager/KMS ผ่าน endpoint ทั้ง 2 AZ
เปิด **private DNS** เพื่อให้ AWS SDK ใช้ชื่อปกติ (`secretsmanager.<region>.amazonaws.com`) ได้โดยไม่ต้องตั้งค่าเพิ่ม

```bash
for SVC in secretsmanager kms; do
  aws ec2 create-vpc-endpoint --vpc-id $VPC_ID --vpc-endpoint-type Interface \
    --service-name com.amazonaws.$AWS_REGION.$SVC \
    --subnet-ids $SUBNET_A $SUBNET_B --security-group-ids $SG_VPCE \
    --private-dns-enabled \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=$APP-$SVC},{Key=Project,Value=$APP}]"
done
aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=$VPC_ID \
  --query 'VpcEndpoints[].[ServiceName,State]' --output table   # รอให้เป็น available
```

> backend ไม่ได้เรียก KMS โดยตรง (Secrets Manager เป็นผู้ถอดรหัส secret ด้วย KMS ฝั่ง AWS) แต่ใส่ KMS endpoint ไว้ตามรูป
> เผื่อใช้ KMS ในโค้ดภายหลัง หากต้องการประหยัดตอนทดสอบดูขั้นที่ 15

---

## 5. RDS PostgreSQL Multi-AZ

```bash
aws rds create-db-subnet-group --db-subnet-group-name $APP-db \
  --db-subnet-group-description "SecureVault private subnets" \
  --subnet-ids $SUBNET_A $SUBNET_B --tags Key=Project,Value=$APP

aws rds create-db-instance \
  --db-instance-identifier $APP-db \
  --engine postgres --engine-version 16.4 \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 --max-allocated-storage 100 --storage-type gp3 \
  --multi-az \
  --db-subnet-group-name $APP-db --vpc-security-group-ids $SG_RDS \
  --no-publicly-accessible \
  --storage-encrypted --kms-key-id $KMS_KEY_ARN \
  --master-username vaultadmin \
  --manage-master-user-password --master-user-secret-kms-key-id $KMS_KEY_ARN \
  --db-name securevault \
  --backup-retention-period 7 --preferred-backup-window 18:00-19:00 \
  --preferred-maintenance-window sun:19:00-sun:20:00 \
  --copy-tags-to-snapshot --deletion-protection \
  --enable-cloudwatch-logs-exports postgresql \
  --auto-minor-version-upgrade \
  --tags Key=Project,Value=$APP

aws rds wait db-instance-available --db-instance-identifier $APP-db   # ~15-25 นาที
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier $APP-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)
DB_SECRET_ARN=$(aws rds describe-db-instances --db-instance-identifier $APP-db \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)
```

- **Multi-AZ:** RDS วาง Primary ใน AZ หนึ่งและ Standby ใน AZ อีกตัว (synchronous replication) ตรวจได้ด้วย
  `aws rds describe-db-instances --query 'DBInstances[0].[AvailabilityZone,SecondaryAvailabilityZone]'`
- **TLS:** PostgreSQL 15+ บน RDS ตั้ง `rds.force_ssl=1` เป็นค่าเริ่มต้น backend ตรวจ certificate จริง
  (`rejectUnauthorized: true`) โดยใช้ CA bundle ของ Lambda runtime ผ่าน `NODE_EXTRA_CA_CERTS` (ขั้นที่ 7)
- **Backup:** automated backup 7 วัน + point-in-time restore, deletion protection เปิดอยู่
- **Schema / migration:** ฐานข้อมูลอยู่ใน private subnet จึงรัน migration **จากใน VPC ผ่าน Lambda** หลังขั้นที่ 7:

```bash
aws lambda invoke --function-name $APP-api:live \
  --cli-binary-format raw-in-base64-out --payload '{"vaultTask":"migrate"}' /tmp/migrate.json
cat /tmp/migrate.json   # {"ok":true,"task":"migrate"}
```

`schema.sql` เป็นแบบ idempotent (`CREATE ... IF NOT EXISTS`) รันซ้ำได้ ตารางของ collection คือ `collections`,
`collection_access`, `collection_items`, `collection_keys` (+ `groups`, `group_members` สำหรับสิทธิ์แบบกลุ่ม)

> ข้อแนะนำหลังระบบขึ้นแล้ว: สร้าง DB role แยกสำหรับแอป (`GRANT SELECT, INSERT, UPDATE, DELETE`) แทนการใช้ master
> user และเก็บใน secret ของตัวเอง

---

## 6. Cognito User Pool และ App Client

แอปใช้ **ชื่อผู้ใช้** เข้าสู่ระบบ (อีเมลใช้แทนได้), ยืนยันอีเมลด้วยรหัส, 2FA แบบ TOTP (ไม่บังคับ)
รหัสผ่านที่ส่งให้ Cognito คือ Authentication Key ที่ derive จาก master password (`Sv1!` + 64 hex) จึงผ่าน policy เสมอ

```bash
USER_POOL_ID=$(aws cognito-idp create-user-pool --pool-name $APP-users \
  --alias-attributes email \
  --auto-verified-attributes email \
  --username-configuration CaseSensitive=false \
  --policies 'PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true,TemporaryPasswordValidityDays=3}' \
  --mfa-configuration OPTIONAL \
  --software-token-mfa-configuration Enabled=true \
  --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' \
  --schema Name=email,Required=true,Mutable=true Name=name,Required=false,Mutable=true \
  --deletion-protection ACTIVE \
  --user-pool-tags Project=$APP \
  --query UserPool.Id --output text)
USER_POOL_ARN=arn:aws:cognito-idp:$AWS_REGION:$ACCOUNT_ID:userpool/$USER_POOL_ID

# Public client (SPA): ไม่มี client secret, ใช้ SRP, ไม่บอกว่ามี/ไม่มีบัญชี
CLIENT_ID=$(aws cognito-idp create-user-pool-client --user-pool-id $USER_POOL_ID \
  --client-name $APP-web --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --prevent-user-existence-errors ENABLED \
  --id-token-validity 60 --access-token-validity 60 --refresh-token-validity 7 \
  --token-validity-units IdToken=minutes,AccessToken=minutes,RefreshToken=days \
  --enable-token-revocation \
  --query UserPoolClient.ClientId --output text)

# กลุ่มผู้ดูแลระบบ (backend อ่าน cognito:groups -> role admin)
aws cognito-idp create-group --user-pool-id $USER_POOL_ID --group-name admin \
  --description "SecureVault administrators"
```

เพิ่มผู้ดูแลระบบหลังเขาสมัครแล้ว: `aws cognito-idp admin-add-user-to-group --user-pool-id $USER_POOL_ID --username <username> --group-name admin`
(ผู้ใช้ต้องเข้าสู่ระบบใหม่เพื่อให้ token มี group)

> อีเมลยืนยัน: ค่าเริ่มต้นส่งผ่าน Cognito (จำกัด ~50 ฉบับ/วัน) ระบบจริงควรต่อกับ Amazon SES (`--email-configuration`)

---

## 7. Lambda

### 7.1 Build package จาก `backend/`

```bash
git clone https://github.com/nippitch239/vault.git && cd vault   # หรือใช้ working copy
npm ci
npm test --workspace backend && npm run lint --workspace backend
npm run build --workspace backend          # -> backend/dist/lambda.zip (index.mjs + schema.sql)
```

### 7.2 IAM role (least privilege)

```bash
cat > /tmp/lambda-trust.json <<'JSON'
{ "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" }] }
JSON
LAMBDA_ROLE_ARN=$(aws iam create-role --role-name $APP-api-role \
  --assume-role-policy-document file:///tmp/lambda-trust.json --query Role.Arn --output text)

# ENI ใน VPC + เขียน CloudWatch Logs
aws iam attach-role-policy --role-name $APP-api-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole

# อ่าน 2 secret และถอดรหัสด้วย key ของเราเท่านั้น
cat > /tmp/lambda-secrets.json <<JSON
{ "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": ["$DB_SECRET_ARN", "$APP_SECRET_ARN"] },
    { "Effect": "Allow", "Action": "kms:Decrypt", "Resource": "$KMS_KEY_ARN",
      "Condition": { "StringEquals": { "kms:ViaService": "secretsmanager.$AWS_REGION.amazonaws.com" } } }
  ] }
JSON
aws iam put-role-policy --role-name $APP-api-role --policy-name read-app-secrets \
  --policy-document file:///tmp/lambda-secrets.json
```

### 7.3 สร้าง function (VPC, env, timeout/memory)

```bash
LAMBDA_ARN=$(aws lambda create-function --function-name $APP-api \
  --runtime nodejs22.x --handler index.handler --architectures arm64 \
  --role $LAMBDA_ROLE_ARN --zip-file fileb://backend/dist/lambda.zip \
  --timeout 15 --memory-size 512 \
  --vpc-config SubnetIds=$SUBNET_A,$SUBNET_B,SecurityGroupIds=$SG_LAMBDA \
  --environment "Variables={NODE_ENV=production,DB_SECRET_ARN=$DB_SECRET_ARN,DB_HOST=$DB_HOST,DB_PORT=5432,DB_NAME=securevault,APP_SECRET_ARN=$APP_SECRET_ARN,NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem,DB_POOL_MAX=2,DB_STATEMENT_TIMEOUT_MS=8000,COGNITO_ADMIN_GROUP=admin,CORS_ALLOW_ORIGIN=https://example.invalid}" \
  --logging-config LogFormat=JSON,ApplicationLogLevel=INFO,SystemLogLevel=WARN \
  --tags Project=$APP --query FunctionArn --output text)
aws lambda wait function-active-v2 --function-name $APP-api

# จำกัด concurrency เพื่อไม่ให้ connection ล้น db.t4g.micro (max_connections ~ 80)
aws lambda put-function-concurrency --function-name $APP-api --reserved-concurrent-executions 25

# version + alias "live" — API Gateway ชี้ alias นี้ ทำให้ rollback ได้ทันที (ขั้นที่ 14)
VERSION=$(aws lambda publish-version --function-name $APP-api --query Version --output text)
aws lambda create-alias --function-name $APP-api --name live --function-version $VERSION
LAMBDA_ALIAS_ARN=$LAMBDA_ARN:live

# สร้าง schema (ขั้นที่ 5)
aws lambda invoke --function-name $APP-api:live --cli-binary-format raw-in-base64-out \
  --payload '{"vaultTask":"migrate"}' /tmp/migrate.json && cat /tmp/migrate.json
```

| ตั้งค่า | ค่า | เหตุผล |
|---|---|---|
| Timeout | 15 s | backend ตอบ 504 เองก่อนหมดเวลา ~0.5 s; RDS failover ใช้ ~60-120 s จึงไม่ควรรอใน request |
| Memory | 512 MB (arm64) | CPU มากขึ้นตาม memory ลด cold start ของ pg/TLS |
| `CORS_ALLOW_ORIGIN` | ตั้งเป็นโดเมน Amplify ในขั้นที่ 10 | ห้ามใช้ `*` ใน production |

> Lambda ใน VPC ส่ง log ไป CloudWatch ผ่าน Lambda service ได้เลย ไม่ต้องมี endpoint ของ Logs

---

## 8. API Gateway (REST API)

ใช้ **REST API** (ไม่ใช่ HTTP API) เพราะ AWS WAF ผูกได้กับ REST API stage เท่านั้น — ตรงกับรูป
โครงสร้าง resource:

| Resource | Method | Authorization | หมายเหตุ |
|---|---|---|---|
| `/{proxy+}` | `ANY` | Cognito User Pool | ทุก endpoint ใน `docs/API.md` |
| `/{proxy+}` | `OPTIONS` | NONE | CORS preflight (ไม่มี token) |
| `/api/v1/auth/salt` | `GET` | NONE | public — ใช้ก่อนเข้าสู่ระบบ |
| `/api/v1/health` | `GET` | NONE | health check |

ทุก method ใช้ **Lambda proxy integration** ไปที่ alias `live` (Lambda เป็นผู้ตอบ CORS header เอง)

```bash
API_ID=$(aws apigateway create-rest-api --name $APP-api \
  --endpoint-configuration types=REGIONAL --tags Project=$APP --query id --output text)
ROOT_ID=$(aws apigateway get-resources --rest-api-id $API_ID --query 'items[?path==`/`].id' --output text)
INTEGRATION_URI=arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$LAMBDA_ALIAS_ARN/invocations

AUTHORIZER_ID=$(aws apigateway create-authorizer --rest-api-id $API_ID --name cognito \
  --type COGNITO_USER_POOLS --provider-arns $USER_POOL_ARN \
  --identity-source method.request.header.Authorization --query id --output text)

add_method() {  # $1=resource id, $2=HTTP method, $3=auth (COGNITO|NONE)
  if [ "$3" = COGNITO ]; then
    aws apigateway put-method --rest-api-id $API_ID --resource-id $1 --http-method $2 \
      --authorization-type COGNITO_USER_POOLS --authorizer-id $AUTHORIZER_ID >/dev/null
  else
    aws apigateway put-method --rest-api-id $API_ID --resource-id $1 --http-method $2 \
      --authorization-type NONE >/dev/null
  fi
  aws apigateway put-integration --rest-api-id $API_ID --resource-id $1 --http-method $2 \
    --type AWS_PROXY --integration-http-method POST --uri $INTEGRATION_URI >/dev/null
}
new_resource() { aws apigateway create-resource --rest-api-id $API_ID --parent-id $1 --path-part "$2" --query id --output text; }

PROXY_ID=$(new_resource $ROOT_ID '{proxy+}')
add_method $PROXY_ID ANY COGNITO
add_method $PROXY_ID OPTIONS NONE

API_RES=$(new_resource $ROOT_ID api); V1_RES=$(new_resource $API_RES v1)
AUTH_RES=$(new_resource $V1_RES auth); SALT_RES=$(new_resource $AUTH_RES salt)
HEALTH_RES=$(new_resource $V1_RES health)
add_method $SALT_RES GET NONE
add_method $HEALTH_RES GET NONE

# ให้ API Gateway เรียก alias "live" ได้
aws lambda add-permission --function-name $APP-api --qualifier live \
  --statement-id apigw-invoke --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_ID/*"
```

**CORS ของ error ที่ API Gateway ตอบเอง** (401 จาก authorizer, 403 จาก WAF, 429 throttling) — ใส่ header ให้
เบราว์เซอร์อ่าน error ได้ (แทน `ORIGIN` ด้วยโดเมน Amplify จากขั้นที่ 10 แล้วรันซ้ำ):

```bash
ORIGIN=https://example.invalid
for T in DEFAULT_4XX DEFAULT_5XX; do
  aws apigateway put-gateway-response --rest-api-id $API_ID --response-type $T \
    --response-parameters "{\"gatewayresponse.header.Access-Control-Allow-Origin\":\"'$ORIGIN'\",\"gatewayresponse.header.Access-Control-Allow-Headers\":\"'Content-Type,Authorization'\"}"
done
```

**Logging ของ API Gateway** ต้องมี role ระดับบัญชีครั้งเดียว:

```bash
aws iam create-role --role-name $APP-apigw-logs --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"apigateway.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name $APP-apigw-logs \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs
aws apigateway update-account --patch-operations \
  op=replace,path=/cloudwatchRoleArn,value=arn:aws:iam::$ACCOUNT_ID:role/$APP-apigw-logs
```

**Deploy stage `prod`** พร้อม access log, throttling และ execution log ระดับ ERROR (ไม่ log body เพราะมี ciphertext/ token):

```bash
aws logs create-log-group --log-group-name /aws/apigateway/$APP-access
aws logs put-retention-policy --log-group-name /aws/apigateway/$APP-access --retention-in-days 30
aws apigateway create-deployment --rest-api-id $API_ID --stage-name prod --description "initial"
aws apigateway update-stage --rest-api-id $API_ID --stage-name prod --patch-operations \
  "op=replace,path=/accessLogSettings/destinationArn,value=arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:/aws/apigateway/$APP-access" \
  'op=replace,path=/accessLogSettings/format,value={"requestId":"$context.requestId","ip":"$context.identity.sourceIp","method":"$context.httpMethod","path":"$context.path","status":"$context.status","latency":"$context.responseLatency","waf":"$context.wafResponseCode","authError":"$context.authorizer.error"}' \
  'op=replace,path=/*/*/logging/loglevel,value=ERROR' \
  'op=replace,path=/*/*/metrics/enabled,value=true' \
  'op=replace,path=/*/*/throttling/rateLimit,value=50' \
  'op=replace,path=/*/*/throttling/burstLimit,value=100'

API_URL=https://$API_ID.execute-api.$AWS_REGION.amazonaws.com/prod/api/v1
curl -s $API_URL/health    # {"status":"healthy",...,"engine":"postgres","database":"connected"}
```

> ทุกครั้งที่แก้ resource/method ต้อง `create-deployment` ใหม่ แต่การอัปเดตโค้ด Lambda ไม่ต้อง (alias เดิม)

---

## 9. AWS WAF

Web ACL แบบ REGIONAL ผูกกับ stage `prod` ของ API Gateway

| ลำดับ | Rule | Action | เหตุผล |
|---|---|---|---|
| 0 | `AWSManagedRulesAmazonIpReputationList` | Block | IP ที่ AWS รู้ว่าเป็นบอท/ผู้โจมตี |
| 1 | `AWSManagedRulesCommonRuleSet` (ยกเว้น `SizeRestrictions_BODY` = Count) | Block | OWASP พื้นฐาน; body ของรายการที่เข้ารหัสอาจเกิน 8 KB จึงไม่บล็อกด้วยขนาด |
| 2 | `AWSManagedRulesKnownBadInputsRuleSet` | Block | Log4j, exploit ที่รู้จัก |
| 3 | `rate-auth`: `/api/v1/auth/` > 100 req / 5 นาที / IP | Block | ชะลอการเดาบัญชี |
| 4 | `rate-all`: > 1000 req / 5 นาที / IP | Block | กัน flood |

```bash
cat > /tmp/waf-rules.json <<'JSON'
[
 {"Name":"ip-reputation","Priority":0,"OverrideAction":{"None":{}},
  "Statement":{"ManagedRuleGroupStatement":{"VendorName":"AWS","Name":"AWSManagedRulesAmazonIpReputationList"}},
  "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"ip-reputation"}},
 {"Name":"common","Priority":1,"OverrideAction":{"None":{}},
  "Statement":{"ManagedRuleGroupStatement":{"VendorName":"AWS","Name":"AWSManagedRulesCommonRuleSet",
    "RuleActionOverrides":[{"Name":"SizeRestrictions_BODY","ActionToUse":{"Count":{}}}]}},
  "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"common"}},
 {"Name":"bad-inputs","Priority":2,"OverrideAction":{"None":{}},
  "Statement":{"ManagedRuleGroupStatement":{"VendorName":"AWS","Name":"AWSManagedRulesKnownBadInputsRuleSet"}},
  "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"bad-inputs"}},
 {"Name":"rate-auth","Priority":3,"Action":{"Block":{}},
  "Statement":{"RateBasedStatement":{"Limit":100,"EvaluationWindowSec":300,"AggregateKeyType":"IP",
    "ScopeDownStatement":{"ByteMatchStatement":{"FieldToMatch":{"UriPath":{}},"PositionalConstraint":"CONTAINS",
      "SearchString":"/api/v1/auth/","TextTransformations":[{"Priority":0,"Type":"LOWERCASE"}]}}}},
  "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"rate-auth"}},
 {"Name":"rate-all","Priority":4,"Action":{"Block":{}},
  "Statement":{"RateBasedStatement":{"Limit":1000,"EvaluationWindowSec":300,"AggregateKeyType":"IP"}},
  "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"rate-all"}}
]
JSON
WEB_ACL_ARN=$(aws wafv2 create-web-acl --name $APP-api --scope REGIONAL \
  --default-action Allow={} --rules file:///tmp/waf-rules.json \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=$APP-api \
  --tags Key=Project,Value=$APP --query Summary.ARN --output text)

aws wafv2 associate-web-acl --web-acl-arn $WEB_ACL_ARN \
  --resource-arn arn:aws:apigateway:$AWS_REGION::/restapis/$API_ID/stages/prod

# WAF log (ชื่อ log group ต้องขึ้นต้นด้วย aws-waf-logs-)
aws logs create-log-group --log-group-name aws-waf-logs-$APP
aws logs put-retention-policy --log-group-name aws-waf-logs-$APP --retention-in-days 30
aws wafv2 put-logging-configuration --logging-configuration \
  "ResourceArn=$WEB_ACL_ARN,LogDestinationConfigs=arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:aws-waf-logs-$APP,RedactedFields=[{SingleHeader={Name=authorization}}]"
```

เริ่มแรกแนะนำเปลี่ยน rule 1-2 เป็น `Count` 1-2 วันเพื่อดู false positive ใน WAF log ก่อนเปลี่ยนเป็น Block

---

## 10. AWS Amplify Hosting

แนะนำเชื่อม GitHub ผ่าน **Console** (ใช้ GitHub App ไม่ต้องสร้าง personal access token):

1. **Amplify → Create new app → GitHub** → เลือก repo `nippitch239/vault`, branch `main`
2. เลือก **"My app is a monorepo"** แล้วใส่ app root `frontend` — Amplify จะใช้ `amplify.yml` ที่ root ของ repo
   (มี `appRoot: frontend`, ติดตั้งด้วย npm workspaces, รัน lint + test ก่อน build)
3. **Environment variables** (ค่าสาธารณะเท่านั้น — ทุก `VITE_*` อยู่ใน bundle):

| Variable | ค่า |
|---|---|
| `AMPLIFY_MONOREPO_APP_ROOT` | `frontend` |
| `VITE_AUTH_MODE` | `cognito` |
| `VITE_API_URL` | `$API_URL` จากขั้นที่ 8 (`https://<id>.execute-api.<region>.amazonaws.com/prod/api/v1`) |
| `VITE_COGNITO_USER_POOL_ID` | `$USER_POOL_ID` |
| `VITE_COGNITO_CLIENT_ID` | `$CLIENT_ID` |

4. **Rewrites and redirects:** เพิ่ม SPA fallback `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>` → `/index.html` (200)
5. Save and deploy แล้วจด URL เช่น `https://main.d1234abcd.amplifyapp.com`

ทางเลือกด้วย CLI (หลังเชื่อม GitHub App แล้ว หรือใช้ token จาก secret ชั่วคราวที่ไม่เก็บลงไฟล์):

```bash
AMPLIFY_APP_ID=$(aws amplify create-app --name $APP-web --platform WEB \
  --repository https://github.com/nippitch239/vault --access-token "$GITHUB_TOKEN" \
  --environment-variables AMPLIFY_MONOREPO_APP_ROOT=frontend,VITE_AUTH_MODE=cognito,VITE_API_URL=$API_URL,VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID,VITE_COGNITO_CLIENT_ID=$CLIENT_ID \
  --custom-rules '[{"source":"</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>","target":"/index.html","status":"200"}]' \
  --tags Project=$APP --query app.appId --output text)
aws amplify create-branch --app-id $AMPLIFY_APP_ID --branch-name main --enable-auto-build --stage PRODUCTION
aws amplify start-job --app-id $AMPLIFY_APP_ID --branch-name main --job-type RELEASE
WEB_ORIGIN=https://main.$AMPLIFY_APP_ID.amplifyapp.com
```

**ปิดวงจร CORS** — อนุญาตเฉพาะโดเมน Amplify:

```bash
aws lambda update-function-configuration --function-name $APP-api --environment \
  "Variables={NODE_ENV=production,DB_SECRET_ARN=$DB_SECRET_ARN,DB_HOST=$DB_HOST,DB_PORT=5432,DB_NAME=securevault,APP_SECRET_ARN=$APP_SECRET_ARN,NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem,DB_POOL_MAX=2,DB_STATEMENT_TIMEOUT_MS=8000,COGNITO_ADMIN_GROUP=admin,CORS_ALLOW_ORIGIN=$WEB_ORIGIN}"
aws lambda wait function-updated-v2 --function-name $APP-api
aws lambda update-alias --function-name $APP-api --name live \
  --function-version $(aws lambda publish-version --function-name $APP-api --query Version --output text)
ORIGIN=$WEB_ORIGIN   # แล้วรันคำสั่ง put-gateway-response ในขั้นที่ 8 อีกครั้ง + create-deployment
```

> custom domain: Amplify → Domain management (ได้ certificate อัตโนมัติ) แล้วเพิ่มโดเมนใหม่ใน `CORS_ALLOW_ORIGIN` (คั่นด้วย comma)

---

## 11. CloudWatch และ CloudTrail

### Log retention

```bash
aws logs create-log-group --log-group-name /aws/lambda/$APP-api 2>/dev/null
for LG in /aws/lambda/$APP-api /aws/apigateway/$APP-access aws-waf-logs-$APP /aws/rds/instance/$APP-db/postgresql; do
  aws logs put-retention-policy --log-group-name $LG --retention-in-days 30
done
```

### Alarm ที่ควรตั้ง (ส่งอีเมลผ่าน SNS)

```bash
TOPIC_ARN=$(aws sns create-topic --name $APP-alerts --query TopicArn --output text)
aws sns subscribe --topic-arn $TOPIC_ARN --protocol email --notification-endpoint you@example.com  # กดยืนยันในอีเมล

alarm() {  # name namespace metric dims stat threshold operator period
  aws cloudwatch put-metric-alarm --alarm-name "$APP-$1" --namespace "$2" --metric-name "$3" \
    --dimensions $4 --statistic "$5" --threshold "$6" --comparison-operator "$7" \
    --period "${8:-300}" --evaluation-periods 1 --treat-missing-data notBreaching \
    --alarm-actions $TOPIC_ARN --ok-actions $TOPIC_ARN
}
alarm lambda-errors     AWS/Lambda   Errors        Name=FunctionName,Value=$APP-api Sum     5   GreaterThanOrEqualToThreshold
alarm lambda-throttles  AWS/Lambda   Throttles     Name=FunctionName,Value=$APP-api Sum     1   GreaterThanOrEqualToThreshold
alarm api-5xx           AWS/ApiGateway 5XXError    "Name=ApiName,Value=$APP-api Name=Stage,Value=prod" Sum 5 GreaterThanOrEqualToThreshold
alarm api-4xx-spike     AWS/ApiGateway 4XXError    "Name=ApiName,Value=$APP-api Name=Stage,Value=prod" Sum 200 GreaterThanOrEqualToThreshold
alarm rds-cpu           AWS/RDS      CPUUtilization Name=DBInstanceIdentifier,Value=$APP-db Average 80  GreaterThanThreshold
alarm rds-storage-low   AWS/RDS      FreeStorageSpace Name=DBInstanceIdentifier,Value=$APP-db Minimum 2000000000 LessThanThreshold
alarm rds-connections   AWS/RDS      DatabaseConnections Name=DBInstanceIdentifier,Value=$APP-db Maximum 60 GreaterThanThreshold
alarm waf-blocked-spike AWS/WAFV2    BlockedRequests "Name=WebACL,Value=$APP-api Name=Region,Value=$AWS_REGION Name=Rule,Value=ALL" Sum 500 GreaterThanThreshold

# p95 latency ของ API > 3 s
aws cloudwatch put-metric-alarm --alarm-name $APP-api-latency-p95 --namespace AWS/ApiGateway \
  --metric-name Latency --dimensions Name=ApiName,Value=$APP-api Name=Stage,Value=prod \
  --extended-statistic p95 --threshold 3000 --comparison-operator GreaterThanThreshold \
  --period 300 --evaluation-periods 3 --treat-missing-data notBreaching --alarm-actions $TOPIC_ARN

# error ที่ backend log เป็น JSON {"level":"error"} (unhandled error / pg pool error)
aws logs put-metric-filter --log-group-name /aws/lambda/$APP-api --filter-name app-errors \
  --filter-pattern '{ $.level = "error" }' \
  --metric-transformations metricName=AppErrors,metricNamespace=$APP,metricValue=1
alarm app-errors $APP AppErrors "" Sum 3 GreaterThanOrEqualToThreshold
```

> RDS Multi-AZ failover ส่ง event ผ่าน RDS Event Subscription: `aws rds create-event-subscription --subscription-name $APP-db-events --sns-topic-arn $TOPIC_ARN --source-type db-instance --source-ids $APP-db --event-categories failover failure maintenance`

### CloudTrail (audit ทั้งบัญชี)

```bash
TRAIL_BUCKET=$APP-cloudtrail-$ACCOUNT_ID
aws s3api create-bucket --bucket $TRAIL_BUCKET --create-bucket-configuration LocationConstraint=$AWS_REGION
aws s3api put-public-access-block --bucket $TRAIL_BUCKET --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
cat > /tmp/trail-bucket.json <<JSON
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Principal": {"Service": "cloudtrail.amazonaws.com"}, "Action": "s3:GetBucketAcl",
    "Resource": "arn:aws:s3:::$TRAIL_BUCKET",
    "Condition": {"StringEquals": {"aws:SourceArn": "arn:aws:cloudtrail:$AWS_REGION:$ACCOUNT_ID:trail/$APP-trail"}} },
  { "Effect": "Allow", "Principal": {"Service": "cloudtrail.amazonaws.com"}, "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::$TRAIL_BUCKET/AWSLogs/$ACCOUNT_ID/*",
    "Condition": {"StringEquals": {"s3:x-amz-acl": "bucket-owner-full-control",
                                   "aws:SourceArn": "arn:aws:cloudtrail:$AWS_REGION:$ACCOUNT_ID:trail/$APP-trail"}} } ] }
JSON
aws s3api put-bucket-policy --bucket $TRAIL_BUCKET --policy file:///tmp/trail-bucket.json
aws s3api put-bucket-lifecycle-configuration --bucket $TRAIL_BUCKET --lifecycle-configuration \
  '{"Rules":[{"ID":"expire","Status":"Enabled","Filter":{},"Expiration":{"Days":365}}]}'

aws cloudtrail create-trail --name $APP-trail --s3-bucket-name $TRAIL_BUCKET \
  --is-multi-region-trail --enable-log-file-validation --tags-list Key=Project,Value=$APP
aws cloudtrail start-logging --name $APP-trail
```

Management events (เช่น `GetSecretValue`, `kms:Decrypt`, การแก้ SG/IAM, `CreateDBInstance`) ถูกบันทึกโดยอัตโนมัติ
ดูได้ที่ **CloudTrail → Event history** หรือ `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue`

---

## 12. ตรวจว่า deploy สำเร็จ

```bash
curl -s $API_URL/health | jq                                      # engine=postgres, database=connected
curl -s "$API_URL/auth/salt?identifier=someone" | jq .data.salt   # ได้ salt (public route)
curl -s -o /dev/null -w "%{http_code}\n" $API_URL/collections     # 401 (ไม่มี token -> Cognito authorizer ปฏิเสธ)
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS -H "Origin: $WEB_ORIGIN" $API_URL/collections  # 204
aws wafv2 get-web-acl-for-resource --resource-arn arn:aws:apigateway:$AWS_REGION::/restapis/$API_ID/stages/prod --query WebACL.Name
```

ทดสอบผ่านหน้าเว็บ (`$WEB_ORIGIN`) ตามลำดับ:

1. หน้า landing → **สมัครสมาชิก** → ได้อีเมลรหัส 6 หลัก → ยืนยัน
2. **เข้าสู่ระบบ** → ครั้งแรกระบบสร้างโปรไฟล์ (Vault Key) → เห็นหน้าคลังรหัสผ่าน
   - ตรวจ: `aws cognito-idp list-users --user-pool-id $USER_POOL_ID --query 'Users[].Username'`
3. **เพิ่มรายการ** หนึ่งรายการ → เห็นในรายการ (ถอดรหัสบนเครื่องได้)
4. **คอลเลกชัน → สร้างคอลเลกชัน** (Create) → เห็นในรายการ (Read)
5. **แก้ไข** ชื่อ/คำอธิบาย (Update) → **จัดการสิทธิ์**: ให้สิทธิ์บัญชีที่สองที่สมัครไว้ (อ่านอย่างเดียว)
6. แก้รายการให้อยู่ในคอลเลกชันนั้น → ล็อกอินบัญชีที่สอง → เปิดคอลเลกชัน ถอดรหัสรายการได้ แต่แก้ไขไม่ได้
7. กลับบัญชีแรก → **เพิกถอนสิทธิ์** → บัญชีที่สองโหลดคอลเลกชันไม่ได้ทันที (403)
8. **ลบคอลเลกชัน** (Delete) → หายจากรายการ รายการรหัสผ่านยังอยู่ในคลัง
9. ดู log: `aws logs tail /aws/lambda/$APP-api --since 15m --format short` ต้องไม่มี `"level":"error"`

---

## 13. CI/CD

| ส่วน | ทำอย่างไร |
|---|---|
| Frontend | **Amplify auto build** ทุก push ไป `main` (lint + test + build ตาม `amplify.yml`); เปิด *Pull request previews* ได้ใน Amplify Console |
| Backend | **GitHub Actions** `.github/workflows/backend-deploy.yml` — test/lint ทุก PR, push ไป `main` แล้ว build zip → `update-function-code` → publish version → ย้าย alias `live` → รัน migrate |

GitHub Actions ใช้ **OIDC** (ไม่มี access key ใน GitHub) ตั้งครั้งเดียว:

```bash
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
cat > /tmp/gh-trust.json <<JSON
{ "Version": "2012-10-17", "Statement": [{ "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": { "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                                   "token.actions.githubusercontent.com:sub": "repo:nippitch239/vault:ref:refs/heads/main" } } }] }
JSON
aws iam create-role --role-name $APP-github-deploy --assume-role-policy-document file:///tmp/gh-trust.json
cat > /tmp/gh-deploy.json <<JSON
{ "Version": "2012-10-17", "Statement": [{ "Effect": "Allow",
  "Action": ["lambda:UpdateFunctionCode","lambda:PublishVersion","lambda:UpdateAlias","lambda:GetAlias",
             "lambda:GetFunction","lambda:GetFunctionConfiguration","lambda:InvokeFunction"],
  "Resource": ["arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:$APP-api","arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:$APP-api:*"] }] }
JSON
aws iam put-role-policy --role-name $APP-github-deploy --policy-name deploy-lambda --policy-document file:///tmp/gh-deploy.json
```

ใน GitHub → Settings → Secrets and variables → Actions → **Variables** (ไม่ใช่ secret เพราะไม่ใช่ความลับ):
`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN` (= `arn:aws:iam::<account>:role/securevault-github-deploy`), `LAMBDA_FUNCTION` (= `securevault-api`)
และสร้าง Environment ชื่อ `production` (เปิด *Required reviewers* ถ้าต้องการอนุมัติก่อน deploy)

---

## 14. Rollback และการดู log

### Backend (Lambda)

API Gateway เรียก alias `live` เสมอ — rollback = ย้าย alias กลับไป version ก่อนหน้า (ไม่ต้อง deploy API ใหม่):

```bash
aws lambda list-versions-by-function --function-name $APP-api \
  --query 'Versions[?Version!=`$LATEST`].[Version,LastModified,Description]' --output table
aws lambda update-alias --function-name $APP-api --name live --function-version <เลขเวอร์ชันก่อนหน้า>
```

- Schema เปลี่ยนแบบเพิ่มเท่านั้น (`IF NOT EXISTS`) โค้ดเวอร์ชันเก่าจึงใช้กับ schema ใหม่ได้
- ข้อมูลเสีย: **RDS point-in-time restore** ไปเป็น instance ใหม่ แล้วเปลี่ยน `DB_HOST`:
  `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier $APP-db --target-db-instance-identifier $APP-db-restore --restore-time 2026-10-16T03:00:00Z --db-subnet-group-name $APP-db --vpc-security-group-ids $SG_RDS --multi-az --no-publicly-accessible`

### Frontend (Amplify)

- Console: **Amplify → app → main → Deployments** → เลือก build ก่อนหน้า → **Redeploy this version**
- หรือ `git revert` แล้ว push (Amplify build ใหม่อัตโนมัติ)
- CLI: `aws amplify list-jobs --app-id $AMPLIFY_APP_ID --branch-name main` แล้ว `aws amplify start-job --app-id $AMPLIFY_APP_ID --branch-name main --job-type RELEASE --commit-id <sha ก่อนหน้า>`

### ดู log

| ส่วน | ที่ไหน / คำสั่ง |
|---|---|
| Lambda (backend) | `aws logs tail /aws/lambda/$APP-api --follow` — error เป็น JSON มี `requestId`, `path`, `stack` |
| API Gateway | `aws logs tail /aws/apigateway/$APP-access --follow` (status, latency, `wafResponseCode`, `authError`) |
| WAF | `aws logs tail aws-waf-logs-$APP --follow` หรือ WAF Console → *Sampled requests* |
| RDS | `aws logs tail /aws/rds/instance/$APP-db/postgresql`; Performance Insights ถ้าเปิด |
| Amplify build | Amplify Console → Deployments → build log; `aws amplify get-job` |
| Cognito | CloudTrail event history (SignUp, ConfirmSignUp, InitiateAuth) |
| Audit ทั้งบัญชี | CloudTrail → Event history / S3 bucket `$TRAIL_BUCKET` |

หา request เดียวกันข้ามระบบด้วย `requestId` (API Gateway access log ↔ Lambda log)

---

## 15. ค่าใช้จ่ายโดยประมาณต่อเดือน

ราคา on-demand **ap-southeast-1 โดยประมาณ** (730 ชม./เดือน) — ตรวจตัวเลขจริงด้วย [AWS Pricing Calculator](https://calculator.aws/) ก่อนใช้งาน

| รายการ | การคิดเงิน | ~USD/เดือน |
|---|---|---|
| RDS PostgreSQL db.t4g.micro **Multi-AZ** | 2 instance × ชั่วโมง | 35–40 |
| RDS gp3 20 GB × 2 (Multi-AZ) + backup | GB-เดือน | ~6 |
| **Interface VPC Endpoint** 2 service × 2 AZ | 4 ENI × ~$0.013/ชม. + data | ~38–40 |
| AWS WAF | $5/web ACL + $1/rule (5) + $0.60/ล้าน request | ~10 |
| KMS key + Secrets Manager (2 secret) | $1/key + $0.40/secret | ~2 |
| API Gateway REST | ~$4/ล้าน request (ต่ำในช่วงทดสอบ) | < 1 |
| Lambda | free tier 1M request + 400k GB-s | ~0 |
| Cognito | Essentials: 10,000 MAU แรกฟรี | 0 |
| Amplify Hosting | build $0.01/นาที, serve $0.15/GB | 1–3 |
| CloudWatch logs/alarms, CloudTrail S3 | ~$0.6/GB ingest, $0.10/alarm | 2–5 |
| **รวม (เปิดตลอดเดือน)** | | **~95–110** |

ไม่มี NAT Gateway ตามรูป จึงประหยัดไปได้ราว $45+/เดือน/AZ

**ประหยัดตอนทดสอบ**

1. RDS แบบ **single-AZ** ระหว่างพัฒนา (`--no-multi-az`) แล้วค่อย `modify-db-instance --multi-az --apply-immediately` ก่อนส่งงาน (−$18)
2. **หยุด RDS** เมื่อไม่ใช้: `aws rds stop-db-instance --db-instance-identifier $APP-db` (หยุดได้ 7 วัน แล้ว AWS เปิดเอง; ยังคิดค่า storage)
3. Endpoint: ระหว่างทดสอบสร้างแค่ **secretsmanager ใน AZ เดียว** (Lambda ใน AZ อื่นยังเรียกข้าม AZ ได้) หรือ **ลบ endpoint** เมื่อไม่ทดสอบ แล้วสร้างใหม่ (−$29 ถึง −$38)
4. ตั้ง **AWS Budgets** แจ้งเตือนที่ $50: `aws budgets create-budget ...` (หรือ Billing → Budgets ใน Console)
5. ลบทุกอย่างหลังทดสอบด้วยขั้นที่ 17 (ทุก resource มี tag `Project=securevault`)

---

## 16. ข้อสังเกตเรื่อง architecture

1. **ไม่มี NAT** — Lambda เรียกได้เฉพาะ RDS และ service ที่มี VPC endpoint (Secrets Manager, KMS)
   ถ้าต้องเรียก service อื่นจาก Lambda (เช่น Cognito admin API, SES ส่งอีเมล, X-Ray, CloudWatch custom metric,
   API ภายนอก) ต้องเพิ่ม interface endpoint ของ service นั้น (`cognito-idp`, `email-smtp`, `xray`, `monitoring` …
   ~$19/เดือน/service สำหรับ 2 AZ) หรือเพิ่ม NAT Gateway — โค้ดตอนนี้ไม่ต้องใช้ เพราะ API Gateway ตรวจ JWT ของ Cognito ให้แล้ว
2. **WAF อยู่ที่ API Gateway** ไม่ได้อยู่ "ระหว่าง" Amplify กับ API Gateway (เบราว์เซอร์เรียก API ตรง ๆ) —
   ถ้าต้องการกันหน้าเว็บด้วย ใช้ Amplify Hosting firewall (ผูก WAF กับ Amplify app) เพิ่มอีกชั้น
3. **RDS Proxy (แนะนำเมื่อใช้งานจริง)** — Lambda scale ได้หลายร้อย instance แต่ละตัวถือ connection ของตัวเอง;
   ตอนนี้จำกัดด้วย reserved concurrency 25 × pool 2 = ≤ 50 connection; RDS Proxy pool connection ให้,
   ลดเวลา failover ของ Multi-AZ (ต่อ proxy endpoint เดิม) และใช้ secret เดิมได้ (~$22/เดือนสำหรับ t4g.micro) —
   เปลี่ยนแค่ `DB_HOST` เป็น proxy endpoint และเพิ่ม SG rule Lambda → proxy 5432
4. **Multi-AZ failover** ใช้ ~60-120 วินาที ระหว่างนั้น request ตอบ 500/504 (frontend แสดงข้อความให้ลองใหม่)
   pool ใน backend เชื่อมต่อใหม่ให้อัตโนมัติ
5. **Cold start ใน VPC** — ENI สร้างตอนสร้าง function (Hyperplane) ไม่ใช่ทุก cold start; ถ้าต้องการลดอีกใช้
   provisioned concurrency บน alias `live`
6. **Secrets rotation** — RDS-managed secret หมุนรหัสได้ (ค่าเริ่มต้นทุก 7 วัน); backend cache secret 15 นาที
   และล้าง cache + pool เองเมื่อเจอ `28P01` (รหัสผิดหลัง rotate)
7. **อีเมลของ Cognito** จำกัดปริมาณ ระบบจริงควรตั้ง SES (อยู่นอก VPC ไม่กระทบ Lambda)

### จุดที่รูป, `Cloud Project.md` และโค้ดไม่ตรงกัน

| เรื่อง | รูป `architecture.png` | `Cloud Project.md` | โค้ด/เอกสารนี้ |
|---|---|---|---|
| ฐานข้อมูล | RDS PostgreSQL Multi-AZ | หลายจุดเขียน **DynamoDB** (ขอบเขต, UC-4/5/6/10-12) | RDS PostgreSQL (ตามรูป) |
| Compute | Lambda | วัตถุประสงค์ข้อ 5 พูดถึง **EC2 Auto Scaling + ALB** | Lambda |
| Region | region เดียว | ข้อ 6 พูดถึง **multi-region active-active** | region เดียว + backup/PITR |
| Monitoring | CloudWatch, CloudTrail | **Grafana**, **GuardDuty + Security Hub + SNS** (UC-8, UC-13) | CloudWatch alarms + SNS; GuardDuty/Grafana ไม่อยู่ในรูป (เปิดเพิ่มได้) |
| Storage | ไม่มี S3 | S3 สำหรับ static/backup/log | ต้องมี S3 bucket สำหรับ CloudTrail (รูปไม่ได้วาด) |
| การเข้ารหัสรายการ | KMS | UC-4/5 "เข้ารหัสด้วย KMS" | เข้ารหัสฝั่ง client (zero-knowledge); KMS ใช้กับ RDS/Secrets |
| WAF | อยู่ระหว่าง Amplify กับ API GW | — | ผูกกับ API Gateway stage (ดูข้อ 2) |
| Alarm | ไม่มี SNS | SNS แจ้งผู้ดูแล | เพิ่ม SNS topic สำหรับ alarm |

---

## 17. ลบทุกอย่างหลังทดสอบ

ลำดับย้อนกลับ (ปิด deletion protection ก่อน):

```bash
aws amplify delete-app --app-id $AMPLIFY_APP_ID
aws wafv2 disassociate-web-acl --resource-arn arn:aws:apigateway:$AWS_REGION::/restapis/$API_ID/stages/prod
aws apigateway delete-rest-api --rest-api-id $API_ID
aws wafv2 delete-web-acl --name $APP-api --scope REGIONAL --id <id> --lock-token <token>   # จาก list-web-acls
aws lambda delete-function --function-name $APP-api
aws rds modify-db-instance --db-instance-identifier $APP-db --no-deletion-protection --apply-immediately
aws rds delete-db-instance --db-instance-identifier $APP-db --final-db-snapshot-identifier $APP-final
aws rds wait db-instance-deleted --db-instance-identifier $APP-db
aws rds delete-db-subnet-group --db-subnet-group-name $APP-db
aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=$VPC_ID --query 'VpcEndpoints[].VpcEndpointId' --output text \
  | xargs aws ec2 delete-vpc-endpoints --vpc-endpoint-ids
# รอ ENI ของ Lambda ถูกปล่อย (~20 นาที) แล้วลบ SG, subnet, route table, VPC
aws cognito-idp update-user-pool --user-pool-id $USER_POOL_ID --deletion-protection INACTIVE
aws cognito-idp delete-user-pool --user-pool-id $USER_POOL_ID
aws secretsmanager delete-secret --secret-id $APP/app --recovery-window-in-days 7
aws kms schedule-key-deletion --key-id $KMS_KEY_ID --pending-window-in-days 7
aws cloudtrail delete-trail --name $APP-trail
```

ตรวจว่าไม่มีอะไรค้าง: `aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=securevault`
