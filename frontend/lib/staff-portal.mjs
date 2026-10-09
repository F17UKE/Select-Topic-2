// Presentation policy mirrors existing backend permissions; APIs remain authoritative.
export const staffHome = (role) => ({ MANAGER: '/merchant', CASHIER: '/merchant/orders', KITCHEN: '/merchant/kitchen', RIDER: '/rider' }[role] || '/merchant');
export function staffRouteRedirect(role, path) {
  if (role === 'RIDER') return path === '/rider' || path.startsWith('/rider/') ? null : '/rider';
  if (path === '/rider' || path.startsWith('/rider/')) return staffHome(role);
  if (role === 'KITCHEN' && !(/^\/merchant\/(kitchen|orders\/[^/]+|menu(?:\/[^/]+)?)$/.test(path))) return '/merchant/kitchen';
  return null;
}
export function merchantNavigation(role) {
  if (!['MANAGER', 'CASHIER', 'KITCHEN'].includes(role)) return [];
  const items = [
    ['', 'ภาพรวม', 'home', ['MANAGER', 'CASHIER']],
    ['orders', 'ออเดอร์', 'receipt', ['MANAGER', 'CASHIER']],
    ['kitchen', 'ครัว', 'check', ['MANAGER', 'CASHIER', 'KITCHEN']],
    ['menu', 'เมนู', 'receipt', ['MANAGER', 'CASHIER', 'KITCHEN']],
    ['categories', 'หมวดหมู่'], ['store', 'ร้าน / ตั้งค่า'], ['staff', 'พนักงาน'], ['riders', 'ไรเดอร์'],
    ['promotions', 'โปรโมชัน'], ['delivery-fees', 'ค่าส่ง'], ['banners', 'แบนเนอร์'],
    ['finance', 'การเงิน'],
    ['history', 'ประวัติ', 'receipt', ['MANAGER', 'CASHIER']],
    ['reports', 'รายงาน', 'receipt', ['MANAGER', 'CASHIER']],
    ['reviews', 'รีวิว', 'receipt', ['MANAGER', 'CASHIER']],
  ];
  return items.filter(([, , , roles = ['MANAGER']]) => roles.includes(role))
    .map(([path, label, icon = 'receipt']) => ({ href: `/merchant${path ? `/${path}` : ''}`, label, icon }));
}
export const orderFilters = [
  ['all', 'ทั้งหมด', []], ['new', 'ใหม่', ['PENDING']], ['preparing', 'กำลังทำ', ['ACCEPTED', 'PREPARING']],
  ['ready', 'พร้อมจัดส่ง', ['READY']], ['delivering', 'กำลังส่ง', ['DELIVERING']],
  ['completed', 'สำเร็จ', ['COMPLETED']], ['cancelled', 'ยกเลิก', ['CANCELLED', 'REJECTED']],
];
export function staffErrorMessage(error) {
  const code = error?.body?.error;
  const messages = {
    payment_required: 'รอชำระเงินก่อนรับออเดอร์', items_incomplete: 'กรุณาทำอาหารให้ครบก่อนกดพร้อมจัดส่ง',
    rider_assignment_conflict: 'มีไรเดอร์รับงานนี้แล้ว กรุณาตรวจสอบสถานะล่าสุด',
    invalid_staff_credentials: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', staff_login_rate_limited: 'ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่',
  };
  if (messages[code]) return messages[code];
  if (error?.status === 401) return 'กรุณาเข้าสู่ระบบอีกครั้ง';
  if (error?.status === 403) return 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการนี้';
  if (error?.status === 404) return 'ไม่พบข้อมูลที่คุณมีสิทธิ์เข้าถึง';
  if (error?.status === 409) return 'สถานะรายการเปลี่ยนไปแล้ว กรุณาตรวจสอบอีกครั้ง';
  return 'ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง';
}
