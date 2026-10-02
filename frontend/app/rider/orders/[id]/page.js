'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoadingCards } from '../../../../components/app-shell';
import { Icon } from '../../../../components/icons';
import { RiderShell, RiderSignIn } from '../../../../components/rider-shell';
import { api } from '../../../../lib/api';
import { staffOrderStatusLabel } from '../../../../lib/staff-presentation.mjs';
import { useMerchantStaff } from '../../../../lib/use-merchant-staff';

export default function RiderOrderDetailPage() {
  const { id } = useParams();
  const session = useMerchantStaff();
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (session.staff?.role !== 'RIDER') return;
    let active = true;
    api(`/api/rider/orders/${id}`).then((result) => { if (active) setOrder(result.order); })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [id, session.staff]);
  async function transition(action) {
    setBusy(true);
    setError('');
    try {
      const result = await api(`/api/rider/orders/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      setOrder(result.order);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  if (session.loading || (session.staff?.role === 'RIDER' && !order && !error)) return <RiderShell title="รายละเอียดงาน" showNav={false}><LoadingCards /></RiderShell>;
  if (!session.staff || session.staff.role !== 'RIDER') return <RiderShell title="เข้าสู่ระบบไรเดอร์" showNav={false}><RiderSignIn session={session} /></RiderShell>;
  if (!order) return <RiderShell title="รายละเอียดงาน" backHref="/rider/orders"><section className="rider-empty"><h2>ไม่พบงาน</h2><p>{error}</p></section></RiderShell>;
  const phone = order.delivery?.contact_phone;
  return <RiderShell title={order.order_code} backHref="/rider/orders">
    <section className="rider-order-hero"><div><span>{order.order_code}</span><h1>{staffOrderStatusLabel(order.status)}</h1><p>{session.staff.store_name}</p></div><span className={`rider-state state-${order.status.toLowerCase()}`}>{staffOrderStatusLabel(order.status)}</span></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="rider-panel"><div className="rider-panel-heading"><span><Icon name="map" size={20} /></span><h2>จุดส่ง</h2></div><h3>{order.delivery?.label} · {order.delivery?.dormitory_name}</h3><p>{order.delivery?.soi_name} · ห้อง {order.delivery?.room_number}</p><p className="snapshot-lines">{order.delivery?.location_text}</p></section>
    <section className="rider-panel"><div className="rider-panel-heading"><span><Icon name="user" size={20} /></span><h2>ติดต่อ</h2></div><h3>{order.customer_name}</h3>{phone && <a className="rider-call" href={`tel:${phone}`}><Icon name="phone" />โทรหาลูกค้า · {phone}</a>}{order.delivery_note && <div className="rider-note"><span>หมายเหตุถึงคนส่ง</span><p>{order.delivery_note}</p></div>}</section>
    <section className="rider-panel"><div className="rider-panel-heading"><span><Icon name="receipt" size={20} /></span><h2>รายการอาหาร</h2></div><ul className="rider-items">{order.items.map((item) => <li key={item.id}><strong>{item.quantity} ×</strong><span>{item.item_name}</span></li>)}</ul></section>
    {order.status === 'READY' && <button className="rider-primary rider-action" type="button" disabled={busy} onClick={() => transition('start-delivery')}>เริ่มจัดส่ง</button>}
    {order.status === 'DELIVERING' && <button className="rider-primary rider-action" type="button" disabled={busy} onClick={() => transition('complete')}>ส่งสำเร็จ</button>}
    {order.status === 'COMPLETED' && <div className="rider-completed">✓ งานนี้เสร็จสมบูรณ์</div>}
  </RiderShell>;
}
