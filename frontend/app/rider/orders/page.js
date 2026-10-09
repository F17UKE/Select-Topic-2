'use client';
import { staffErrorMessage } from '../../../lib/staff-portal.mjs';

import { RiderJobCard } from '../../../components/rider-job-card';
import { useEffect, useState } from 'react';
import { LoadingCards } from '../../../components/app-shell';
import { Icon } from '../../../components/icons';
import { RiderShell, RiderSignIn } from '../../../components/rider-shell';
import { api } from '../../../lib/api';
import { useMerchantStaff } from '../../../lib/use-merchant-staff';

export default function RiderOrdersPage() {
  const session = useMerchantStaff();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const visibleOrders = orders.filter((order) => filter === 'ALL' || order.status === filter);
  useEffect(() => {
    if (session.staff?.role !== 'RIDER') return;
    let active = true;
    api('/api/rider/orders').then((result) => { if (active) setOrders(result.orders); })
      .catch((requestError) => { if (active) setError(staffErrorMessage(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.staff]);
  if (session.loading) return <RiderShell session={session} title="เข้าสู่ระบบไรเดอร์" showNav={false}><LoadingCards /></RiderShell>;
  if (!session.staff || session.staff.role !== 'RIDER') return <RiderShell session={session} title="เข้าสู่ระบบไรเดอร์" showNav={false}><RiderSignIn session={session} /></RiderShell>;
  return <RiderShell session={session} title="งานของฉัน" backHref="/rider">
    <div className="rider-page-heading"><h1>งานที่กำลังดำเนินการ</h1><p>{session.staff.store_name} · {orders.length} งาน</p></div>
    <div className="portal-filters" role="group" aria-label="กรองงาน">{[['ALL', 'ทั้งหมด'], ['READY', 'พร้อมส่ง'], ['DELIVERING', 'กำลังส่ง']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    {loading ? <LoadingCards /> : error ? <p className="form-error">{error}</p> : visibleOrders.length === 0 ? <section className="rider-empty"><span><Icon name="scooter" size={31} /></span><h2>ยังไม่มีงานที่ได้รับมอบหมาย</h2><p>งานใหม่จากร้านจะปรากฏที่นี่</p></section> : <div className="rider-order-list">{visibleOrders.map((order) => <RiderJobCard key={order.id} order={order} storeName={session.staff.store_name} />)}</div>}
  </RiderShell>;
}
