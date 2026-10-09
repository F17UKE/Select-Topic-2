'use client';

import { useEffect, useRef, useId } from 'react';
import { openReviewDialog } from '../lib/review-dialog.mjs';

// Preserve each existing security dialog's own cancel handler (including secret cleanup).
export function useAdminDialogBackdrop() {
  useEffect(() => {
    let pressed = null;
    const outside = (event) => {
      const element = event.target;
      if (!(element instanceof HTMLDialogElement) || !element.open || !element.closest('.admin-app') || element.classList.contains('admin-dialog')) return null;
      const box = element.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom ? element : null;
    };
    const down = (event) => { pressed = outside(event); };
    const click = (event) => { const dialog = outside(event); if (dialog && dialog === pressed) dialog.dispatchEvent(new Event('cancel', { cancelable: true })); pressed = null; };
    document.addEventListener('pointerdown', down);
    document.addEventListener('click', click);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('click', click); };
  }, []);
}

export function AdminIcon({ name = 'grid' }) {
  const paths = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    store: 'M3 10h18l-2-6H5z M5 10v10h14V10 M9 20v-6h6v6',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    receipt: 'M5 3h14v18l-3-2-4 2-4-2-3 2z M8 7h8 M8 11h8 M8 15h5',
    money: 'M3 5h18v14H3z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 8h1 M18 16h1',
    pin: 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0 M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    image: 'M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M15 7h.01',
    ticket: 'M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4z M15 5v3 M15 11v2 M15 16v3',
    star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
    chart: 'M4 3v18h17 M8 17v-5 M13 17V8 M18 17V4',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
    activity: 'M2 12h5l3-8 4 16 3-8h5',
    settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
    link: 'm10 14 4-4 M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    close: 'm6 6 12 12 M6 18 18 6',
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.grid} /></svg>;
}

export function AdminDialog({ title, onClose, children, className = '' }) {
  const ref = useRef(null);
  const id = useId();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    const finish = openReviewDialog(dialog, document.activeElement);
    const closed = () => close.current();
    dialog.addEventListener('close', closed);
    return () => { dialog.removeEventListener('close', closed); finish(); };
  }, []);
  return <dialog ref={ref} className={`admin-dialog ${className}`} aria-labelledby={id}>
    <div className="admin-dialog-heading"><h2 id={id}>{title}</h2><button type="button" className="admin-icon-button" data-review-close aria-label="ปิดหน้าต่าง" onClick={onClose}><AdminIcon name="close" /></button></div>{children}
  </dialog>;
}

export function AdminRowActions({ label, children }) {
  return <details className="admin-row-actions" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }} onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary').focus(); } }}>
    <summary aria-label={`จัดการ ${label}`}>⋯</summary><div>{children}</div>
  </details>;
}

export function AdminDataTable({ columns, items, render, actions, loading = false, empty = 'ยังไม่มีรายการที่ตรงกับเงื่อนไข ลองเปลี่ยนคำค้นหาหรือตัวกรอง' }) {
  if (loading) return <div className="admin-skeleton" role="status" aria-label="กำลังโหลดข้อมูล"><span /><span /><span /></div>;
  if (!items.length) return <div className="admin-empty"><AdminIcon name="receipt" /><strong>ไม่พบข้อมูล</strong><p>{empty}</p></div>;
  return <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr>{columns.map((c) => <th scope="col" key={c.key} className={c.type === 'money' || c.numeric ? 'numeric' : ''}>{c.label}</th>)}{actions && <th scope="col">จัดการ</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id}>{columns.map((c) => <td data-label={c.label} key={c.key} className={c.type === 'money' || c.numeric ? 'numeric' : ''}>{render(item, c)}</td>)}{actions && <td data-label="จัดการ">{actions(item)}</td>}</tr>)}</tbody></table></div>;
}
