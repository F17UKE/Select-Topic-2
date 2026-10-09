'use client';
import { useRef } from 'react';

export function RiderAssignmentPicker({ riders, selectedId, onSelect, onAssign, busy, error }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  return <div className="rider-picker">
    <button ref={trigger} type="button" className="merchant-secondary" aria-haspopup="dialog" disabled={busy} onClick={() => dialog.current?.showModal()}>เลือกไรเดอร์</button>
    <dialog ref={dialog} className="portal-menu-dialog" aria-labelledby="assign-rider-title" onClose={() => trigger.current?.focus()}>
      <div className="portal-dialog-heading"><h2 id="assign-rider-title">เลือกไรเดอร์ของร้าน</h2><button type="button" onClick={() => dialog.current?.close()}>ปิด</button></div>
      {riders.length ? <fieldset className="portal-rider-options"><legend>ผู้จัดส่ง</legend>{riders.map((rider) => <label key={rider.id}>
        <input type="radio" name="store-rider" value={rider.id} checked={String(rider.id) === selectedId} onChange={() => onSelect(String(rider.id))} disabled={busy} />
        <span><strong>{rider.full_name}</strong><small>{rider.active_jobs ? `มีงาน ${rider.active_jobs} งาน` : 'ว่าง'}</small></span>
      </label>)}</fieldset> : <p>ยังไม่มีไรเดอร์ที่เปิดใช้งานในร้าน</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="button" className="merchant-primary" disabled={busy || !selectedId || !riders.length} onClick={onAssign}>มอบหมายงาน</button>
    </dialog>
  </div>;
}
