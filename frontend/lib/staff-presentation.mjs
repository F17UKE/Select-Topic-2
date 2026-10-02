import { formatOrderDate } from './order-presentation.mjs';

export const STAFF_ORDER_STATUS_LABELS = {
  PENDING: 'รอรับออเดอร์',
  ACCEPTED: 'รับออเดอร์แล้ว',
  PREPARING: 'กำลังเตรียม',
  READY: 'พร้อมจัดส่ง',
  DELIVERING: 'กำลังจัดส่ง',
  COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก',
};

export const STAFF_PAYMENT_STATUS_LABELS = {
  UNPAID: 'ยังไม่ชำระ',
  PENDING: 'ยังไม่ชำระ',
  PENDING_VERIFICATION: 'กำลังตรวจสอบ',
  PROCESSING: 'กำลังตรวจสอบ',
  PAID: 'ชำระแล้ว',
  FAILED: 'ชำระไม่สำเร็จ',
  REJECTED: 'ชำระไม่สำเร็จ',
  ERROR: 'ตรวจสอบไม่สำเร็จ',
};

export function staffOrderStatusLabel(status) {
  return STAFF_ORDER_STATUS_LABELS[status] || status;
}

export function staffPaymentStatusLabel(status) {
  return STAFF_PAYMENT_STATUS_LABELS[status] || status;
}

export { formatOrderDate as formatStaffDate };
