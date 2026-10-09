'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAdmin } from '../lib/use-admin';
import { AdminDialog, AdminIcon, useAdminDialogBackdrop } from './admin-ui';

const navigation = [
  ['/admin', 'ภาพรวม', 'grid', 'ภาพรวม'],
  ['/admin/merchants', 'ร้านค้า', 'store', 'การดำเนินงาน'], ['/admin/customers', 'ลูกค้า', 'users', 'การดำเนินงาน'],
  ['/admin/orders', 'ออเดอร์', 'receipt', 'การดำเนินงาน'], ['/admin/payments', 'การชำระเงิน', 'money', 'การดำเนินงาน'], ['/admin/delivery-areas', 'พื้นที่จัดส่ง', 'pin', 'การดำเนินงาน'],
  ['/admin/banners', 'แบนเนอร์', 'image', 'การตลาด'], ['/admin/promotions', 'โปรโมชัน', 'ticket', 'การตลาด'], ['/admin/coupons', 'คูปอง', 'ticket', 'การตลาด'], ['/admin/reviews', 'รีวิว', 'star', 'การตลาด'],
  ['/admin/reports', 'รายงาน', 'chart', 'รายงาน'],
  ['/admin/finance', 'การเงิน', 'money', 'รายงาน'],
  ['/admin/users', 'ผู้ดูแลระบบ', 'shield', 'ระบบ'], ['/admin/audit-logs', 'ประวัติการดำเนินการ', 'receipt', 'ระบบ'], ['/admin/system-status', 'สถานะระบบ', 'activity', 'ระบบ'],
  ['/admin/settings', 'ตั้งค่าทั่วไป', 'settings', 'ระบบ'], ['/admin/settings/integrations', 'การเชื่อมต่อระบบ', 'link', 'ระบบ'],
];
const visibleRoles = {
  '/admin/finance': ['SUPER_ADMIN', 'FINANCE'],
  '/admin/settings/integrations': ['SUPER_ADMIN'],
  '/admin/merchants': ['SUPER_ADMIN','ADMIN','SUPPORT'], '/admin/customers': ['SUPER_ADMIN','ADMIN','SUPPORT'],
  '/admin/delivery-areas': ['SUPER_ADMIN','ADMIN'], '/admin/banners': ['SUPER_ADMIN','ADMIN'], '/admin/promotions': ['SUPER_ADMIN','ADMIN'], '/admin/coupons': ['SUPER_ADMIN','ADMIN'], '/admin/reviews': ['SUPER_ADMIN','ADMIN'],
  '/admin/reports': ['SUPER_ADMIN','ADMIN','FINANCE'], '/admin/users': ['SUPER_ADMIN'],
  '/admin/audit-logs': ['SUPER_ADMIN','ADMIN','SUPPORT'], '/admin/system-status': ['SUPER_ADMIN','ADMIN'], '/admin/settings': ['SUPER_ADMIN'],
};

