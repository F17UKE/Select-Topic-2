# 📌 PROJECT CONTEXT: LINE OA Food Delivery Platform (LIFF-based)

> **วัตถุประสงค์ของเอกสารนี้:** ใช้เป็นบริบทตั้งต้นหลัก (Master Context) สำหรับการพัฒนาและป้อนให้ AI Assistant รับทราบขอบเขตทางธุรกิจ (Business Logic), สถาปัตยกรรมระบบ, สถานะกระบวนการ (State Machine), และข้อกำหนดทางเทคนิคทั้งหมด เพื่อให้การเขียนโค้ดและสร้าง API สอดคล้องกับมาตรฐานของระบบโดยสมบูรณ์[cite: 4]

---

## 1. Executive Summary & Problem Statement

* **ภาพรวมโปรเจกต์:** แพลตฟอร์มสั่งและจัดส่งอาหารแบบเรียลไทม์ภายในชุมชนเฉพาะส่วน (เช่น มหาวิทยาลัยหรือวิทยาเขต) ผ่าน Web Application (LIFF App) ที่เชื่อมต่อกับ LINE Official Account[cite: 4]
* **ปัญหาเดิม (Pain Point):** ระบบเดิมใช้การสั่งอาหารผ่านกลุ่ม Line OpenChat ซึ่งก่อให้เกิดปัญหาสำคัญ:[cite: 4]
  1. เมื่อข้อความสะสมจำนวนมาก ตัวแอปพลิเคชันจะกระตุก หน่วง (Lag) หรือไม่ยอมโหลดข้อความ[cite: 4]
  2. การค้นหาร้านค้าและเมนูกระจัดกระจาย ไม่เป็นหมวดหมู่[cite: 4]
  3. ติดตามสถานะออเดอร์ลำบาก และเกิดความผิดพลาดในการยืนยันยอดโอนเงิน[cite: 4]
* **แนวทางแก้ไข (Solution):** พัฒนา Web Application ผ่าน LIFF ที่รวมศูนย์การค้นหา, ควบคุมสถานะคำสั่งซื้อผ่าน Finite State Machine, คำนวณค่าส่งตามระยะซอย/โซน, รองรับการปรับแต่งเมนู (Modifiers), เชื่อมต่อ Dynamic PromptPay QR Code, ตรวจสลิปอัตโนมัติ, ระบบครัว KDS, บัญชีพนักงานร้านค้า (Merchant Staff) พร้อมระบบแชทแบบ Order-based ที่รองรับการแจ้งเตือนผ่าน LINE Push Message และระบบล้างข้อมูลหมดอายุทุก 24 ชั่วโมง[cite: 4]

---

## 2. Core User Roles & Delivery Model

1. **Customer (ผู้ซื้อ):**[cite: 4]
   * ลงทะเบียนและเข้าสู่ระบบแบบไร้รอยต่อผ่าน LINE Login 
   * จัดการที่อยู่จัดส่งได้หลายแห่ง (`CUSTOMER_ADDRESSES`) เช่น หอพักตัวเอง หอเพื่อน หรือใต้ตึกคณะ พร้อมระบุเบอร์โทรศัพท์ประจำที่อยู่นั้น
   * เลือกรูปแบบการสั่งได้ทั้ง `DELIVERY` (จัดส่ง) และ `PICKUP` (รับที่ร้าน) 
   * ตรวจสอบค่าจัดส่งที่คำนวณตามซอย/หอพักปลายทางแบบไดนามิก[cite: 4]
   * สแกนจ่ายเงินผ่าน Dynamic PromptPay QR Code หรือเลือกชำระแบบ COD และอัปโหลดสลิปธนาคาร[cite: 4]
   * ติดตามสถานะอาหารแบบ Real-time และพูดคุยกับร้านค้า/คนส่งผ่าน In-App Chat[cite: 4]
2. **Merchant (ร้านค้า):**[cite: 4]
   * ลงทะเบียนร้านค้า ระบุ PromptPay ID, ตัวย่อร้าน (Prefix), ที่ตั้ง, เบอร์โทร และรูปภาพ โดยผูกผู้รับแจ้งเตือนผ่าน `merchant_staffs.line_user_id`[cite: 4]
   * ตั้งค่าเรทค่าจัดส่งแยกตามซอย (`delivery_fees`) หรือเปิดให้จัดส่งฟรี[cite: 4]
   * จัดการแคตตาล็อกเมนูอาหาร คำอธิบาย ราคา กลุ่มตัวเลือกเสริม (`is_required`, `min_choices`, `max_choices`) และจัดการสต๊อกสินค้า[cite: 4]
   * ใช้งานระบบครัว (Kitchen Display System - KDS) เพื่อติ๊กเครื่องหมายเสร็จรายจาน (`is_completed`) หรือกดเสร็จสิ้นทั้งบิล[cite: 4]
   * **การจัดการพนักงาน (Merchant Staff Management):** ร้านค้าสามารถสร้างบัญชี Staff ประจำร้าน (`MERCHANT_STAFFS`) พร้อมกำหนดบทบาท (`MANAGER`, `CASHIER`, `KITCHEN`, `RIDER`) และกดมอบหมายออเดอร์ให้คนขับแต่ละคนได้[cite: 4]
