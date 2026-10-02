'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LoadingCards } from '../../components/app-shell';
import { Icon } from '../../components/icons';
import { RiderShell, RiderSignIn } from '../../components/rider-shell';
import { api } from '../../lib/api';
import { useMerchantStaff } from '../../lib/use-merchant-staff';

export default function RiderPage() {
  const session = useMerchantStaff();
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    if (session.staff?.role !== 'RIDER') return;
    let active = true;
    api('/api/rider/orders').then((result) => { if (active) setOrders(result.orders); }).catch(() => {});
    return () => { active = false; };
  }, [session.staff]);
  if (session.loading) return <RiderShell title="เข้าสู่ระบบไรเดอร์" showNav={false}><LoadingCards /></RiderShell>;
  if (!session.staff || session.staff.role !== 'RIDER') return <RiderShell title="เข้าสู่ระบบไรเดอร์" showNav={false}><RiderSignIn session={session} /></RiderShell>;
  const readyCount = orders.filter((order) => order.status === 'READY').length;
  const deliveringCount = orders.filter((order) => order.status === 'DELIVERING').length;
  return <RiderShell title="งานของฉัน">
    <section className="rider-hero"><div><p>สวัสดี, {session.staff.full_name}</p><h1>{session.staff.store_name}</h1></div><span>RIDER</span></section>
    <section className="rider-summary"><article><span>กำลังรอรับงาน</span><strong>{readyCount}</strong></article><article><span>กำลังจัดส่ง</span><strong>{deliveringCount}</strong></article></section>
    {orders.length ? <Link className="rider-job-link" href="/rider/orders"><span><Icon name="scooter" /></span><div><strong>ดูงานที่ได้รับมอบหมาย</strong><small>{orders.length} งานที่กำลังดำเนินการ</small></div><Icon name="arrow" size={20} /></Link> : <section className="rider-empty"><span><Icon name="scooter" size={31} /></span><h2>ยังไม่มีงานที่ได้รับมอบหมาย</h2><p>งานใหม่จากร้านจะปรากฏที่นี่</p></section>}
    <button className="rider-logout" type="button" onClick={session.logout}>ออกจากระบบ</button>
  </RiderShell>;
}
