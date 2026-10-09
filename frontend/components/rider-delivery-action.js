'use client';
import { useRef } from 'react';
export function RiderDeliveryAction({ status, busy, onTransition, error }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  if (!['READY', 'DELIVERING'].includes(status)) return null;
  return <>
    <div className="rider-sticky-action">
      <button ref={trigger} className="rider-primary" disabled={busy} type="button" onClick={() => status === 'READY' ? onTransition('start-delivery') : dialog.current?.showModal()}>
        {busy ? 'กำลังบันทึก…' : status === 'READY' ? 'เริ่มจัดส่ง' : 'ส่งสำเร็จ'}
      </button>
    </div>
    <dialog ref={dialog} className="portal-menu-dialog rider-confirm" aria-labelledby="delivery-confirm-title" onClose={() => trigger.current?.focus()}>
      <h2 id="delivery-confirm-title">ยืนยันว่าส่งออเดอร์สำเร็จแล้ว?</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="merchant-button-row"><button type="button" className="rider-secondary" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>ยกเลิก</button>
        <button type="button" className="rider-primary" disabled={busy} onClick={() => onTransition('complete')}>{busy ? 'กำลังบันทึก…' : 'ยืนยันส่งสำเร็จ'}</button></div>
    </dialog>
  </>;
}
