'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../components/app-shell';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { Icon } from '../../components/icons';
import { api } from '../../lib/api';
import { useCustomer } from '../../lib/use-customer';

export default function NotificationsPage() {
  const session = useCustomer();
  const [data, setData] = useState({ items: [], unread_count: 0 });
  const [error, setError] = useState('');
  const load = useCallback(() => api('/api/customer/notifications').then(setData).catch((requestError) => setError(requestError.message)), []);
  useEffect(() => { if (session.customer) void Promise.resolve().then(load); }, [session.customer, load]);
  async function markRead(item) { if (!item.is_read) { await api(`/api/customer/notifications/${item.id}/read`, { method: 'PATCH' }); await load(); } }
  async function readAll() { await api('/api/customer/notifications/read-all', { method: 'POST' }); await load(); }
  const header = <CustomerDetailHeader title="การแจ้งเตือน" backHref="/" />;
  if (session.loading) return <AppShell header={header}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell header={header}><SignInCard config={session.authConfig} onLogin={session.devLogin} /></AppShell>;
  return <AppShell variant="engagement" header={header}><div className="notification-heading"><div><p>อัปเดตออเดอร์</p><h1>{data.unread_count ? `${data.unread_count} รายการที่ยังไม่อ่าน` : 'อ่านครบแล้ว'}</h1></div>{data.unread_count > 0 && <button type="button" onClick={readAll}>อ่านทั้งหมด</button>}</div>{error && <p className="form-error">{error}</p>}<div className="notification-list">{data.items.map((item) => <Link href={item.order_id ? `/orders/${item.order_id}` : '/'} className={item.is_read ? '' : 'is-unread'} key={item.id} onClick={() => markRead(item)}><span><Icon name="bell" size={19} /></span><div><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString('th-TH')}</small></div></Link>)}</div>{!data.items.length && !error && <div className="empty-state"><Icon name="bell" size={36} /><h2>ยังไม่มีการแจ้งเตือน</h2><p>สถานะออเดอร์ใหม่จะแสดงที่นี่</p></div>}</AppShell>;
}
