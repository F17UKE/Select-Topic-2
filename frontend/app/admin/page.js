'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminError, AdminShell, StatusBadge } from '../../components/admin-shell';
import { AdminDataTable, AdminIcon } from '../../components/admin-ui';
import { api, baht } from '../../lib/api';

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/admin/dashboard').then(setData).catch((requestError) => setError(requestError.message)); }, []);
  const cards = data ? [
    ['ออเดอร์วันนี้', data.metrics.orders_today, 'receipt'],
    ['กำลังดำเนินการ', ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'].reduce((total, key) => total + Number(data.order_status[key] || 0), 0), 'activity'],
    ['ชำระแล้ววันนี้', data.metrics.paid_orders, 'shield'], ['รายได้สำเร็จวันนี้', baht(data.metrics.revenue), 'money'],
    ['ร้านที่เปิดใช้งาน', data.metrics.active_merchants, 'store'], ['ไรเดอร์ที่เปิดใช้งาน', data.metrics.active_riders, 'users'],
  ] : [];
  return <AdminShell title="ภาพรวมแพลตฟอร์ม" description="ข้อมูลวันนี้จากระบบจริง"><AdminError>{error}</AdminError>{!data ? <div className="admin-empty">กำลังโหลด Dashboard…</div> : <><section className="admin-metrics">{cards.map(([label, value, icon]) => <article key={label}><div className="admin-metric-icon"><AdminIcon name={icon} /></div><span>{label}</span><strong>{value}</strong></article>)}</section><div className="admin-secondary-metrics"><span>รอร้านรับวันนี้ <strong>{data.metrics.pending_orders}</strong></span><span>การชำระเงินผิดปกติวันนี้ <strong>{data.metrics.failed_payments}</strong></span></div><div className="admin-grid"><section className="admin-panel"><h2>สถานะออเดอร์</h2><div className="admin-breakdown">{Object.entries(data.order_status).map(([key, value]) => <div key={key}><StatusBadge value={key} /><strong>{value}</strong></div>)}</div></section><section className="admin-panel"><h2>สถานะการชำระเงิน</h2><div className="admin-breakdown">{Object.entries(data.payment_status).map(([key, value]) => <div key={key}><StatusBadge value={key} /><strong>{value}</strong></div>)}</div></section></div><section className="admin-table-card"><div className="admin-panel-heading"><h2>ออเดอร์ล่าสุด</h2><Link className="admin-link" href="/admin/orders">ดูทั้งหมด</Link></div><AdminDataTable items={data.recent_orders} columns={[{key:'order_code',label:'เลขออเดอร์'},{key:'store_name',label:'ร้านค้า'},{key:'customer_name',label:'ลูกค้า'},{key:'status',label:'สถานะ'},{key:'total_amount',label:'ยอดรวม',type:'money'}]} render={(order,c)=>c.key==='order_code'?<Link className="admin-link" href={`/admin/orders/${order.id}`}>{order.order_code}</Link>:c.key==='status'?<StatusBadge value={order.status}/>:c.type==='money'?baht(order[c.key]):order[c.key]} /></section></>}
  </AdminShell>;
}