3. **Merchant Staff - Rider (คนส่งอาหารประจำร้าน):**[cite: 4]
   * เข้าสู่ระบบผ่านหน้าล็อกอินเฉพาะด้วย Username และ Password ที่ร้านค้าสร้างให้[cite: 4]
   * เข้าถึงเฉพาะหน้า Rider Dispatch Board เพื่อดูคิวออเดอร์ที่ตนได้รับมอบหมาย (`WHERE delivery_staff_id = :id`)[cite: 4]
   * มีสิทธิ์กดเปลี่ยนสถานะเป็น `DELIVERING` และ `COMPLETED`
   * **ข้อจำกัดสิทธิ์ (Security Isolation):** ไม่สามารถเปิดดูยอดขายรวม, บัญชีรายได้, เมนูหลังบ้าน หรือข้อมูลส่วนตัวของร้านค้าได้[cite: 4]

---

## 3. Tech Stack & System Architecture

### Frontend (User Interface & Client)
* **Core Framework:** Next.js (App Router) สำหรับ LIFF App และ Web Dashboard
* **Styling:** Tailwind CSS 
* **Platform Integration:** LINE Front-end Framework (LIFF) สำหรับฝั่งลูกค้า

### Backend & Real-time Processing
* **Core Backend:** Node.js (Express.js) - RESTful API Architecture[cite: 4]
* **Messaging & Notifications:** LINE Messaging API (Push/Reply Message) และ Webhook สำหรับแจ้งเตือนร้านค้าและลูกค้า
* **Architecture Pattern:** Repository Pattern เพื่อการจัดการข้อมูลที่เป็นระบบและยืดหยุ่น[cite: 4]

### Database & External Integration
* **Database Management:** Relational Database (PostgreSQL จัดการผ่าน Knex.js Migration & Query Builder)[cite: 4]
* **Payment Integration:** Dynamic PromptPay QR Generator (`promptpay-qr` library)[cite: 4]
* **Verification Engine:** Slip Verification API สำหรับตรวจสอบความถูกต้องของสลิปแบบอัตโนมัติ[cite: 4]
* **Asset Storage:** จัดเก็บรูปภาพ (สลิป, โปรไฟล์, เมนู) บน Object Storage และบันทึกเฉพาะ URL ลงฐานข้อมูล[cite: 4]

---

## 4. Key Workflows & Business Logic

### 4.1 Order State Machine (วงจรสถานะออเดอร์)
สถานะของคำสั่งซื้อในตาราง `orders` ต้องดำเนินไปตามลำดับอย่างเคร่งครัด:[cite: 4]

1. **`PENDING` (รอร้านตรวจสอบ):** ลูกค้ายืนยันออเดอร์ ระบบบันทึก snapshot และเริ่มกระบวนการชำระเงิน[cite: 4]
2. **`ACCEPTED` (ร้านรับออเดอร์):** ร้านยืนยันว่าจะดำเนินการตามออเดอร์[cite: 4]
3. **`PREPARING` (กำลังทำอาหาร):** ร้านเริ่มปรุงอาหารหลังผ่านเงื่อนไขการรับออเดอร์และชำระเงิน[cite: 4]
4. **`READY` (อาหารพร้อม):** สำหรับ DELIVERY คือรอมอบหมาย/รับโดย Rider และสำหรับ PICKUP คือรอลูกค้ามารับ[cite: 4]
5. **`DELIVERING` (กำลังจัดส่ง):** ใช้เฉพาะ DELIVERY เมื่อ Rider นำอาหารออกจากร้าน[cite: 4]
6. **`COMPLETED` (เสร็จสมบูรณ์):** ส่งมอบหรือรับอาหารเรียบร้อย[cite: 4]
7. **`CANCELLED` / `REJECTED`:** ลูกค้า/ระบบยกเลิก หรือร้านปฏิเสธออเดอร์ เป็นสถานะสิ้นสุด[cite: 4]

### 4.2 Dynamic Payment & Verification Pipeline
1. เมื่อออเดอร์อยู่ในสถานะรอชำระเงิน ระบบจะนำ PromptPay ID ของร้านค้า + `total_amount` ของออเดอร์นั้นมาสร้างเป็น Dynamic PromptPay QR Code[cite: 4]
2. ลูกค้าอัปโหลดรูปภาพสลิปโอนเงิน ระบบจะตรวจสอบผ่าน API อัตโนมัติ:[cite: 4]
   * ยอดเงินที่โอน (`amount_transferred`) ตรงกับยอดสุทธิหรือไม่[cite: 4]
   * บัญชีผู้รับตรงกับร้านค้าหรือไม่[cite: 4]
   * รหัสอ้างอิง (`ref_number`) ต้องไม่ซ้ำในระบบ[cite: 4]
3. เก็บแต่ละ payment attempt ใน `payments`, เก็บไฟล์ใน `payment_slips` และผล CheckSlip ใน `payment_verifications` โดย `transaction_reference` ต้องไม่ซ้ำทั้งระบบ
4. หากผ่านเงื่อนไข ระบบจะปรับ verification เป็น `VERIFIED`, payment เป็น `PAID`, บันทึก `verified_at` และส่ง LINE Push Message ผ่าน Messaging API[cite: 4]

