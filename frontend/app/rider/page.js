'use client';

import { RiderJobCard } from '../../components/rider-job-card';
import { staffErrorMessage } from '../../lib/staff-portal.mjs';
import { useEffect, useState } from 'react';
import { LoadingCards } from '../../components/app-shell';
import { Icon } from '../../components/icons';
import { RiderShell, RiderSignIn } from '../../components/rider-shell';
import { api } from '../../lib/api';
import { useMerchantStaff } from '../../lib/use-merchant-staff';

export default function RiderPage() {
  const session = useMerchantStaff();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (session.staff?.role !== 'RIDER') return;
    let active = true;
    api('/api/rider/orders').then((result) => { if (active) setOrders(result.orders); }).catch((failure) => { if (active) setError(staffErrorMessage(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.staff]);
  if (session.loading) return <RiderShell session={session} title="เข้าสู่ระบบไรเดอร์" showNav={false}><LoadingCards /></RiderShell>;
  if (!session.staff || session.staff.role !== 'RIDER') return <RiderShell session={session} title="เข้าสู่ระบบไรเดอร์" showNav={false}><RiderSignIn session={session} /></RiderShell>;
  const readyCount = orders.filter((order) => order.status === 'READY').length;
  const deliveringCount = orders.filter((order) => order.status === 'DELIVERING').length;
  return <RiderShell session={session} title="งานของฉัน">
    <section className="rider-hero"><div><p>สวัสดี, {session.staff.full_name}</p><h1>{session.staff.store_name}</h1></div></section>
    <section className="rider-summary"><article><span>รอเริ่มจัดส่ง</span><strong>{readyCount}</strong></article><article><span>กำลังจัดส่ง</span><strong>{deliveringCount}</strong></article></section>
    {loading ? <LoadingCards /> : error ? <p role="alert" className="form-error">{error}</p> : orders.length ? <div className="rider-order-list">{orders.map((order) => <RiderJobCard key={order.id} order={order} storeName={session.staff.store_name} />)}</div> : <section className="rider-empty"><span><Icon name="scooter" size={31} /></span><h2>ยังไม่มีงานที่ได้รับมอบหมาย</h2><p>งานใหม่จากร้านจะปรากฏที่นี่</p></section>}
    <button className="rider-logout" type="button" onClick={session.logout}>ออกจากระบบ</button>
  </RiderShell>;
}
