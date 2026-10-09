// Presentation only: retain the backend's per-field resolver and webhook precedence.
export function channelSecretField(fields) {
  const canonical = fields.find((field) => field.name === 'LINE_WEBHOOK_SECRET');
  const legacy = fields.find((field) => field.name === 'LINE_CHANNEL_SECRET');
  return { ...(canonical?.configured ? canonical : legacy?.configured ? legacy : canonical), label: 'Channel Secret', editName: 'LINE_WEBHOOK_SECRET' };
}

export function integrationState(data, section, verified, authMode) {
  const status = data.status[section] || {};
  const configured = status.configuration === 'READY';
  const value = (name) => data.fields.find((field) => field.name === name)?.value;
  const configuration = configured ? 'ตั้งค่าแล้ว' : 'ยังตั้งค่าไม่ครบ';
  if (section === 'payment') return { configuration, activity: status.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน', verification: 'ยังไม่ได้ทดสอบจริง' };
  if (section === 'easyslip') return { configuration, activity: status.enabled ? 'ผู้ตรวจสอบสลิปที่เลือก' : 'ยังไม่ได้เลือกใช้งาน', verification: verified ? 'บัญชี API ตรวจสอบแล้ว' : 'ยังไม่ได้ตรวจสอบบัญชี' };
  const https = section === 'login' ? data.liff_endpoint : data.webhook_url;
  const unknown = section === 'login' && !authMode;
  const enabled = section === 'login' ? status.enabled && authMode === 'line' : value('LINE_MESSAGING_MODE') === 'real';
  return { configuration, activity: !https ? 'รอ HTTPS' : unknown ? 'ตรวจสอบสถานะไม่ได้' : enabled && configured ? 'เปิดใช้งาน' : 'ยังไม่ได้เปิดใช้งาน', verification: 'ยังไม่ได้ทดสอบจริง' };
}

export function settingLabel(field) {
  return ({ PAYMENT_INTEGRATION_ENABLED: 'การรับชำระเงิน', PAYMENT_VERIFICATION_MODE: 'ผู้ตรวจสอบสลิป',
    EASYSLIP_API_KEY: 'API Key', LINE_LOGIN_ENABLED: 'LINE Login', LINE_CHANNEL_ID: 'LINE Login Channel ID',
    LINE_LIFF_ID: 'LIFF ID', LINE_MESSAGING_MODE: 'Messaging API', LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'Channel Access Token',
    LINE_WEBHOOK_SECRET: 'Channel Secret', LINE_WEBHOOK_ENABLED: 'Webhook', PLATFORM_PROMPTPAY_ID: 'หมายเลข PromptPay',
    PLATFORM_PROMPTPAY_ENABLED: 'เก็บการตั้งค่า PromptPay', PLATFORM_PROMPTPAY_NAME: 'ชื่อแสดง', PLATFORM_PROMPTPAY_TYPE: 'ประเภท PromptPay' })[field.name] || field.label;
}

export function settingValue(value) {
  return ({ true: 'เปิด', false: 'ปิด', disabled: 'ปิดใช้งาน', real: 'ใช้งานจริง', mock: 'Mock · ทดสอบภายใน',
    easyslip: 'EasySlip', checkslip: 'CheckSlip' })[value] || value || 'ยังไม่ได้ตั้งค่า';
}
