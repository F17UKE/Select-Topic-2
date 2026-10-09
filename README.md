# Select-Topic-2 — Food delivery platform and Admin Backoffice

## Marketplace Finance — local workflow

Migration 008 adds Finance without switching payment collection automatically. Read [Finance report and operator guide](docs/FINANCE_SPRINT_REPORT.md), [exact schema](docs/FINANCE_SCHEMA_IMPLEMENTED.md) and [verification](VERIFICATION.md) before enabling centralized mode.

Pages: /merchant/finance (MANAGER), /admin/finance (SUPER_ADMIN / FINANCE). Keep the existing local startup scripts. After checking the local target/backup, use npm run db:migrate --workspace backend, then npm run db:status --workspace backend and npm run db:verify-local --workspace backend. Do not run local seed on production.

Finance invariant/demo tests (Windows existing portable PostgreSQL):

~~~powershell
$env:LOCAL_PG_BIN="$env:LOCALAPPDATA\select-topic-2\postgresql-16.15-tar\pgsql\bin"
node scripts/isolated-local-verification.cjs --test backend/test/finance.integration.test.cjs
node scripts/isolated-local-verification.cjs
~~~

Tests clone the local DB, isolate providers, and clean only their own disposable schemas. They never seed or erase public financial balances. Full suites use separate clones because financial history is immutable.

Optional scheduled work: npm run finance:scheduled --workspace backend. Run with the correct environment from an external scheduler (e.g. hourly). Only opted-in merchants produce one request per UTC three-day window, subject to server holds/quota/balance rules. The command also expires paid ads. It does not send bank transfers, install a scheduler or bypass Super Admin confirmation.

Payout account verification/change imposes a 24-hour hold; successful payout imposes a 72-hour cooldown. Do not bypass these timestamps for public/demo convenience. Confirm Paid requires the external bank reference after independently confirming actual transfer. Private proof is optional and never served publicly. Back up the persistent encryption key and database securely; do not commit .runtime, keys, dumps or uploads.


Admin Integration Settings: `/admin/settings/integrations` (Super Admin only).
See [setup, encrypted secrets, precedence and provider verification](docs/ADMIN_INTEGRATION_SETTINGS.md).
Additive migration 007 adds one private integration-settings table. Development automatically creates
and reuses `backend/.runtime/integration-settings.key` (ignored by Git); no Owner key setup is needed.
Production requires `INTEGRATION_SETTINGS_ENCRYPTION_KEY` or an existing persistent
`INTEGRATION_SETTINGS_KEY_FILE` outside Git. ENV keys take priority. Existing ENV fallbacks
remain supported. Platform PromptPay configuration is stored only and does not replace merchant QR
recipients. Finance remains frozen. Real provider tests require a separate explicit action.

Phase J production-preparation documentation: [system architecture](SYSTEM_ARCHITECTURE.md),
[production deployment checklist](DEPLOYMENT_CHECKLIST.md), [local demo script](DEMO_SCRIPT.md),
[database schema](DATABASE_SCHEMA.md) and [verification record](VERIFICATION.md).

Release-fix verification (2026-10-09): run `node scripts/isolated-local-verification.cjs` for the
full backend suite and mutating local smoke flows without writing to the public demo tables.
Requires the existing portable PostgreSQL tools; override their bin directory with `LOCAL_PG_BIN`
if necessary. It creates/removes a disposable test schema and checks that demo data is unchanged.
See [current results and limitations](VERIFICATION.md).

Customer and staff server sessions expire after 8 hours, matching their cookie lifetime;
Admin session policy is separate and unchanged. Production deployment validates only the selected
payment provider: `easyslip` needs `EASYSLIP_API_KEY` and valid `EASYSLIP_MERCHANT_ACCOUNTS`, while
`checkslip` needs `CHECKSLIP_API_URL` and `CHECKSLIP_API_KEY`. Mock is forbidden in production.
The HTTPS template uses `listen 443 ssl http2` for Ubuntu 24.04's Nginx 1.24; run `nginx -t` on the
rendered config with real certificate paths before enabling it. This local phase does not deploy.

