'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons';
import styles from './cart.module.css';

export function ClearCartButton({ onConfirm }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const cancel = useRef(null);
  const id = useId();
  return <>
    <button ref={trigger} className={styles.clearButton} type="button" aria-haspopup="dialog" aria-controls={id}
      onClick={() => { dialog.current.showModal(); cancel.current.focus(); }}><Icon name="trash" size={16} />ล้างตะกร้า</button>
    <dialog ref={dialog} id={id} className={styles.confirmDialog} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onClose={() => trigger.current?.focus()}>
      <h2 id={`${id}-title`}>ล้างตะกร้าทั้งหมด?</h2>
      <p id={`${id}-description`}>สินค้าทั้งหมดในตะกร้าจะถูกนำออก</p>
      <div className={styles.dialogActions}>
        <button ref={cancel} type="button" onClick={() => dialog.current.close()}>ยกเลิก</button>
        <button className={styles.destructive} type="button" onClick={() => { dialog.current.close(); onConfirm(); }}>ล้างตะกร้า</button>
      </div>
    </dialog>
  </>;
}

export function CartNoteEditor({ item, onNoteChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.note || '');
  const input = useRef(null);
  const trigger = useRef(null);
  const restoreFocus = useRef(false);
  const id = useId();
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (restoreFocus.current) { trigger.current?.focus(); restoreFocus.current = false; }
  }, [editing]);
  function close() { restoreFocus.current = true; setEditing(false); }
  if (editing) return <div className={styles.noteEditor}>
    <label htmlFor={id}>หมายเหตุถึงร้าน</label>
    <textarea ref={input} id={id} value={draft} maxLength={500} rows={2} placeholder="เช่น ไม่ใส่ผัก แยกน้ำ"
      onChange={(event) => setDraft(event.target.value)} />
    <div><button className={styles.saveNote} type="button" onClick={() => { onNoteChange(item.id, draft); close(); }}>บันทึก</button>
      <button type="button" onClick={close}>ยกเลิก</button></div>
  </div>;
  return <div className={styles.noteSummary}>
    {item.note && <p><span>หมายเหตุ:</span> {item.note}</p>}
    <button ref={trigger} type="button" aria-expanded="false" aria-label={`${item.note ? 'แก้ไข' : 'เพิ่ม'}หมายเหตุ ${item.name}`}
      onClick={() => { setDraft(item.note || ''); setEditing(true); }}>{item.note ? 'แก้ไข' : '+ เพิ่มหมายเหตุ'}</button>
  </div>;
}