export function AdminShell({ title, description, actions, children }) {
  useAdminDialogBackdrop();
  const pathname = usePathname();
  const router = useRouter();
  const session = useAdmin();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { if (!session.loading && !session.admin) router.replace('/admin/login'); }, [session.loading, session.admin, router]);
  if (session.loading) return <main className="admin-loading" role="status">กำลังตรวจสอบ Admin session…</main>;
  if (!session.admin) return null;
  const allowed = navigation.filter(([href]) => !visibleRoles[href] || visibleRoles[href].includes(session.admin.role));
  const current = allowed.filter(([href]) => pathname === href || href !== '/admin' && pathname.startsWith(`${href}/`)).at(-1);
  const menu = <><Link href="/admin" className="admin-brand"><span>ST</span><div><strong>Select Topic 2</strong><small>Platform Admin</small></div></Link>
    <nav aria-label="เมนูผู้ดูแลระบบ">{[...new Set(allowed.map((item) => item[3]))].map((group) => <div className="admin-nav-group" key={group}><p>{group}</p>{allowed.filter((item) => item[3] === group).map(([href, label, icon]) => <Link key={href} href={href} title={label} aria-current={current?.[0] === href ? 'page' : undefined} className={current?.[0] === href ? 'active' : ''} onClick={() => setDrawer(false)}><AdminIcon name={icon} /><span>{label}</span></Link>)}</div>)}</nav>
    <div className="admin-sidebar-footer"><AdminIcon name="shield" /><span>พื้นที่สำหรับผู้ดูแลระบบ</span></div></>;
  return <div className={`admin-app${collapsed ? ' admin-collapsed' : ''}`}>
    <a className="admin-skip" href="#admin-content">ข้ามไปเนื้อหา</a>
    <aside className="admin-sidebar">{menu}</aside>
    {drawer && <AdminDialog title="เมนูผู้ดูแลระบบ" className="admin-nav-drawer" onClose={() => setDrawer(false)}>{menu}</AdminDialog>}
    <main className="admin-main">
      <div className="admin-contextbar"><div className="admin-context-start"><button type="button" className="admin-icon-button admin-desktop-toggle" aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><AdminIcon name="menu" /></button><button type="button" className="admin-icon-button admin-mobile-toggle" aria-label="เปิดเมนูผู้ดูแลระบบ" aria-expanded={drawer} onClick={() => setDrawer(true)}><AdminIcon name="menu" /></button><nav aria-label="เส้นทางหน้า"><Link href="/admin">หลังบ้าน</Link><span aria-hidden="true"> / </span><span>{current?.[1] || title}</span></nav></div><div className="admin-account"><span className="admin-avatar">{session.admin.full_name?.slice(0, 1)}</span><div><strong>{session.admin.full_name}</strong><small>{session.admin.role}</small></div><button className="admin-secondary" onClick={() => session.logout().then(() => router.replace('/admin/login'))}>ออกจากระบบ</button></div></div>
      <header className="admin-topbar"><div><p>PLATFORM MANAGEMENT</p><h1>{title}</h1>{description && <span>{description}</span>}</div>{actions && <div className="admin-actions">{actions}</div>}</header>
      <div className="admin-content" id="admin-content" tabIndex={-1}>{children}</div>
    </main>
  </div>;
}

export function AdminError({ children }) { return children ? <div role="alert" className="admin-alert danger">{children}</div> : null; }
export function AdminEmpty({ children = 'ไม่พบข้อมูล' }) { return <div className="admin-empty">{children}</div>; }
export function StatusBadge({ value }) {
  const safe = String(value || 'UNKNOWN').toUpperCase();
  const tone = /^(FAILED|REJECTED|SUSPENDED|INACTIVE|ERROR|CANCELLED|UNAVAILABLE)$/i.test(safe) ? 'bad'
    : /^(PAID|ACTIVE|OPEN|COMPLETED|PUBLISHED|OK|VERIFIED)$/i.test(safe) ? 'good' : 'warn';
  const labels = { PAID: 'ชำระแล้ว', UNPAID: 'ยังไม่ชำระ', PENDING: 'รอดำเนินการ', PENDING_VERIFICATION: 'รอตรวจสอบ', ACCEPTED: 'รับแล้ว', PREPARING: 'กำลังเตรียม', READY: 'พร้อม', DELIVERING: 'กำลังจัดส่ง', COMPLETED: 'สำเร็จ', REJECTED: 'ปฏิเสธ', CANCELLED: 'ยกเลิก', ACTIVE: 'เปิดใช้งาน', INACTIVE: 'ปิดใช้งาน', SUSPENDED: 'ระงับ', OPEN: 'เปิด', CLOSED: 'ปิด', PUBLISHED: 'เผยแพร่', DRAFT: 'ฉบับร่าง', HIDDEN: 'ซ่อน', SCHEDULED: 'ตั้งเวลา', UPCOMING: 'กำลังจะเริ่ม', ARCHIVED: 'เก็บถาวร', DISABLED: 'ปิดใช้งาน', EXPIRED: 'หมดอายุ', FAILED: 'ไม่สำเร็จ', ERROR: 'ขัดข้อง', OK: 'ปกติ', VERIFIED: 'ยืนยันแล้ว', UNKNOWN: 'ยังไม่มีข้อมูล', INCOMPLETE: 'ยังไม่ครบ', CONFIGURED: 'ตั้งค่าแล้ว', NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่า' };
  return <span className={`admin-badge ${tone}`} title={safe}>{labels[safe] || safe}</span>;
}
