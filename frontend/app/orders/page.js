'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../components/app-shell';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { OrderListCard } from '../../components/customer/order-list-card';
import { Icon } from '../../components/icons';
import { api } from '../../lib/api';
import { useCustomer } from '../../lib/use-customer';

export default function OrdersPage() {
  const session = useCustomer();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!session.customer) return;
    let active = true;
    api('/api/orders').then((result) => { if (active) setOrders(result.orders); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.customer]);

  const detailHeader = <CustomerDetailHeader title="ออเดอร์ของฉัน" backHref="/" />;
  if (session.loading || (session.customer && loading)) return <AppShell variant="orders" header={detailHeader}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell variant="orders" header={detailHeader}><SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} /></AppShell>;
  return (
    <AppShell variant="orders" header={detailHeader}>
      <section className="orders-heading"><h1>ออเดอร์ล่าสุด</h1><span>{orders.length} ออเดอร์</span></section>
      {error && <p className="form-error">{error}</p>}
      <div className="order-list">
        {orders.map((order) => <OrderListCard order={order} key={order.id} />)}
        {!orders.length && !error && <section className="empty-state orders-empty"><span><Icon name="receipt" size={38} /></span><h1>ยังไม่มีออเดอร์</h1><p>ออเดอร์ที่สร้างแล้วจะแสดงที่นี่</p><Link className="primary-button inline-link" href="/">เลือกอาหาร</Link></section>}
      </div>
    </AppShell>
  );
}