Phase F (Local): start/status/stop portable DB with `npm run start-db`, `npm run status-db`,
`npm run stop-db`. See [local management](deploy/local/README.md) and [verification](VERIFICATION.md).
Migration 004 adds immutable promotion snapshots and redemption records; migrations 001–003 stay unchanged.
Checkout requests an authoritative quote via `POST /api/orders/quote`, then revalidates on `POST /api/orders`.
`GET /api/promotions?merchantId=...` and `GET /api/promotions/:id` require a customer session.
Suspended merchants reject new checkout/orders, while staff can still fulfill existing orders.
Published banners respect start/end dates and sorting; SCHEDULED/DRAFT require publication before
becoming customer-visible. Home displays eligible banners in a swipe carousel with dots (no autoplay) and has an image/API failure fallback.
`npm run test:smoke:local` includes both ordinary and discounted payment-to-delivery flows.

Next.js + Express + Knex/PostgreSQL สำหรับ Cloud Lab 3 Instances โดยรอบปัจจุบันเพิ่ม
Customer auth, profile/address, store/menu browsing, client-side cart, checkout,
transactional order creation, PromptPay/slip verification พร้อม mock และ SlipOK Check Slip
adapter, merchant KDS, rider dispatch/delivery completion, LINE integration, S3-compatible
object storage และ Central Admin Backoffice แล้ว การตรวจด้วย LINE/CheckSlip/object-storage
credential จริงยังต้องทำกับ provider ของ production
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
Backend 10.0.7.6 -> PostgreSQL 10.0.7.7:5432
```

Frontend instance: `10.0.7.5`, backend instance: `10.0.7.6`.
Browser เรียก API ด้วย relative URL `/api/health` เท่านั้น ไม่เรียก public port 3001
Frontend ไม่มี DB credentials, `pg`, `knex` หรือการเชื่อมต่อฐานข้อมูล

```text
frontend/                Next.js App Router + Tailwind, customer/store/cart/order pages
backend/src/             Express customer/store/order/payment/merchant APIs and auth adapters
backend/migrations/      Schema V3 baseline + additive migrations 002–006 (36 application tables)
backend/seeds/           Idempotent local-development seed data
backend/test/            Health/config/schema SQL tests
database/SCHEMA_REVIEW.md บันทึกการอนุมัติและขอบเขต Schema V3
deploy/local/            Loopback-only PostgreSQL 16 for local development
deploy/nginx/            Frontend reverse proxy
deploy/systemd/          single-process frontend/backend services with restart/start-on-boot
deploy/scripts/          setup/deploy แยกเครื่อง + verification
scripts/                 Architecture tests + process/local-feature smoke tests
.github/workflows/       Verification บน Ubuntu; ไม่ deploy หรือ migrate
```

ใช้ npm workspaces และ `package-lock.json` เดียว แต่ติดตั้งเฉพาะ workspace ของแต่ละเครื่อง
Production ใช้ systemd ของ Ubuntu โดยตรง; local development scripts ไม่ต้องใช้ process manager

## ข้อมูลที่ต้องใส่เอง

| รายการ | ใช้ที่ไหน |
| --- | --- |
| SSH host/port/user/key ของ frontend และ backend พร้อมคำยืนยัน deploy | สำหรับรอบ deploy ภายหลัง; อย่าใส่ private key ลง repo |
| PostgreSQL private host, database name, user, password | `/etc/select-topic-2/backend.env` บน backend เท่านั้น |
| SSL requirement และ CA certificate ถ้า provider กำหนด | `DB_SSL_MODE=verify-full`, `DB_SSL_CA_FILE` |
| `HOST=10.0.7.6`, `PORT=3001` | `/etc/select-topic-2/backend.env` สำหรับ Cloud |
| Domain/public frontend address และ TLS certificate | Nginx เมื่อจะเปิด HTTPS |
| LINE channel ID/secret, LIFF ID, Messaging API access token และ webhook secret | `/etc/select-topic-2/backend.env` เท่านั้น; ห้ามใส่ใน frontend หรือ repo |
| SlipOK branch Check Slip URL และ API key | `CHECKSLIP_API_URL`, `CHECKSLIP_API_KEY` ใน `/etc/select-topic-2/backend.env` เท่านั้น |
| Schema changes หลัง V3 | ต้องสร้าง additive migration ใหม่หลัง baseline ถูกใช้งาน |

Network policy ที่ต้องตรวจสอบก่อน deploy (ไม่มีสคริปต์แก้ firewall):

- รับ traffic จาก browser ที่ frontend 80/443 เท่านั้น; Next :3000 bind loopback
- Backend :3001 bind private `10.0.7.6`; อนุญาต source frontend `10.0.7.5` เท่านั้น
- DB :5432 อนุญาต source backend `10.0.7.6` เท่านั้น; ไม่เปิด public และไม่อนุญาต frontend
- SSH จำกัด source ตามนโยบาย Cloud Lab; อย่าเปลี่ยน rule จนได้รับคำยืนยัน
- ถ้า provider ใช้ `pg_hba.conf` ให้กำหนด host/database/user และ source backend `/32`
  โดยผู้ดูแล DB; ไม่ใช้ `trust` หรือ `0.0.0.0/0`

## 1. Local development / verification

เครื่อง Windows นี้ใช้ portable PostgreSQL เดิมที่ `127.0.0.1:5432` และ `pgdata-v3` ตาม
ignored `backend/.env` ให้ใช้ [Windows portable instructions](deploy/local/README.md)
ก่อน Docker workflow ด้านล่าง ห้าม copy example ทับ `.env` ที่ใช้งานได้อยู่แล้ว

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
npm run test:smoke:final
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

Admin Backoffice ใช้ session แยกจาก customer และ merchant ที่ `/admin/login` Local seed สร้าง
`local_super_admin` พร้อมรหัส synthetic `local-admin-only` เฉพาะฐานข้อมูล
`select_topic_2_local` บน loopback เท่านั้น Admin session เก็บ token แบบ hash ใน PostgreSQL,
cookie เป็น HTTP-only/SameSite=Lax/Secure ใน production, write API ตรวจ CSRF และ backend RBAC
ทุกครั้ง Login rate limit 5 ครั้งต่อ IP+username ใน 15 นาทีเป็น process-local จึงควรใช้
rate limiter ที่ Nginx/edge เพิ่มเมื่อรันหลาย backend instances

Payment mock ใช้ได้เฉพาะ development/test และ production guard จะหยุด process ทันทีถ้า
`NODE_ENV=production` คู่กับ `PAYMENT_VERIFICATION_MODE=mock` ไฟล์สลิป local อยู่ใต้
`backend/storage/slips/` ซึ่งไม่ถูก serve เป็น public file; database เก็บเฉพาะ object key
และ SHA-256 hash การเลือก mock scenario ในหน้า UI แสดงเฉพาะเมื่อ backend อยู่ mock mode

โหมด `PAYMENT_VERIFICATION_MODE=checkslip` ใช้ adapter แยกใน
`backend/src/payment-verifiers/checkslip-provider.cjs` ตาม SlipOK Check Slip v1.8 โดยรับ full
branch endpoint และ API key จาก environment ส่ง slip แบบ multipart และ normalize response ก่อน
คืนให้ payment service Backend ตรวจยอด ผู้รับ PromptPay (รองรับค่าที่ provider mask) และ transaction
reference ซ้ำเองอีกชั้น HTTP 400/422 ที่เป็นข้อมูลสลิปไม่ผ่านจะเป็น `REJECTED`; auth, rate limit,
5xx, timeout, invalid JSON และ response ผิดรูปจะเป็น `ERROR`; retry ใช้ attempt และรูปเดิม
เพื่อคง unique image claim ส่วนผล `REJECTED` สร้าง attempt ใหม่ด้วยสลิปใหม่ได้
การ lock order/payment และ unique transaction reference ป้องกัน paid ซ้ำ

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
| POST / GET | `/api/admin/auth/login`, `/me`, `/logout` | Admin session แยก, CSRF และ revoke logout |
| GET | `/api/admin/dashboard` | metrics, status breakdown และ recent orders จากข้อมูลจริง |
| GET / POST / PATCH | `/api/admin/merchants`, `/customers`, `/orders`, `/payments` | global management ตาม RBAC; order/payment เน้น read-only |
| GET / POST / PATCH | `/api/admin/delivery-areas` | จัดการซอย/หอแบบ soft deactivate |
| GET / POST / PATCH | `/api/admin/banners`, `/promotions` | content management, scheduling และ validation |
| POST | `/api/admin/banners/upload` | upload รูปผ่าน storage abstraction; เก็บ private object key |
| GET | `/api/banners/active` | published banners ที่อยู่ในช่วงเวลา; Home fallback ได้เมื่อว่าง/ล้มเหลว |
| GET / POST / PATCH | `/api/admin/users` | SUPER_ADMIN จัดการผู้ดูแล; ป้องกัน last-super-admin |
| GET | `/api/admin/audit-logs`, `/system-status`, `/reports` | append-only audit, safe status และ SQL aggregates |

`POST /api/orders` ต้องมี `Idempotency-Key` ยาว 8-128 ตัวอักษร ตัว backend จะรวม
concurrent request ที่ใช้ customer/key/body เดียวกัน และปฏิเสธ key เดิมที่เปลี่ยน body
กลไกนี้เก็บใน PostgreSQL โดย scope ตาม customer, fingerprint request, เก็บผลตอบกลับ 24 ชั่วโมง
และใช้ PostgreSQL advisory transaction lock จึง replay ได้หลัง process restart และ serialize
คำขอพร้อมกันข้าม app instance ได้

หน้า frontend: `/`, `/profile`, `/stores/:id`, `/menu/:id`, `/cart`, `/checkout`,
`/orders`, `/orders/:id`, `/merchant`, `/merchant/orders`, `/merchant/orders/:id`,
`/merchant/kitchen`, `/rider`, `/rider/orders`, `/rider/orders/:id` และ `/health`
รวม Admin desktop-first ที่ `/admin`, `/admin/merchants`, `/admin/customers`,
`/admin/orders`, `/admin/payments`, `/admin/delivery-areas`, `/admin/banners`,
`/admin/promotions`, `/admin/users`, `/admin/audit-logs`, `/admin/system-status`,
`/admin/settings` และ `/admin/reports`
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

## ## 2. เตรียม production Ubuntu 24.04 (หลังอนุมัติ deploy)

Production ใช้ systemd โดยตรง ไม่ใช้ PM2 และกำหนด release path เป็น `/opt/select-topic-2`
ทั้ง frontend/backend ต้อง checkout commit เดียวกัน:

```bash
sudo mkdir -p /opt/select-topic-2
sudo git clone https://github.com/F17UKE/Select-Topic-2.git /opt/select-topic-2
cd /opt/select-topic-2
git checkout <reviewed-commit-sha>
git rev-parse HEAD
```

สคริปต์รองรับการรันเป็น `root` ของ Cloud Lab หรือ deployment user ที่มี sudo และสร้าง
system user `select-topic-2` ซึ่งไม่มี interactive shell

### Backend 10.0.7.6

```bash
cd /opt/select-topic-2
bash deploy/scripts/setup-backend.sh
vi /etc/select-topic-2/backend.env
bash deploy/scripts/deploy-backend.sh
```

ไฟล์จริงอยู่ที่ `/etc/select-topic-2/backend.env` mode 0600 นอก Git
ใช้ [backend/.env.example](backend/.env.example) เป็นรายการตัวแปร แต่ห้ามเก็บค่าจริงใน repo
Deploy ตรวจ production config ทุก domain, private bind, object-storage adapter และ DB connectivity
ก่อน restart `select-topic-2-backend.service`; deploy ไม่ migrate database อัตโนมัติ

### Database 10.0.7.7:5432

ก่อน migrate ให้รัน read-only preflight ซึ่งบังคับ target `10.0.7.7:5432`, ปฏิเสธชื่อ
local/test และตรวจ migration history:

```bash
cd /opt/select-topic-2
node --env-file=/etc/select-topic-2/backend.env backend/scripts/preflight-production-db.cjs
export CONFIRM_DB_TARGET='10.0.7.7/<production-db-name>'
# ตั้งค่านี้หลัง verify backup เท่านั้น และใช้เมื่อ preflight พบข้อมูล
export PRODUCTION_DB_BACKUP_REFERENCE='<backup-reference>'
bash deploy/scripts/migrate-production.sh
unset CONFIRM_DB_TARGET PRODUCTION_DB_BACKUP_REFERENCE
```

Migration ต้องเรียง 001–006 และ pending เป็น 0 สคริปต์ไม่รัน seed/rollback
ห้ามใช้ `db:seed` หรือ `db:verify-local` กับ production

### Frontend 10.0.7.5

```bash
cd /opt/select-topic-2
bash deploy/scripts/setup-frontend.sh
bash deploy/scripts/deploy-frontend.sh
```

สคริปต์ build Next.js, เริ่ม `select-topic-2-frontend.service` บน
`127.0.0.1:3000`, ติดตั้ง HTTP bootstrap Nginx และตรวจเส้นทางถึง backend/DB
Frontend environment อยู่ที่ `/etc/select-topic-2/frontend.env` และไม่มี provider/DB secret
หลัง build สคริปต์ prune dev-only lint/build dependencies ก่อนเริ่ม runtime

Next build จำกัด 1 worker และ heap 640 MB หากเครื่อง 1 GB OOM ให้ build บน Linux runner
ที่ใช้ Node/architecture และ revision เดียวกัน แล้วส่ง artifact จาก Linux เท่านั้น ห้ามใช้ Windows
`.next/` บน Ubuntu และสคริปต์จะไม่เพิ่ม swap เอง

## 3. systemd และ reboot

ทั้งสอง unit ใช้ process เดียว, restart on failure, start on boot, journald และ hardening options:

```bash
sudo systemctl status select-topic-2-backend --no-pager
sudo systemctl status select-topic-2-frontend --no-pager
sudo journalctl -u select-topic-2-backend -n 50 --no-pager
sudo journalctl -u select-topic-2-frontend -n 50 --no-pager
```

หลังได้รับอนุมัติ reboot ต้องตรวจ PostgreSQL reachability, `systemctl is-active` ของ backend,
frontend และ Nginx แล้วตรวจ health/proxy ซ้ำ

## 4. Nginx และ HTTPS

[select-topic-2.conf](deploy/nginx/select-topic-2.conf) เป็น HTTP bootstrap เท่านั้น หลังทราบ
domain และติดตั้ง certificate แล้วให้ render template:

```bash
bash deploy/scripts/configure-nginx-tls.sh <domain> /absolute/fullchain.pem /absolute/privkey.pem
```

Template redirect HTTP ไป HTTPS, ใส่ HSTS เฉพาะ TLS virtual host และส่ง `Host`,
`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` ที่ Nginx กำหนดเอง
เส้นทาง `/api/*`, `/api/webhooks/line` และ `/webhooks/line` ไป
`10.0.7.6:3001`; เส้นทางอื่นไป Next.js `127.0.0.1:3000`
สคริปต์ไม่ออก certificate และจะเรียก `nginx -t` ก่อน reload

## 5. Verification บน Cloud

```bash
curl --fail-with-body http://127.0.0.1:3000/health
curl --fail-with-body http://10.0.7.6:3001/api/health
curl --fail-with-body https://<domain>/api/health
bash deploy/scripts/verify-frontend.sh https://<domain>
```

Expected: frontend/API/database เป็น `ok`; unsigned webhook ทั้งสอง alias ตอบ 401
จากนั้นทำ manual provider tests ตาม [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md):
LINE LIFF/Login/Webhook/Flex, SlipOK amount/recipient/duplicate และ private object storage
upload/HEAD/delete Automated tests ไม่เรียก provider จริง

## Dependencies และหลักฐานการตรวจ

ผลรอบปัจจุบันอยู่ใน [VERIFICATION.md](VERIFICATION.md)
`npm run verify` แยก lint/test/build และ `npm run security:scan` ตรวจ credential/runtime artifact
PM2 ถูกถอดจาก production runtime; `npm audit --omit=dev` จึงไม่ผ่าน chain
`PM2 -> chokidar -> braces` อีก Local scripts `dev:frontend`, `dev:backend`,
`start-db`, `stop-db` และ `status-db` ไม่เปลี่ยน

อ้างอิง [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) สำหรับ environment, migration,
TLS, provider และ reboot gates ทั้งหมด

Merchant management — Phase G (local)

Start the existing portable PostgreSQL with `npm run start-db`, then:

```powershell
npm run db:migrate --workspace backend
npm run db:status --workspace backend
npm run db:verify-local --workspace backend
npm run dev --workspace backend
# In a second terminal:
npm run dev --workspace frontend
```

Open http://127.0.0.1:3000/merchant and use the existing local manager login. The expandable
management menu links to store settings, categories, menu/new/detail/options, delivery fees,
staff, riders, order history, reports, promotions and banners. Production still uses existing
password authentication and mock guards. Seed was not rerun or expanded in Phase G; existing
seed is sufficient. Never run the local seed on Cloud.

Additional repeatable local test: `npm run test:smoke:merchant-management` (rollback-isolated
HTTP integration suite plus isolated concurrency fixtures). Full checks: `npm run verify`,
`npm run test:smoke:local`, `npm run test:smoke`, `npm audit`.
See `database/PHASE_G_MIGRATION_REVIEW.md` and `database/PHASE_G_REPORT.md` for policies,
API map, test evidence, known limitations and Phase H stock proposals.

## Customer engagement — Phase H (local)

After `npm run start-db`, apply migration 006 and keep the existing local services running:

```powershell
npm run db:migrate --workspace backend
npm run db:status --workspace backend
npm run db:verify-local --workspace backend
npm run test:smoke:customer-engagement
```

The idempotent local seed provides 3 merchants, 19 menu items, option groups/choices, all staff roles,
delivery fees, one published banner, coupon `WELCOME10`, an active free-delivery promotion, one
synthetic customer and a completed order/review. These records are synthetic; the seed guard refuses
non-loopback databases and any database name other than `select_topic_2_local`.

Customer routes added in Phase H are `/favorites`, `/promotions` and `/notifications`. Completed order
details support review and reorder preview. Checkout accepts one coupon or one automatic promotion,
never both. Admin manages coupons and review visibility at `/admin/coupons` and `/admin/reviews`;
Merchant Manager/Cashier can read their own reviews at `/merchant/reviews`.

Key APIs:

- `GET|POST|DELETE /api/customer/favorites[/:merchantId]`
- `GET /api/merchants/:id/reviews`
- `GET|POST /api/orders/:id/review`, `POST /api/orders/:id/reorder-preview`
- `GET|PATCH /api/customer/notifications[/:id/read]`, `POST /api/customer/notifications/read-all`
- `GET /api/promotions` for current customer discovery
- Admin review/coupon APIs under `/api/admin/reviews` and `/api/admin/coupons`
- `GET /api/merchant/reviews` for the authenticated merchant only

See `database/PHASE_H_MIGRATION_REVIEW.md` and `database/PHASE_H_REPORT.md` for the schema decision,
security rules, test evidence and known limitations.

## Customer image presentation standards

ขนาดต่อไปนี้เป็นคำแนะนำสำหรับจัดเตรียมรูป ไม่ใช่เงื่อนไขปฏิเสธการอัปโหลด รูปที่ผ่าน validation ชนิดไฟล์/ขนาดเดิมยังใช้งานได้

| รูปภาพ | ขนาดแนะนำ | อัตราส่วน |
| --- | --- | --- |
| Merchant logo / profile | 800 × 800 px | 1:1 |
| Merchant cover / gallery | 1200 × 800 px | 3:2 |
| Menu item | 1000 × 1000 px | 1:1 |
| Home banner | 1600 × 720 px | 20:9 |
| Promotion image (เมื่อมีช่องรูปในอนาคต) | 1000 × 600 px | 5:3 |

ใช้ JPG, PNG หรือ WebP ตาม upload validation เดิม วางข้อความ/จุดสำคัญของรูปให้อยู่บริเวณกลางภาพ เผื่อการครอบด้วย `object-fit: cover` บน Home รูป banner และ store cover ใช้อัตราส่วนเดียวกันทุก breakpoint; ไม่บันทึกหรือแปลงรูปต้นฉบับ

Home ใช้ mobile padding 16px, container สูงสุด 760px, banner swipe พร้อม dots (ไม่มี autoplay), โปรโมชันเลื่อนแนวนอน และร้านหนึ่งคอลัมน์บนมือถือ/สองคอลัมน์ตั้งแต่ 640px ส่วน logo/profile และ promotion image เป็นมาตรฐานเตรียม asset เท่านั้น ยังไม่มีการเพิ่มช่องอัปโหลด/API ใหม่

## Local payment separation and EasySlip v2 (2026-10-08)

Checkout → `/orders/[id]/payment` → verified PAID → `/orders/[id]`.
Order Detail keeps order/delivery snapshots, timeline, review and totals; unpaid orders have
a compact payment action. No QR/upload is mixed into tracking. Existing customer-owned APIs
and cookie/origin protection remain; no new API namespace.

QR is local `promptpay-qr` + `qrcode`; persisted discounted order total and the merchant's
PromptPay identifier are authoritative, not browser amount/receiver. No EasySlip v1 call.

EasySlip adapter uses [official v2 Bank verification](https://document.easyslip.com/en/v2/verify/bank/)
server-to-server: Bearer auth; multipart `image`, `remark`, `matchAmount`,
`matchAccount=true`, `checkDuplicate=true`. Connect/request limits default 3000/10000ms,
bounded response size, no redirects/retries or raw provider logging. Known errors follow
the [official error-code contract](https://document.easyslip.com/en/reference/error-codes).

Protected backend environment (never NEXT_PUBLIC):
- `PAYMENT_VERIFICATION_MODE=mock|checkslip|easyslip`; existing default is unchanged.
- `EASYSLIP_API_BASE_URL=https://api.easyslip.com/v2` (fixed allowlisted origin)
- `EASYSLIP_API_KEY`, `EASYSLIP_CONNECT_TIMEOUT_MS`, `EASYSLIP_REQUEST_TIMEOUT_MS`
- `EASYSLIP_MERCHANT_ACCOUNTS`: JSON object keyed by merchant ID. Each entry binds
  `promptpayType`, `promptpayId`, `bankCode`, `bankNumber`; store full digits only in
  protected config. Enrollment/account ownership must be independently verified. Empty
  mapping is safe: the adapter stops before network. A changed merchant PromptPay ID
  invalidates the mapping. Admin Merchant Detail now supports encrypted DB overrides for each
  merchant, with this ENV format retained as fallback. See `docs/ADMIN_MERCHANT_RECIPIENTS.md`.

PAID requires strict success, matching amount flag and three exact satang amounts
(order/amountInOrder/amountInSlip/raw amount), nonempty bounded reference, exact merchant
registered account AND raw recipient account, no provider duplicate, and a free local ledger
reference. Masked raw accounts fail closed. Branch-wide/name-only matching is insufficient.
Payment/order/ledger/outbox finalize atomically under order→payment locks; network runs outside
DB locks. Customer responses omit provider payload/reference/private object key. Admin readers
retain existing permission-controlled diagnostics.

Uploads remain private via existing local/S3 abstraction with server MIME/magic inspection,
random names and retention. Effective limit is capped at 4,194,304 bytes even with an older
larger SLIP_MAX_BYTES setting. ERROR retries reuse the original image/attempt and global hash
claim; REJECTED allows a new slip/attempt. An already-paid replay does not reverify or notify.
A duplicate provider result without a local paid ledger fails for review, never amount-only credit.

Manual provider-only verification, **not run automatically**:

```text
npm run payment:test-easyslip --workspace backend -- --confirm-real-verification <absolute-private-image-outside-repo> <merchant-id> <expected-THB-amount>
```

Reads ignored backend environment, validates image/mapping, performs at most one verification,
prints only safe normalized metadata/reference digest; imports no DB/payment writer.
Missing explicit confirmation/key means NOT RUN. No real key/slip belongs in Git.

Read VERIFICATION's current PARTIAL gates before switching modes. Automated mock tests do not
prove live enrolled-account mapping or Owner browser acceptance.
