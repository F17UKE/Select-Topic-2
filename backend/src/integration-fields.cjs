// The allowlist is also the source for the Admin form; no secret value is included.
const fields = {
  PAYMENT_INTEGRATION_ENABLED: { section: 'payment', label: 'เปิดรับการชำระเงิน', type: 'boolean', default: 'true' },
  PAYMENT_VERIFICATION_MODE: { section: 'payment', label: 'ผู้ตรวจสอบสลิป', type: 'enum', options: ['mock', 'easyslip', 'checkslip'] },
  PLATFORM_PROMPTPAY_ENABLED: { section: 'promptpay', label: 'เก็บการตั้งค่านี้เป็นพร้อมใช้งาน (ยังไม่เชื่อมกับการชำระเงิน)', type: 'boolean', default: 'false' },
  PLATFORM_PROMPTPAY_TYPE: { section: 'promptpay', label: 'ประเภทผู้รับ', type: 'enum', options: ['PHONE', 'NATIONAL_ID', 'TAX_ID', 'EWALLET'], default: 'PHONE' },
  PLATFORM_PROMPTPAY_ID: { section: 'promptpay', label: 'หมายเลข PromptPay', type: 'secret', identifier: true },
  PLATFORM_PROMPTPAY_NAME: { section: 'promptpay', label: 'ชื่อแสดง', type: 'text' },
  EASYSLIP_API_KEY: { section: 'easyslip', label: 'EasySlip API Key', type: 'secret' },
  EASYSLIP_API_BASE_URL: { section: 'easyslip', label: 'EasySlip Base URL', type: 'fixed', default: 'https://api.easyslip.com/v2' },
  CHECKSLIP_API_URL: { section: 'checkslip', label: 'CheckSlip API URL', type: 'url' },
  CHECKSLIP_API_KEY: { section: 'checkslip', label: 'CheckSlip API Key', type: 'secret' },
  LINE_LOGIN_ENABLED: { section: 'login', label: 'เปิด LINE Login', type: 'boolean', default: 'true' },
  LINE_CHANNEL_ID: { section: 'login', label: 'LINE Login Channel ID', type: 'channel' },
  LINE_LIFF_ID: { section: 'login', label: 'LIFF ID', type: 'liff' },
  LINE_MESSAGING_MODE: { section: 'messaging', label: 'Messaging API', type: 'enum', options: ['disabled', 'mock', 'real'] },
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: { section: 'messaging', label: 'Messaging Channel Access Token', type: 'secret' },
  LINE_CHANNEL_SECRET: { section: 'messaging', label: 'Channel Secret (ตัวสำรองสำหรับ Webhook ตามระบบเดิม)', type: 'secret' },
  LINE_WEBHOOK_ENABLED: { section: 'messaging', label: 'เปิด Webhook', type: 'boolean', default: 'true' },
  LINE_WEBHOOK_SECRET: { section: 'messaging', label: 'Messaging/Webhook Signing Secret', type: 'secret' },
};
module.exports = { fields };
