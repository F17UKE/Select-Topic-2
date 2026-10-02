# Select-Topic-2 — Customer, merchant and rider order flow

Next.js + Express + Knex/PostgreSQL สำหรับ Cloud Lab 3 Instances โดยรอบปัจจุบันเพิ่ม
Customer auth, profile/address, store/menu browsing, client-side cart, checkout,
transactional order creation, PromptPay/slip verification พร้อม mock และ SlipOK Check Slip
adapter, merchant KDS, rider dispatch/delivery completion และ LINE integration abstraction แล้ว
การตรวจด้วย LINE/CheckSlip credential จริงและ object-storage adapter จริงยังไม่ได้ทำ
อ่าน [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md), [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
และ [schema review](database/SCHEMA_REVIEW.md) ก่อนเปลี่ยน schema หรือรัน migration

**สถานะ: พัฒนาและตรวจบน Local เท่านั้น ยังไม่ได้ deploy, migrate หรือแก้ firewall บน Cloud**
คำสั่ง Ubuntu ด้านล่างให้ใช้หลังได้รับข้อมูล SSH และคำยืนยันให้ deploy แล้ว

## โครงสร้างและเส้นทางระบบ

```text
Browser -> Frontend Nginx :80 (HTTPS :443 ก่อนเปิดใช้งานจริง)
                 |-- /, /health -> Next.js 127.0.0.1:3000
                 |-- /api/* -> Express 10.0.7.6:3001
                 |-- /api/webhooks/line -> Express 10.0.7.6:3001 (LINE signature required)
                 `-- /webhooks/line -> Express 10.0.7.6:3001 (LINE-compatible alias)
Backend 10.0.7.6 -> PostgreSQL <DB_PRIVATE_HOST>:5432
```

Frontend instance: `10.0.7.5`, backend instance: `10.0.7.6`.
Browser เรียก API ด้วย relative URL `/api/health` เท่านั้น ไม่เรียก public port 3001
Frontend ไม่มี DB credentials, `pg`, `knex` หรือการเชื่อมต่อฐานข้อมูล

```text
frontend/                Next.js App Router + Tailwind, customer/store/cart/order pages
backend/src/             Express customer/store/order/payment/merchant APIs and auth adapters
backend/migrations/      Schema V3 baseline + additive production-hardening migration (23 tables)
backend/seeds/           Idempotent local-development seed data
backend/test/            Health/config/schema SQL tests
database/SCHEMA_REVIEW.md บันทึกการอนุมัติและขอบเขต Schema V3
deploy/local/            Loopback-only PostgreSQL 16 for local development
deploy/nginx/            Frontend reverse proxy
deploy/pm2/              แยก ecosystem ของ frontend และ backend
deploy/scripts/          setup/deploy แยกเครื่อง + verification
scripts/                 Architecture tests + process/local-feature smoke tests
.github/workflows/       Verification บน Ubuntu; ไม่ deploy หรือ migrate
```

ใช้ npm workspaces และ `package-lock.json` เดียว แต่ติดตั้งเฉพาะ workspace ของแต่ละเครื่อง
PM2 อยู่ root เพื่อใช้เวอร์ชันที่ล็อกไว้ ไม่ต้องลง global PM2

## ข้อมูลที่ต้องใส่เอง

| รายการ | ใช้ที่ไหน |
| --- | --- |
| SSH host/port/user/key ของ frontend และ backend พร้อมคำยืนยัน deploy | สำหรับรอบ deploy ภายหลัง; อย่าใส่ private key ลง repo |
| PostgreSQL private host, database name, user, password | `backend/.env` บน backend เท่านั้น |
| SSL requirement และ CA certificate ถ้า provider กำหนด | `DB_SSL_MODE=verify-full`, `DB_SSL_CA_FILE` |
| `HOST=10.0.7.6`, `PORT=3001` | `backend/.env` สำหรับ Cloud |
| Domain/public frontend address และ TLS certificate | Nginx เมื่อจะเปิด HTTPS |
| LINE channel ID/secret, LIFF ID, Messaging API access token และ webhook secret | `backend/.env` เท่านั้น; ห้ามใส่ใน frontend หรือ repo |
| SlipOK branch Check Slip URL และ API key | `CHECKSLIP_API_URL`, `CHECKSLIP_API_KEY` ใน `backend/.env` เท่านั้น |
| Schema changes หลัง V3 | ต้องสร้าง additive migration ใหม่หลัง baseline ถูกใช้งาน |

Network policy ที่ต้องตรวจสอบก่อน deploy (ไม่มีสคริปต์แก้ firewall):

- รับ traffic จาก browser ที่ frontend 80/443 เท่านั้น; Next :3000 bind loopback
- Backend :3001 bind private `10.0.7.6`; อนุญาต source frontend `10.0.7.5` เท่านั้น
- DB :5432 อนุญาต source backend `10.0.7.6` เท่านั้น; ไม่เปิด public และไม่อนุญาต frontend
- SSH จำกัด source ตามนโยบาย Cloud Lab; อย่าเปลี่ยน rule จนได้รับคำยืนยัน
- ถ้า provider ใช้ `pg_hba.conf` ให้กำหนด host/database/user และ source backend `/32`
  โดยผู้ดูแล DB; ไม่ใช้ `trust` หรือ `0.0.0.0/0`

## 1. Local development / verification

ต้องมี Node 22.19+ ในสาย 22.x หรือ Node 24.x; `.nvmrc` ล็อก 22.23.3 สำหรับ Ubuntu setup/CI

```bash
git clone https://github.com/F17UKE/Select-Topic-2.git
cd Select-Topic-2
npm ci
cp frontend/.env.example frontend/.env
cp deploy/local/.env.example deploy/local/.env
cp backend/.env.local.example backend/.env
npm run db:local:up
npm run db:migrate --workspace backend
npm run db:seed --workspace backend
npm run db:verify-local --workspace backend
npm run verify
npm run test:smoke
npm run test:smoke:local
```

Windows PowerShell ใช้ `Copy-Item` แทน `cp` ได้ และใช้ `npm.cmd` ถ้า execution policy
ไม่ให้รัน `npm.ps1` สคริปต์ Ubuntu ไม่ต้องรันบน Windows

Local PostgreSQL ใช้ image `postgres:16-alpine`, database `select_topic_2_local`
และ bind เฉพาะ `127.0.0.1:55432` ค่า password ใน example เป็น known local-only value
ห้ามนำไปใช้บน Cloud หรือ environment ที่มีข้อมูลจริง `deploy/local/.env` และ
`backend/.env` ถูก `.gitignore` ไว้ การหยุด container โดยเก็บ volume ใช้:

```bash
npm run db:local:down
```

```bash
# Terminal 1
npm run dev:backend
# Terminal 2
npm run dev:frontend
# Terminal 3
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/api/health
```

Development Next.js proxy `/api/*` ไป `127.0.0.1:3001` ให้ browser ใช้ origin เดียว
Production ไม่มี Next.js API rewrite; Nginx เป็นผู้ proxy
Application server ต้องมี DB configuration ครบจึงเริ่มได้ หากใส่บางส่วนหรือค่าผิดรูปแบบ
server จะไม่เริ่ม ให้เติมให้ครบ

Local auth ใช้ค่าต่อไปนี้ใน `backend/.env.local.example`:

```dotenv
CUSTOMER_AUTH_MODE=mock
ENABLE_DEV_LOGIN=true
DEV_CUSTOMER_LINE_USER_ID=U_LOCAL_CUSTOMER_001
PAYMENT_VERIFICATION_MODE=mock
MERCHANT_STAFF_AUTH_MODE=mock
ENABLE_STAFF_DEV_LOGIN=true
DEV_MERCHANT_STAFF_USERNAME=local_manager
LINE_MESSAGING_MODE=disabled
```

`POST /api/dev/auth/login` จะค้นหา synthetic customer จาก seed และสร้าง session cookie
แบบ HTTP-only ใน memory ของ process ปิดได้ด้วย `ENABLE_DEV_LOGIN=false` เมื่อ
`NODE_ENV=production` ระบบจะไม่ยอมเริ่มหาก `CUSTOMER_AUTH_MODE=mock` หรือ
`ENABLE_DEV_LOGIN=true` ส่วน production example ใช้ `CUSTOMER_AUTH_MODE=line` Frontend
โหลด LIFF SDK เฉพาะโหมดนี้และส่ง ID token ไป backend Backend ตรวจ token กับ LINE verify
endpoint พร้อมตรวจ issuer, expiry และ audience เทียบ `LINE_CHANNEL_ID` ก่อนใช้ verified
`sub` เป็น `line_user_id`; ค่า identity ที่ frontend ส่งเพิ่มเองจะไม่ถูกนำมาเชื่อถือ

LINE Messaging ใช้ `LINE_MESSAGING_MODE=disabled|mock|real`; automated tests ใช้ fake
provider เท่านั้น โหมด production default เป็น `real` และบังคับมี channel access token,
LIFF ID, channel ID และ webhook secret จริง Secrets อยู่ใน `backend/.env` เท่านั้น

Staff mock login ใช้ session cookie แยกจาก customer และเลือก seed username
`local_manager`, `local_cashier`, `local_kitchen` หรือ `local_rider` ผ่าน
`POST /api/dev/merchant/auth/login` ได้เฉพาะเมื่อ `ENABLE_STAFF_DEV_LOGIN=true`
Production guard ไม่ยอมเริ่มเมื่อ `NODE_ENV=production` คู่กับ staff mock/dev login
โหมด `password` ใช้ bcrypt cost 12, HTTP-only `SameSite=Lax` session cookie, `Secure`
ใน production, regenerate session หลัง login และ rate limit 5 ครั้งต่อ IP+username ใน 15 นาที
บัญชี seed ทุก role ใช้รหัส local-only `local-development-only` และห้ามนำไปใช้บน Cloud

Payment mock ใช้ได้เฉพาะ development/test และ production guard จะหยุด process ทันทีถ้า
`NODE_ENV=production` คู่กับ `PAYMENT_VERIFICATION_MODE=mock` ไฟล์สลิป local อยู่ใต้
`backend/storage/slips/` ซึ่งไม่ถูก serve เป็น public file; database เก็บเฉพาะ object key
และ SHA-256 hash การเลือก mock scenario ในหน้า UI แสดงเฉพาะเมื่อ backend อยู่ mock mode

โหมด `PAYMENT_VERIFICATION_MODE=checkslip` ใช้ adapter แยกใน
`backend/src/payment-verifiers/checkslip-provider.cjs` ตาม SlipOK Check Slip v1.8 โดยรับ full
branch endpoint และ API key จาก environment ส่ง slip แบบ multipart และ normalize response ก่อน
คืนให้ payment service Backend ตรวจยอด ผู้รับ PromptPay (รองรับค่าที่ provider mask) และ transaction
reference ซ้ำเองอีกชั้น HTTP 400/422 ที่เป็นข้อมูลสลิปไม่ผ่านจะเป็น `REJECTED`; auth, rate limit,
5xx, timeout, invalid JSON และ response ผิดรูปจะเป็น `ERROR` และสร้าง payment attempt ใหม่เพื่อ retry
ได้ การ lock order/payment และ unique transaction reference ป้องกัน paid ซ้ำ

ทดสอบ provider จริงด้วยตนเองเท่านั้น และต้องใช้ไฟล์ส่วนตัวนอก repo:

```bash
PAYMENT_VERIFICATION_MODE=checkslip npm run checkslip:manual --workspace backend -- /private/path/slip.png
```

คำสั่งนี้ไม่อยู่ใน automated verification และพิมพ์เฉพาะ redacted normalized response หากไม่มี
credential จะรายงาน `NOT RUN — credentials unavailable`

### Application routes

| Method | Route | การทำงาน |
| --- | --- | --- |
| GET | `/api/auth/config` | mode และสถานะ dev login ที่เปิดเผยได้ |
| POST | `/api/dev/auth/login` | local-only synthetic customer login |
| POST | `/api/auth/line` | ตรวจ LIFF ID token และสร้าง server-side customer session |
| GET / POST | `/api/auth/me`, `/api/auth/logout` | session ปัจจุบัน / ออกจากระบบ |
| GET / PATCH | `/api/customer/profile` | ดูและแก้ display name/phone |
| GET | `/api/dormitories` | dropdown หอพักพร้อมซอย |
| GET / POST | `/api/customer/addresses` | ดูและเพิ่มที่อยู่ |
| PATCH | `/api/customer/addresses/:id` | แก้ที่อยู่ที่เป็นของ customer ปัจจุบัน |
| PUT | `/api/customer/addresses/:id/default` | ตั้งที่อยู่หลักแบบ transaction |
| GET | `/api/merchants?q=&addressId=` | รายการร้าน ค้นชื่อร้าน/เมนู และค่าส่งตามซอย |
| GET | `/api/merchants/:id?addressId=` | ร้าน gallery หมวดหมู่ และเมนู |
| GET | `/api/merchants/:id/menu` | หมวดหมู่และรายการเมนูของร้าน |
| GET | `/api/menu-items/:id` | รายละเอียด item และ option groups/choices |
| POST | `/api/orders` | ตรวจ DB price/options/fee และสร้าง order+snapshots ใน transaction |
| GET | `/api/orders` | ประวัติออเดอร์ของ customer ปัจจุบัน |
| GET | `/api/orders/:id` | รายละเอียดจาก snapshot โดย enforce ownership |
| POST | `/api/orders/:id/payments` | สร้าง/reuse PromptPay attempt จากยอดใน order |
| GET | `/api/orders/:id/payment` | payment/slip/verification ล่าสุดของเจ้าของ order |
| GET | `/api/orders/:id/payment/qr` | Dynamic PromptPay payload + PNG data URL จากร้านและยอดใน DB |
| POST | `/api/orders/:id/payment/slip` | multipart `slip`; ตรวจ MIME/magic bytes/size แล้ว verify |
| GET | `/api/merchant/orders` | รายการออเดอร์เฉพาะ merchant ของ staff |
| GET | `/api/merchant/orders/:id` | snapshot detail พร้อมลดข้อมูลสำหรับ KITCHEN |
| POST | `/api/merchant/orders/:id/accept` | `PENDING → ACCEPTED`; PromptPay ต้อง PAID |
| POST | `/api/merchant/orders/:id/reject` | `PENDING → REJECTED`; paid order แจ้ง manual refund |
| POST | `/api/merchant/orders/:id/start-preparing` | `ACCEPTED → PREPARING` |
| POST | `/api/merchant/orders/:id/ready` | `PREPARING → READY` เมื่อ item ครบ |
| PATCH | `/api/merchant/orders/:orderId/items/:itemId` | mark KDS item true/false |
| POST | `/api/merchant/orders/:id/complete-all-items` | mark ทุก item; ไม่เปลี่ยน READY อัตโนมัติ |
| GET | `/api/merchant/riders` | MANAGER ดู active riders ของร้านตนเอง |
| POST | `/api/merchant/orders/:id/assign-rider` | MANAGER มอบหมาย rider ให้ DELIVERY ที่ READY |
| POST | `/api/merchant/orders/:id/unassign-rider` | MANAGER ยกเลิกก่อนเริ่มจัดส่ง |
| GET | `/api/rider/orders` | READY/DELIVERING ที่ assign ให้ rider ปัจจุบัน |
| GET | `/api/rider/orders/:id` | ข้อมูลจัดส่งขั้นต่ำเฉพาะงานที่ assign ให้ตนเอง |
| POST | `/api/rider/orders/:id/start-delivery` | assigned rider เปลี่ยน `READY → DELIVERING` |
| POST | `/api/rider/orders/:id/complete` | assigned rider เปลี่ยน `DELIVERING → COMPLETED` |
| POST | `/api/webhooks/line` | ตรวจ raw-body HMAC signature และรับ follow/unfollow/postback |

`POST /api/orders` ต้องมี `Idempotency-Key` ยาว 8-128 ตัวอักษร ตัว backend จะรวม
concurrent request ที่ใช้ customer/key/body เดียวกัน และปฏิเสธ key เดิมที่เปลี่ยน body
กลไกนี้เก็บใน PostgreSQL โดย scope ตาม customer, fingerprint request, เก็บผลตอบกลับ 24 ชั่วโมง
และใช้ PostgreSQL advisory transaction lock จึง replay ได้หลัง process restart และ serialize
คำขอพร้อมกันข้าม app instance ได้

หน้า frontend: `/`, `/profile`, `/stores/:id`, `/menu/:id`, `/cart`, `/checkout`,
`/orders`, `/orders/:id`, `/merchant`, `/merchant/orders`, `/merchant/orders/:id`,
`/merchant/kitchen`, `/rider`, `/rider/orders`, `/rider/orders/:id` และ `/health`
ตะกร้าเก็บใน localStorage และราคาในตะกร้าเป็น
ค่าประมาณการเท่านั้น Backend ไม่รับราคา ยอดชำระ หรือ PromptPay ID จาก client เป็น
authoritative value เมื่อ verify ผ่าน ระบบเปลี่ยน `payment_status=PAID` แต่คง
`order.status=PENDING` จนกว่า merchant ที่มีสิทธิ์จะกดรับออเดอร์
`orders` ไม่มี `reject_reason` ใน Schema V3 รอบนี้ reject จึงบันทึกเฉพาะสถานะและ API
ปฏิเสธ request ที่ส่ง reason ด้วย `reject_reason_not_supported` เพื่อไม่ทิ้งข้อมูลเงียบ ๆ
Schema V3 มี `assigned_rider_id` และ `completed_at`; additive production-hardening migration
เพิ่ม `delivering_at` และระบบบันทึกเมื่อเริ่มจัดส่งแล้ว

LINE webhook event IDs เก็บใน `line_webhook_events` เพื่อ deduplicate ข้าม restart (retention 7 วัน)
ส่วน notification เขียน `notification_outbox` ใน transaction เดียวกับ order/payment state แล้ว worker
จึงส่งหลัง commit หาก provider ล้มจะ retry แบบ exponential backoff และ dedupe ด้วย event+order key
ไฟล์สลิปใช้ storage interface; local adapter พร้อม retention worker ตาม `purge_after` ส่วน production
ใช้ S3-compatible adapter สำหรับ `PutObject`, `HeadObject` และ `DeleteObject` โดย bucket ต้องเป็น private
และ backend เก็บเฉพาะ object key รูปแบบ `slips/YYYY/MM/<uuid>.<ext>` ไม่มี public URL/ACL
retention worker ลบ object จริงผ่าน adapter แล้วคง payment ledger และ metadata row ตามเดิม

Object mode ต้องตั้ง `SLIP_OBJECT_STORAGE_ENDPOINT`, `SLIP_OBJECT_STORAGE_REGION`,
`SLIP_OBJECT_STORAGE_BUCKET`, `SLIP_OBJECT_STORAGE_ACCESS_KEY`,
`SLIP_OBJECT_STORAGE_SECRET_KEY` และ `SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE`; production บังคับ HTTPS
ถ้า provider ใช้ private CA ให้ตั้ง `SLIP_OBJECT_STORAGE_CA_FILE` เป็น path ของ CA bundle บน backend host
ทดสอบ provider จริงแบบ manual (สคริปต์จะ upload/head/delete และ cleanup เสมอ) ด้วย:

```bash
npm run storage:test-object --workspace backend
```

หากยังไม่ได้ใส่ credentials สคริปต์จะรายงาน `NOT RUN — credentials unavailable` และไม่ยิง network

## 2. เตรียม backend Ubuntu 24.04 (หลังอนุมัติ deploy)

เข้า SSH เป็น deployment user ที่มี sudo และรัน:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/F17UKE/Select-Topic-2.git
cd Select-Topic-2
# ถ้างาน bootstrap ยังอยู่เฉพาะ local ต้องนำ revision นี้ขึ้น repo/ส่งไฟล์ก่อน
# ทั้งสองเครื่องต้องใช้ revision เดียวกันที่ตรวจแล้ว
git rev-parse HEAD
bash deploy/scripts/setup-backend.sh
nano backend/.env
chmod 600 backend/.env
```

ตั้ง `HOST=10.0.7.6`, `PORT=3001` และเติม DB_* จาก Cloud Lab; password ว่างใน example
ถ้ามี `#` หรือช่องว่างใน password ให้ใส่ quote ตาม dotenv format ไม่ source `.env` ด้วย shell
ไม่ต้องมี `DATABASE_URL` หรือ `NEXT_PUBLIC_*` ที่บรรจุ secrets

Setup ติดตั้ง curl/CA/xz และ Node จาก official tarball ที่ตรวจ SHA256 หากยังไม่มี Node
ถ้ามี Node รุ่นที่ไม่รองรับจะหยุดให้จัดการเอง ไม่ทับ runtime เดิม
ไฟล์ `.env` ที่มีอยู่จะไม่ถูกเขียนทับและตั้ง permission เป็น 600

```bash
bash deploy/scripts/deploy-backend.sh
```

Deploy ติดตั้งเฉพาะ backend + PM2, ตรวจ production config ทั้งหมด/private bind, รัน `SELECT 1`,
เริ่ม/รีสตาร์ท PM2 และตรวจ health โดย **ไม่รัน migration**
ถ้า DB check ล้มเหลว แก้ credentials/private routing/TLS ก่อนรัน deploy ซ้ำ
สคริปต์จะสร้าง S3 client ระหว่าง preflight เพื่อตรวจ endpoint/TLS/credentials config โดยยังไม่ upload object;
ให้รัน manual provider test ข้างต้นจาก backend host ก่อน deploy จริง

## 3. เตรียม frontend Ubuntu 24.04 (หลังอนุมัติ deploy)

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/F17UKE/Select-Topic-2.git
cd Select-Topic-2
git rev-parse HEAD
bash deploy/scripts/setup-frontend.sh
bash deploy/scripts/deploy-frontend.sh
```

Deploy ติดตั้ง frontend + PM2 + build tools, build production, เปิด Next บน loopback,
ติดตั้ง Nginx config, รัน `nginx -t` ก่อน reload แล้วตรวจทั้งเส้นทางถึง PostgreSQL
Backend ต้องพร้อมก่อนจึงจะได้ผล verification ผ่านครบ

ใช้ PM2 fork 1 process ต่อเครื่อง; DB pool `min=0,max=2` (config อนุญาตสูงสุด 5)
Next build จำกัด 1 worker และ heap 640 MB พร้อม Webpack memory optimization
ข้อจำกัด heap ไม่ใช่เพดาน RAM รวม และยังไม่ผ่านการวัดบนเครื่อง Cloud RAM 1 GB
ถ้า build OOM ให้ build บน Linux runner ที่มี RAM เพียงพอด้วย Node/architecture เดียวกัน
แล้วส่ง `.next/` พร้อม source/lockfile ของ revision เดียวกันไป frontend
จากนั้นติดตั้ง dependencies และเริ่ม PM2 ตามด้านล่าง; ห้ามใช้ Windows `.next/` บน Ubuntu
ไม่มีการเพิ่ม swap หรือเปลี่ยนเครื่องให้โดยอัตโนมัติ

```bash
# กรณีใช้ build artifact จาก Linux แทน build บน Cloud
npm ci --include=dev --workspace frontend --include-workspace-root
./node_modules/.bin/pm2 startOrRestart deploy/pm2/frontend.ecosystem.config.cjs --update-env
./node_modules/.bin/pm2 save
# ติดตั้ง Nginx ตามหัวข้อ manual ด้านล่าง แล้วรัน verify-frontend.sh
```

สคริปต์รองรับ fresh dedicated instances: ตรวจชื่อ PM2 คงที่เพื่อไม่สร้าง process ซ้ำ,
ติดตั้ง dependencies จาก lockfile, เก็บ `.env` เดิม และไม่ migrate/แก้ firewall
รัน deploy ซ้ำมีช่วง restart/ติดตั้ง dependencies ไม่ใช่ zero-downtime deployment
หากมี Nginx site อื่นหรือ config เดิมต่างจากใน repo จะหยุดให้ review แทนการเขียนทับ
stock default symlink จะย้ายไป `/etc/nginx/select-topic-2-default.backup` นอก sites-enabled
หาก `nginx -t` ไม่ผ่าน จะย้อนการเปลี่ยน enabled symlinks ของรอบนั้นและไม่ reload

## 4. PM2 startup หลัง reboot (ทั้งสองเครื่อง)

ใช้ deployment user เดิมทุกครั้ง **อย่าใช้ `sudo pm2 start`**

```bash
./node_modules/.bin/pm2 status
./node_modules/.bin/pm2 startup systemd -u "$USER" --hp "$HOME"
# PM2 จะแสดงคำสั่ง sudo ที่รวม PATH จริง ให้รันคำสั่งนั้นตามที่แสดง
./node_modules/.bin/pm2 save
sudo systemctl status "pm2-$USER" --no-pager
```

Startup เป็นขั้นตอนแยกที่ต้องทำตามคำสั่ง PM2 บน host จริง ไม่ได้ตั้ง systemd ไว้จากเครื่องนี้
เมื่อติดตั้ง Node ใหม่หรือย้าย repo ให้สร้าง startup service ใหม่ให้ตรง path
ตั้ง log rotation ตามนโยบายเครื่องก่อนใช้งานยาวนาน; bootstrap ยังไม่มี log rotation service

## 5. Verification commands

บน backend:

```bash
cd Select-Topic-2
npm run db:check --workspace backend
curl --fail-with-body --max-time 10 http://10.0.7.6:3001/api/health
./node_modules/.bin/pm2 logs select-topic-2-backend --lines 50 --nostream
```

`db:check` ใช้ `pg` ผ่าน Knex ด้วย environment เดียวกับ API และรัน `SELECT 1`
โดยไม่ต้องใส่ password บน command line; exit 0 เมื่อเชื่อมต่อสำเร็จ, 1 เมื่อล้มเหลว

บน frontend:

```bash
curl --fail-with-body --max-time 10 http://127.0.0.1:3000/health
curl --fail-with-body --max-time 10 http://10.0.7.6:3001/api/health
sudo nginx -t
curl --fail-with-body --max-time 10 http://127.0.0.1/health
curl --fail-with-body --max-time 10 http://127.0.0.1/api/health
bash deploy/scripts/verify-frontend.sh http://127.0.0.1
```

จากเครื่องผู้ใช้ ให้เปิด frontend public address/domain และกดปุ่มตรวจสถานะ
หรือแทน `FRONTEND_PUBLIC_HOST` แล้วรัน (ไม่ใช้ public backend address):

```bash
curl --fail-with-body http://FRONTEND_PUBLIC_HOST/health
curl --fail-with-body http://FRONTEND_PUBLIC_HOST/api/health
curl -i -H 'Content-Type: application/json' -d '{"events":[]}' http://FRONTEND_PUBLIC_HOST/api/webhooks/line
curl -i -H 'Content-Type: application/json' -d '{"events":[]}' http://FRONTEND_PUBLIC_HOST/webhooks/line
```

ผลที่คาดหวัง:

```json
{"service":"frontend","status":"ok"}
```

```json
{"status":"ok","api":{"status":"ok"},"database":{"status":"ok"}}
```

- API+DB พร้อม: HTTP 200; DB ติดต่อไม่ได้: HTTP 503, database `unavailable`
- ไม่ตั้ง DB เลย: HTTP 503, database `not_configured`; ไม่ส่ง credentials/error ภายในกลับ browser
- `/api/webhooks/line` และ `/webhooks/line` ที่ไม่มี `x-line-signature`: HTTP 401 เป็นผลที่คาดหวัง
- 502 จาก Nginx: ตรวจ PM2/private bind/route; 503 จาก API: ตรวจ DB config/TLS/network
- `/health` ตรวจ frontend เท่านั้น; `/api/health` ตรวจ DB connectivity ไม่ได้ตรวจว่ามี tables แล้ว
- Health ใช้ query เบา ไม่มี auto polling; production monitoring ควรใช้ความถี่เหมาะสม

## 6. Migration — แยกจาก deployment

Schema V3 ได้รับอนุมัติใน [SCHEMA_REVIEW.md](database/SCHEMA_REVIEW.md) และ initial
migration ถูกออกแบบสำหรับ database ใหม่ที่ว่างเท่านั้น Local seed มี guard บังคับ
database `select_topic_2_local` บน loopback จึงไม่สามารถใช้ seed กับ Cloud ได้

หลังอนุมัติและตรวจว่าเป็น DB ว่าง/มี backup กับแผน reconciliation แล้ว บน backend เท่านั้น:

```bash
npm run db:migrate --workspace backend
npm run db:status --workspace backend
npm run db:seed --workspace backend # local only
npm run db:verify-local --workspace backend # local only
```

Knex บันทึก migration history และไม่รันไฟล์เดิมซ้ำ ใช้ transaction ตามค่า default
อย่าเรียก `db:rollback` บนข้อมูลจริงโดยไม่มีแผน เพราะ down migration ลบทั้ง 20 ตาราง
เมื่อ initial migration ถูก apply ใน environment ใดแล้ว ห้ามแก้ไฟล์เดิม ให้สร้าง migration ใหม่

## Nginx manual installation / HTTPS

หากมี config เดิม ให้ review diff และ backup ก่อนติดตั้ง ไม่รันคำสั่งทับ custom config โดยตรง
สำหรับ fresh instance หลังตรวจแล้ว:

```bash
sudo install -m 644 deploy/nginx/select-topic-2.conf /etc/nginx/sites-available/select-topic-2
sudo ln -sfn /etc/nginx/sites-available/select-topic-2 /etc/nginx/sites-enabled/select-topic-2
# หากมี stock default ให้ย้ายออกจาก sites-enabled ไป backup นอก directory นี้ก่อน
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
bash deploy/scripts/verify-frontend.sh http://127.0.0.1
```

Config เป็น HTTP bootstrap และ `server_name _`; ต้องเปลี่ยนเป็น domain จริงและเพิ่ม
TLS/HTTPS ก่อน LINE webhook หรือข้อมูลผู้ใช้จริง ยังไม่สร้าง certificate/DNS ในรอบนี้
`proxy_pass` ไม่มี slash หลัง upstream เพื่อรักษา `/api/health` และ `/api/webhooks/line`

## Dependencies และหลักฐานการตรวจ

ผลรอบปัจจุบันอยู่ใน [VERIFICATION.md](VERIFICATION.md)
`npm run verify` แยก lint/test/build เพราะ Next 16 build ไม่รัน ESLint ให้เอง
`npm run test:smoke` เปิด process local ชั่วคราวบน loopback/random ports แล้วปิดเอง
ทดสอบ DB timeout ด้วย TCP sink local ไม่ใช้ฐานข้อมูล Cloud หรือสร้างตาราง

ESLint 9 ใช้ตาม peer range ของ `eslint-plugin-react` ที่มากับ Next config ปัจจุบัน
(npm แจ้ง deprecated; lint ยังผ่านและไม่ได้อยู่ production backend install)
Root overrides ตรึง PM2 `js-yaml` เป็น 4.3.2 และ `get-uri` -> `basic-ftp` เป็น 6.2.1
เพื่อแก้ audit advisories ใน transitive dependencies; ทบทวนเมื่ออัปเดต PM2
FTP/PAC proxy ไม่ได้ใช้งานใน application นี้

อ้างอิงทางเทคนิค: [Next installation](https://nextjs.org/docs/app/getting-started/installation),
[Next memory usage](https://nextjs.org/docs/app/guides/memory-usage),
[Knex configuration](https://knexjs.org/guide/), [Knex migrations](https://knexjs.org/guide/migrations),
[Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass),
[PM2 startup](https://pm2.keymetrics.io/docs/usage/startup/).