### 4.3 Kitchen Display System (KDS) Logic
* ตาราง `order_items` มีฟิลด์ `is_completed` (Boolean) เพื่อระบุสถานะรายจาน[cite: 4]
* **การทำงานระดับจาน:** เมื่อพ่อครัวทำเสร็จ 1 รายการ สามารถอัปเดต `is_completed = true` ระบบจะตรวจสอบจำนวนจานที่เหลือ หากเสร็จครบทุกจาน จะปรับสถานะออเดอร์เป็น `READY` โดยอัตโนมัติ[cite: 4]
* **การทำงานระดับบิล:** ร้านค้ากดปุ่ม "เสร็จสิ้นทั้งหมด" เพื่อปรับสถานะออเดอร์ และระบบจะอัปเดต `is_completed = true` ให้ทุกรายการในบิลนั้น[cite: 4]

### 4.4 Real-time Chat, Multi-Role Messaging & Read Receipts
* **Order-based Room:** สร้างห้องแชทแยกตามรายออเดอร์ (1 คำสั่งซื้อ = 1 ห้อง) ใช้งานผ่าน LIFF App และ Web Dashboard[cite: 4]
* **Unified Merchant Chat & Role Toggling:** ระบบแชทยึดโครงสร้าง 2 ฝั่ง (`is_merchant_sender: true/false`) แต่ฝั่งร้านค้า/พนักงานสามารถระบุบทบาท (`sender_sub_role`) ขณะพิมพ์ได้:[cite: 4]
  * `STORE`: พิมพ์ในฐานะร้านค้า (เช่น แม่ค้าแจ้งเรื่องวัตถุดิบ)[cite: 4]
  * `RIDER`: พิมพ์ในฐานะคนส่งอาหาร (เช่น แจ้งว่าถึงใต้หอพักแล้ว)[cite: 4]
* **Read Receipts (Watermark Pattern):** บันทึกข้อความล่าสุดที่แต่ละ customer/staff อ่านใน `order_chat_read_states` เพื่อรองรับพนักงานหลายคนต่อร้าน[cite: 4]
* **LINE Notification Bridge:** เมื่อมีการส่งข้อความใหม่ ระบบจะส่งแจ้งเตือนผ่าน LINE ทันที เพื่อดึงผู้ใช้กลับเข้ามาพิมพ์ตอบใน LIFF App

### 4.5 Data Purging Policy (24h Retention)
* ระบบเบื้องหลังจะรัน Scheduled Cron Job เพื่อล้าง `order_messages` ตามอายุ `created_at`, รูปสลิปตาม `purge_after` และ redacted provider response ตาม `response_purge_after`[cite: 4]
* Durable payment ledger, transaction reference, ยอดเงิน และประวัติคำสั่งซื้อจะคงอยู่ แม้ลบไฟล์สลิปออกจาก Object Storage[cite: 4]

---

## 5. Architectural & Database Design Rules

1. **Snapshot Pattern (แช่แข็งข้อมูล):** ต้องเก็บ `order_items.item_name`, `unit_price`, `order_item_choices.choice_name`, `extra_price`, `orders.delivery_fee` และ typed delivery address snapshot ห้ามพึ่งพา Master Data สำหรับใบสั่งย้อนหลัง[cite: 4]
2. **Surrogate Key Priority:** ใช้ `id` (Serial/Auto-increment Integer) เป็น Primary Key ของทุกตารางเสมอ สำหรับ `username` หรือรหัสต่างๆ ให้ควบคุมด้วย `UNIQUE` Constraint[cite: 4]
3. **Database Schema Reference:** โครงสร้าง DDL, Data Dictionary, constraints และความสัมพันธ์ให้ยึด **`DATABASE_SCHEMA.md` (Schema V3)** และ initial Knex migration ที่ได้รับอนุมัติเป็นหลัก[cite: 4]

---

## 6. AI Development Guidelines

เมื่อนำเอกสารนี้ไปใช้ในการ Prompt สั่งงาน ให้ AI ปฏิบัติตามมาตรฐานต่อไปนี้:[cite: 4]

* **Environment Alignment:** เขียนโค้ด Backend ด้วย Node.js (Express.js) ร่วมกับ Knex.js Query Builder[cite: 4]
* **Strict State Transition:** ทุกฟังก์ชันที่เกี่ยวข้องกับการปรับสถานะออเดอร์ ต้องดักตรวจสอบสถานะตั้งต้นตาม Order State Machine เสมอ ห้ามข้ามขั้นตอน[cite: 4]
* **Security & Validation:** ตรวจสอบความถูกต้องของ Input เสมอ และบังคับใช้ Role-Based Access Control (RBAC) กั้นสิทธิ์ Rider และ Customer[cite: 4]
* **High Performance Querying:** คำนึงถึงดัชนี (Indexes) และเขียนคำสั่ง Query ให้อยู่ในรูปแบบที่ประหยัด I/O ของ Database เสมอ[cite: 4]
