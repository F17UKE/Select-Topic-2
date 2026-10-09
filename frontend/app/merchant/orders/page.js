'use client';
import { staffErrorMessage, orderFilters } from '../../../lib/staff-portal.mjs';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoadingCards } from '../../../components/app-shell';
import { MerchantShell, MerchantSignIn } from '../../../components/merchant-shell';
import { api, baht } from '../../../lib/api';
import {
  formatStaffDate,
  staffOrderStatusLabel,
  staffPaymentStatusLabel,
} from '../../../lib/staff-presentation.mjs';
import { useMerchantStaff } from '../../../lib/use-merchant-staff';

export default function MerchantOrdersPage() {
  return <Suspense fallback={<LoadingCards />}><MerchantOrdersContent /></Suspense>;
}
function MerchantOrdersContent() {
  const session = useMerchantStaff();
  const query = useSearchParams();
  const [filter, setFilter] = useState(query.get('filter') || 'all');
  const states = (orderFilters.find(([key]) => key === filter) || orderFilters[0])[2];
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!session.staff) return;
    api('/api/merchant/orders')
      .then((result) => setOrders(result.orders))
      .catch((requestError) => setError(staffErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [session.staff]);
  if (session.loading)
    return (
      <MerchantShell session={session} staff={session.staff} title="ออเดอร์" showNav={false}>
        <LoadingCards />
      </MerchantShell>
    );
  if (!session.staff)
    return (
      <MerchantShell session={session} staff={session.staff} title="เข้าสู่ระบบร้านค้า" showNav={false}>
        <MerchantSignIn
          config={session.authConfig}
          loading={session.loading}
          error={session.error}
          onLogin={session.login}
        />
      </MerchantShell>
    );
  const visibleOrders = orders.filter((order) => !states.length || states.includes(order.status));
  return (
    <MerchantShell session={session} staff={session.staff} title="ออเดอร์ทั้งหมด" backHref="/merchant">
      <div className="merchant-page-heading">
        <div>
          <h1>ออเดอร์ทั้งหมด</h1>
          <p>
            {session.staff.store_name}
          </p>
        </div>
        <span>{orders.length} ออเดอร์</span>
      </div>
      <div className="portal-filters" role="group" aria-label="กรองสถานะออเดอร์">{orderFilters.map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
      {loading ? (
        <LoadingCards />
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : visibleOrders.length === 0 ? (
        <section className="merchant-empty">
          <span>0</span>
          <h2>ไม่พบออเดอร์ในสถานะนี้</h2>
          <p>ออเดอร์ใหม่ของร้านจะแสดงที่นี่</p>
        </section>
      ) : (
        <div className="merchant-order-list">
          {visibleOrders.map((order) => (
            <Link href={`/merchant/orders/${order.id}`} key={order.id} className="merchant-order-card">
              <div className="merchant-order-main">
                <div className="merchant-order-code">
                  <span>{order.order_code}</span>
                  <span className={`merchant-state state-${order.status.toLowerCase()}`}>
                    {staffOrderStatusLabel(order.status)}
                  </span>
                </div>
                <h2>{order.customer?.display_name || 'ออเดอร์ในครัว'}</h2>
                <p>{order.items.map((item) => `${item.quantity} × ${item.item_name}`).join(' · ')}</p>
                <small>{formatStaffDate(order.created_at)}</small>
              </div>
              <div className="merchant-order-side">
                <b className={order.payment_status === 'PAID' ? 'paid-text' : 'waiting-text'}>
                  {staffPaymentStatusLabel(order.payment_status)}
                </b>
                {order.total_amount !== undefined && <strong>{baht(order.total_amount)}</strong>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </MerchantShell>
  );
}
