// Only reviewed, user-facing copy may leave this boundary, never provider messages.
export function customerErrorMessage(error) {
  if (error?.status === 401) return 'กรุณาเข้าสู่ระบบอีกครั้ง';
  if (error?.status === 403) return 'คุณไม่มีสิทธิ์ดำเนินการนี้';
  if (error?.status === 404) return 'ไม่พบข้อมูลที่ต้องการ';
  const code = error?.body?.error || error?.body?.code;
  const messages = {
    authentication_required: 'กรุณาเข้าสู่ระบบอีกครั้ง',
    invalid_request: 'กรุณาตรวจสอบข้อมูลที่กรอกแล้วลองอีกครั้ง',
    review_already_exists: 'คุณรีวิวออเดอร์นี้แล้ว',
    review_not_allowed: 'ยังไม่สามารถรีวิวออเดอร์นี้ได้',
  };
  return Object.hasOwn(messages, code) ? messages[code] : 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}
