'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LoadingCards } from '../../../components/app-shell';
import { MerchantShell, MerchantSignIn } from '../../../components/merchant-shell';
import { Icon } from '../../../components/icons';
import { api } from '../../../lib/api';
import { formatStaffDate, staffOrderStatusLabel } from '../../../lib/staff-presentation.mjs';
import { useMerchantStaff } from '../../../lib/use-merchant-staff';

export default function MerchantKitchenPage() {
  const session = useMerchantStaff();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!session.staff) return;
    api('/api/merchant/orders').then((result) => setOrders(result.orders.filter((order) => ['ACCEPTED', 'PREPARING', 'READY'].includes(order.status))))
      .catch((requestError) => setError(requestError.message));
  }, [session.staff]);
  if (session.loading) return <MerchantShell title="ครัว" showNav={false}><LoadingCards /></MerchantShell>;
  if (!session.staff) return <MerchantShell title="เข้าสู่ระบบร้านค้า" showNav={false}><MerchantSignIn config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.login} /></MerchantShell>;
  return (
    <MerchantShell title="ครัว" backHref="/merchant">
      <div className="merchant-page-heading kitchen-heading"><div><h1>คิวในครัว</h1><p>{session.staff.store_name} · {session.staff.role}</p></div><span>{orders.length} ออเดอร์</span></div>
      {error && <p className="form-error">{error}</p>}
      <div className="kitchen-grid">{orders.map((order) => {
        const completed = order.items.filter((item) => item.is_completed).length;
        return <Link href={`/merchant/orders/${order.id}`} key={order.id} className="kitchen-ticket"><div className="kitchen-ticket-heading"><div><span>{order.order_code}</span><h2>{staffOrderStatusLabel(order.status)}</h2><small>{formatStaffDate(order.created_at)}</small></div><strong>{completed}/{order.items.length}</strong></div><ul>{order.items.map((item) => <li className={item.is_completed ? 'done' : ''} key={item.id}><span>{item.is_completed ? <Icon name="check" size={15} /> : null}</span><div><strong>{item.quantity} × {item.item_name}</strong>{item.note && <small>หมายเหตุ: {item.note}</small>}</div></li>)}</ul></Link>;
      })}</div>
      {!error && orders.length === 0 && <section className="merchant-empty kitchen-empty"><span><Icon name="check" size={30} /></span><h2>ยังไม่มีออเดอร์ในครัว</h2><p>ออเดอร์ที่เริ่มเตรียมอาหารแล้วจะปรากฏที่นี่</p></section>}
    </MerchantShell>
  );
}
