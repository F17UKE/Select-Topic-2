export function financeBaht(value = '0') {
  const n = BigInt(value), negative = n < 0n, abs = negative ? -n : n;
  return `${negative ? '-' : ''}฿${(abs / 100n).toLocaleString('th-TH')}.${String(abs % 100n).padStart(2, '0')}`;
}
export function inputSatang(value) {
  const m = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw new Error('กรุณากรอกจำนวนเงินไม่เกิน 2 ตำแหน่งทศนิยม');
  return String(BigInt(m[1]) * 100n + BigInt((m[2] || '').padEnd(2, '0')));
}
export function remainingWindow(value, now = Date.now()) {
  const minutes=Math.max(0,Math.ceil((new Date(value).valueOf()-now)/60000));
  if(!minutes)return 'ครบช่วงพักแล้ว · ยังต้องผ่านเงื่อนไขบัญชีและยอดพร้อมถอน';
  return `เหลือประมาณ ${Math.floor(minutes/60)} ชั่วโมง ${minutes%60} นาที`;
}
export const financeLabels = {
  PAID_OUT: 'โอนให้ร้านแล้ว', PENDING: 'รอส่งสำเร็จ', AVAILABLE: 'พร้อมถอน', RESERVED: 'สำรองเพื่อถอน', HELD: 'รอตรวจสอบ', DEBT: 'ยอดรอหักจากรายได้',
  REQUESTED: 'รอตรวจสอบ', APPROVED: 'อนุมัติแล้ว', PROCESSING: 'กำลังโอน', PAID: 'โอนสำเร็จ', FAILED: 'ไม่สำเร็จ', REJECTED: 'ปฏิเสธ', CANCELLED: 'ยกเลิก',
  PENDING_VERIFICATION: 'รอยืนยันบัญชี', VERIFIED: 'ยืนยันแล้ว', RETIRED: 'บัญชีเดิม',
  PAID_PENDING_REVIEW: 'ชำระแล้ว รออนุมัติโฆษณา', ACTIVE: 'กำลังแสดง', EXPIRED: 'ครบกำหนด', REJECTED_REFUNDED: 'ปฏิเสธและคืนยอด', TERMINATED: 'ยุติโดยแพลตฟอร์ม',
  ORDER_PAID: 'รับชำระออเดอร์', ORDER_COMPLETED: 'รายได้จากการส่งสำเร็จ', ORDER_HELD: 'พักยอดออเดอร์',
  WITHDRAWAL_RESERVE: 'สำรองยอดถอน', WITHDRAWAL_RELEASE: 'คืนยอดสำรอง', WITHDRAWAL_PAID: 'โอนให้ร้านแล้ว',
  REFUND_RECOGNIZE: 'บันทึกการคืนเงิน', REFUND_PAID: 'โอนคืนลูกค้าแล้ว', AD_PURCHASE: 'ชำระค่าโฆษณา', AD_EARN: 'รับรู้รายได้โฆษณา', AD_REFUND: 'คืนค่าโฆษณา',
};
