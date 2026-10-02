'use client';

import Link from 'next/link';
import { LoadingCards } from '../../components/app-shell';
import { Icon } from '../../components/icons';
import { MerchantShell, MerchantSignIn } from '../../components/merchant-shell';
import { useMerchantStaff } from '../../lib/use-merchant-staff';

export default function MerchantPage() {
  const session = useMerchantStaff();
  if (session.loading) return <MerchantShell title="เข้าสู่ระบบร้านค้า" showNav={false}><LoadingCards /></MerchantShell>;
  if (!session.staff) return <MerchantShell title="เข้าสู่ระบบร้านค้า" showNav={false}><MerchantSignIn config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.login} /></MerchantShell>;
  return (
    <MerchantShell title={session.staff.store_name}>
      <section className="merchant-hero">
        <div><p>สวัสดี, {session.staff.full_name}</p><h1>{session.staff.store_name}</h1><small>จัดการหน้าร้านในบทบาท {session.staff.role}</small></div>
        <span>{session.staff.role}</span>
      </section>
      <section className="merchant-actions-grid">
        <Link href="/merchant/orders"><span><Icon name="receipt" /></span><div><strong>ออเดอร์</strong><p>ดูและจัดการคำสั่งซื้อ</p></div><Icon name="arrow" size={18} /></Link>
        <Link href="/merchant/kitchen"><span><Icon name="check" /></span><div><strong>ครัว</strong><p>จัดการรายการอาหารที่กำลังทำ</p></div><Icon name="arrow" size={18} /></Link>
      </section>
      <button className="merchant-logout" type="button" onClick={session.logout}>ออกจากระบบ</button>
    </MerchantShell>
  );
}
