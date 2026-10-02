'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LoadingCards } from '../../../components/app-shell';
import { Icon } from '../../../components/icons';
import { RiderShell, RiderSignIn } from '../../../components/rider-shell';
import { api } from '../../../lib/api';
import { staffOrderStatusLabel } from '../../../lib/staff-presentation.mjs';
import { useMerchantStaff } from '../../../lib/use-merchant-staff';

export default function RiderOrdersPage() {
  const session = useMerchantStaff();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (session.staff?.role !== 'RIDER') return;
    let active = true;
    api('/api/rider/orders').then((result) => { if (active) setOrders(result.orders); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.staff]);
  if (session.loading) return <RiderShell title="เข้าสู่ระบบไรเดอร์" showNav={false}><LoadingCards /></RiderShell>;
  if (!session.staff || session.staff.role !== 'RIDER') return <RiderShell title="เข้าสู่ระบบไรเดอร์" showNav={false}><RiderSignIn session={session} /></RiderShell>;
  return <RiderShell title="งานของฉัน" backHref="/rider">
    <div className="rider-page-heading"><h1>งานที่กำลังดำเนินการ</h1><p>{session.staff.store_name} · {orders.length} งาน</p></div>
    {loading ? <LoadingCards /> : error ? <p className="form-error">{error}</p> : orders.length === 0 ? <section className="rider-empty"><span><Icon name="scooter" size={31} /></span><h2>ยังไม่มีงานที่ได้รับมอบหมาย</h2><p>งานใหม่จากร้านจะปรากฏที่นี่</p></section> : <div className="rider-order-list">{orders.map((order) => <Link className="rider-order-card" href={`/rider/orders/${order.id}`} key={order.id}><div className="rider-order-card-heading"><div><span>{order.order_code}</span><strong>{session.staff.store_name}</strong></div><span className={`rider-state state-${order.status.toLowerCase()}`}>{staffOrderStatusLabel(order.status)}</span></div><div className="rider-destination"><Icon name="map" size={19} /><div><h2>{order.delivery?.label} · {order.delivery?.dormitory_name || 'รับที่ร้าน'}</h2><p>ห้อง {order.delivery?.room_number || '-'}</p></div></div>{order.delivery?.contact_phone && <span className="rider-card-phone"><Icon name="phone" size={16} />โทร {order.delivery.contact_phone}</span>}<small>{order.items.map((item) => `${item.quantity} × ${item.item_name}`).join(' · ')}</small></Link>)}</div>}
  </RiderShell>;
}
