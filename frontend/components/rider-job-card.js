'use client';
import Link from 'next/link';
import { Icon } from './icons';
import { staffOrderStatusLabel } from '../lib/staff-presentation.mjs';
export function RiderJobCard({ order, storeName }) {
  return <Link className="rider-order-card" href={`/rider/orders/${order.id}`}>
    <div className="rider-order-card-heading"><div><span>{order.order_code}</span><strong>{storeName}</strong></div><span className={`rider-state state-${order.status.toLowerCase()}`}>{staffOrderStatusLabel(order.status)}</span></div>
    <div className="rider-destination"><Icon name="map" size={19} /><div><h2>{order.delivery?.label} · {order.delivery?.dormitory_name || 'รับที่ร้าน'}</h2><p>ห้อง {order.delivery?.room_number || '-'}</p></div></div>
    {order.delivery?.contact_phone && <span className="rider-card-phone"><Icon name="phone" size={16} />{order.delivery.contact_phone}</span>}
    <div className="rider-job-footer"><small>{order.items.length} รายการ</small><span>ดูรายละเอียด →</span></div>
  </Link>;
}
