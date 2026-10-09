'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { staffErrorMessage } from '../lib/staff-portal.mjs';
import { staffOrderStatusLabel } from '../lib/staff-presentation.mjs';
import { snapshotChoiceLabel } from './merchant-snapshot-label';

export function KitchenTicket({ order, role, now, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const canPrepare = ['MANAGER', 'CASHIER'].includes(role);
  const canKds = ['MANAGER', 'KITCHEN'].includes(role);
  const completed = order.items.filter((item) => item.is_completed).length;
  const minutes = Math.max(0, Math.floor((now - new Date(order.created_at).getTime()) / 60000));
  async function update(action, item) {
    if (pending.current) return;
    if (action === 'start-preparing' ? !canPrepare || order.status !== 'ACCEPTED'
      : !canKds || order.status !== 'PREPARING') return;
    if (action === 'ready' && (!order.items.length || completed !== order.items.length)) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await api(`/api/merchant/orders/${order.id}/${item ? `items/${item.id}` : action}`, {
        method: item ? 'PATCH' : 'POST', body: JSON.stringify(item ? { completed: !item.is_completed } : {}),
      });
      onUpdated(result.order);
    } catch (failure) { setError(staffErrorMessage(failure)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <article className={`kds-ticket${minutes >= 15 ? ' is-waiting' : ''}`} aria-busy={busy}>
    <header><Link href={`/merchant/orders/${order.id}`}>{order.order_code}</Link><span className="kds-wait">รอ {minutes} นาที</span></header>
    <div className="kds-ticket-status"><span className={`merchant-state state-${order.status.toLowerCase()}`}>{staffOrderStatusLabel(order.status)}</span><b>{completed}/{order.items.length}</b></div>
    <ul>{order.items.map((item) => <li key={item.id} className={item.is_completed ? 'is-complete' : ''}>
      <div className="kds-item-title">{canKds && order.status === 'PREPARING' && <label className="kds-check"><input type="checkbox" aria-label={`ทำเสร็จ ${item.item_name}`} checked={item.is_completed} disabled={busy} onChange={() => update('item', item)} /></label>}<strong>{item.quantity} × {item.item_name}</strong></div>
      {item.choices?.length > 0 && <p>{item.choices.map((choice) => snapshotChoiceLabel(item, choice)).join(' · ')}</p>}
      {item.note && <p className="kds-note">หมายเหตุ: {item.note}</p>}
    </li>)}</ul>
    {error && <p role="alert" className="form-error">{error}</p>}
    {busy && <p role="status">กำลังบันทึก…</p>}
    <footer>
      {order.status === 'ACCEPTED' && (canPrepare ? <button className="merchant-primary" disabled={busy} onClick={() => update('start-preparing')}>เริ่มเตรียมอาหาร</button> : <p>รอพนักงานเริ่มเตรียมอาหาร</p>)}
      {order.status === 'PREPARING' && canKds && (completed === order.items.length && completed > 0
        ? <><p className="kds-complete-message">ครบทุกเมนูแล้ว</p><button className="merchant-primary" disabled={busy} onClick={() => update('ready')}>อาหารพร้อมจัดส่ง</button></>
        : <button className="merchant-secondary" disabled={busy} onClick={() => update('complete-all-items')}>ทำครบทุกเมนู</button>)}
      {!canKds && order.status === 'PREPARING' && <p>กำลังเตรียมในครัว</p>}
    </footer>
  </article>;
}
