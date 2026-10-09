'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, baht } from '../lib/api';
import { staffOrderStatusLabel } from '../lib/staff-presentation.mjs';
import { staffErrorMessage } from '../lib/staff-portal.mjs';
import { useMerchantStaff } from '../lib/use-merchant-staff';
import { MerchantShell, MerchantSignIn } from './merchant-shell';
import { LoadingCards } from './app-shell';
export const managementApi = (path, method = 'GET', body) =>
  api(`/api/merchant/management${path}`, {
    method,
    headers: { 'X-Merchant-Request': '1' },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  }).catch((error) => {
    error.message = staffErrorMessage(error);
    throw error;
  });
export function ManagementPage({ title, children, roles = ['MANAGER'] }) {
  const session = useMerchantStaff();
  if (session.loading)
    return (
      <MerchantShell session={session} title={title}>
        <LoadingCards />
      </MerchantShell>
    );
  if (!session.staff)
    return (
      <MerchantShell session={session} title={title} showNav={false}>
        <MerchantSignIn
          config={session.authConfig}
          loading={session.loading}
          error={session.error}
          onLogin={session.login}
        />
      </MerchantShell>
    );
  return (
    <MerchantShell session={session} title={title} staff={session.staff}>
      <h1>{title}</h1>
      {roles.includes(session.staff.role) ? (
        children(session)
      ) : (
        <p role="alert">บัญชีนี้ไม่มีสิทธิ์เข้าถึงส่วนจัดการนี้</p>
      )}
    </MerchantShell>
  );
}
export function useManagement(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    managementApi(path)
      .then((value) => {
        if (active) {
          setData(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(staffErrorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return { data, error, reload: () => setRevision((value) => value + 1) };
}
export function Dashboard({ session }) {
  const { data, error } = useManagement('/dashboard');
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    let active = true;
    api('/api/merchant/orders').then((result) => { if (active) setOrders(result.orders); }).catch(() => {});
    return () => { active = false; };
  }, [session.staff.id]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <LoadingCards />;
  const count = (status) => Number(data.today_status?.find((row) => row.status === status)?.count || 0);
  const metrics = [['ออเดอร์ใหม่', count('PENDING')], ['กำลังเตรียม', count('ACCEPTED') + count('PREPARING')],
    ['พร้อมจัดส่ง', count('READY')], ['กำลังจัดส่ง', count('DELIVERING')], ['สำเร็จวันนี้', data.metrics.completed_orders], ['ยอดขายวันนี้', baht(data.metrics.revenue_today)]];
  return <>
    <p className="portal-subtitle">{session.staff.store_name} · วันนี้</p>
    <div className="management-kpis portal-today">{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <p className="management-help">ยอดขายนับเฉพาะออเดอร์ที่สำเร็จและชำระแล้ว ตามวันของร้าน</p>
    <div className="management-actions portal-quick-actions">
      <Link href="/merchant/orders?filter=new">ดูออเดอร์ใหม่</Link><Link href="/merchant/kitchen">เปิดครัว</Link>
      {session.staff.role === 'MANAGER' && <Link href="/merchant/riders">จัดการไรเดอร์</Link>}
    </div>
    <section className="portal-recent"><h2>ออเดอร์ล่าสุด</h2>
      {data.recent.length ? data.recent.map((order) => {
        const detail = orders.find((row) => row.id === order.id);
        return <Link className="portal-recent-row" key={order.id} href={`/merchant/orders/${order.id}`}>
          <div><strong>{order.order_code}</strong><small>{new Date(order.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</small></div>
          <span className={`merchant-state state-${order.status.toLowerCase()}`}>{staffOrderStatusLabel(order.status)}</span>
          {detail?.total_amount !== undefined && <b>{baht(detail.total_amount)}</b>}
        </Link>;
      }) : <p>ยังไม่มีออเดอร์</p>}
    </section>
    <button className="merchant-logout" onClick={session.logout}>ออกจากระบบ</button>
  </>;
}
