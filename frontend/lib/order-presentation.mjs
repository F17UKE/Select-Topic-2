export const ORDER_STATUS_LABELS = {
  PENDING: 'รอร้านรับออเดอร์',
  ACCEPTED: 'ร้านรับออเดอร์แล้ว',
  PREPARING: 'กำลังเตรียมอาหาร',
  READY: 'อาหารพร้อมจัดส่ง',
  DELIVERING: 'กำลังจัดส่ง',
  COMPLETED: 'ส่งสำเร็จ',
  REJECTED: 'ร้านไม่รับออเดอร์',
  CANCELLED: 'ยกเลิกแล้ว',
};

export const PAYMENT_STATUS_LABELS = {
  UNPAID: 'ยังไม่ชำระ',
  PENDING: 'ยังไม่ชำระ',
  PENDING_VERIFICATION: 'กำลังตรวจสอบ',
  PROCESSING: 'กำลังตรวจสอบ',
  PAID: 'ชำระแล้ว',
  FAILED: 'ชำระไม่สำเร็จ',
  REJECTED: 'ชำระไม่สำเร็จ',
  ERROR: 'ตรวจสอบไม่สำเร็จ',
};

export function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status;
}

export function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || status;
}

export function statusClass(status) {
  return `status-${String(status || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
}

export function paymentStatusClass(status) {
  return `payment-${String(status || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
}

export function formatOrderDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const datePart = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
  return `${datePart} · ${timePart}`;
}

export function maskPaymentIdentifier(value) {
  const normalized = String(value || '').replace(/\s/g, '');
  if (!normalized) return '';
  return `${'*'.repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}`;
}
