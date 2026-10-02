'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LoadingCards } from '../../../components/app-shell';
import { MerchantShell, MerchantSignIn } from '../../../components/merchant-shell';
import { api, baht } from '../../../lib/api';
import { formatStaffDate, staffOrderStatusLabel, staffPaymentStatusLabel } from '../../../lib/staff-presentation.mjs';
import { useMerchantStaff } from '../../../lib/use-merchant-staff';

export default function MerchantOrdersPage() {
  const session = useMerchantStaff();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!session.staff) return;
    api('/api/merchant/orders').then((result) => setOrders(result.orders))
      .catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, [session.staff]);
  if (session.loading) return <MerchantShell title="ออเดอร์" showNav={false}><LoadingCards /></MerchantShell>;
  if (!session.staff) return <MerchantShell title="เข้าสู่ระบบร้านค้า" showNav={false}><MerchantSignIn config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.login} /></MerchantShell>;
  return (
    <MerchantShell title="ออเดอร์ทั้งหมด" backHref="/merchant">
      <div className="merchant-page-heading"><div><h1>ออเดอร์ทั้งหมด</h1><p>{session.staff.store_name} · {session.staff.role}</p></div><span>{orders.length} ออเดอร์</span></div>
      {loading ? <LoadingCards /> : error ? <p className="form-error">{error}</p> : orders.length === 0 ? <section className="merchant-empty"><span>0</span><h2>ยังไม่มีออเดอร์</h2><p>ออเดอร์ใหม่ของร้านจะแสดงที่นี่</p></section> : (
        <div className="merchant-order-list">{orders.map((order) => <Link href={`/merchant/orders/${order.id}`} key={order.id} className="merchant-order-card">
          <div className="merchant-order-main"><div className="merchant-order-code"><span>{order.order_code}</span><span className={`merchant-state state-${order.status.toLowerCase()}`}>{staffOrderStatusLabel(order.status)}</span></div><h2>{order.customer?.display_name || 'ออเดอร์ในครัว'}</h2><p>{order.items.map((item) => `${item.quantity} × ${item.item_name}`).join(' · ')}</p><small>{formatStaffDate(order.created_at)}</small></div>
          <div className="merchant-order-side"><b className={order.payment_status === 'PAID' ? 'paid-text' : 'waiting-text'}>{staffPaymentStatusLabel(order.payment_status)}</b>{order.total_amount !== undefined && <strong>{baht(order.total_amount)}</strong>}</div>
        </Link>)}</div>
      )}
    </MerchantShell>
  );
}
