// Presentation-only grouping: every server-provided field is retained exactly once.
export function adminDetailSections(data, entity) {
  // Routers wrap the business record in { ok, merchant/customer/order/payment }.
  // Transport success flags are not a detail section.
  const kind = entity || ['order', 'payment'].find((key) => data[key] && typeof data[key] === 'object');
  const rest = { ...(kind && data[kind] ? data[kind] : data) };
  const sections = [];
  const take = (key, matches) => {
    const value = {};
    for (const name of Object.keys(rest)) if (matches(name, rest[name])) { value[name] = rest[name]; delete rest[name]; }
    if (Object.keys(value).length) sections.push({ key, value });
  };
  take('overview', (key) => ['order_code', 'store_name', 'display_name', 'full_name', 'phone', 'location_text', 'is_active', 'is_open', 'promptpay_id', 'promptpay_identifier_type', 'line_linked', 'customer_name', 'status', 'payment_status', 'verification_status', 'order_type', 'fulfillment_type', 'method', 'provider', 'rider_name', 'reject_reason'].includes(key));
  take('amounts', (key) => /amount|^delivery_fee$|^transaction_reference$/.test(key));
  take('delivery', (key, value) => /^delivery_/.test(key) && (value === null || typeof value !== 'object'));
  take('timestamps', (key) => /_at$/.test(key));
  for (const key of Object.keys(rest)) if (rest[key] && typeof rest[key] === 'object') {
    if (kind === 'merchant' && key === 'staff' && Array.isArray(rest[key])) {
      sections.push({ key: 'staff', value: rest[key].filter((person) => person.role !== 'RIDER') });
      sections.push({ key: 'riders', value: rest[key].filter((person) => person.role === 'RIDER') });
    } else sections.push({ key, value: rest[key] });
    delete rest[key];
  }
  if (Object.keys(rest).length) sections.push({ key: 'technical', value: rest });
  return sections;
}

export function adminStatusLabel(value) {
  const labels = { open: 'เปิดรับออเดอร์', closed: 'ปิดรับออเดอร์', active: 'เปิดใช้งาน', suspended: 'ระงับ', name: 'ชื่อร้าน', oldest: 'เก่าสุด', PENDING: 'รอดำเนินการ', ACCEPTED: 'รับแล้ว', PREPARING: 'กำลังเตรียม', READY: 'พร้อมส่ง', DELIVERING: 'กำลังจัดส่ง', COMPLETED: 'สำเร็จ', REJECTED: 'ปฏิเสธ', CANCELLED: 'ยกเลิก', PAID: 'ชำระแล้ว', UNPAID: 'ยังไม่ชำระ', PENDING_VERIFICATION: 'รอตรวจสอบ', FAILED: 'ไม่สำเร็จ', ERROR: 'ขัดข้อง', PUBLISHED: 'เผยแพร่', DRAFT: 'ฉบับร่าง', HIDDEN: 'ซ่อน', EXPIRED: 'หมดอายุ' };
  return labels[value] || value;
}
