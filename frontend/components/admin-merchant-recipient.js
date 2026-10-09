'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAdmin } from '../lib/use-admin';
import styles from '../app/admin/settings/integrations/settings.module.css';

const sources = { DATABASE: 'ระบบหลังบ้าน', ENVIRONMENT: 'Server Environment', NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่า' };
function safeError(error) {
  if (error.status === 409) return 'ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดใหม่ก่อนบันทึก';
  if ([401, 403].includes(error.status)) return 'เฉพาะ Super Admin และ session ที่ถูกต้องเท่านั้น';
  if (error.status === 400) return 'กรุณาตรวจรหัสธนาคาร 3 หลัก และเลขบัญชี 6–20 หลัก';
  if (error.status === 404) return 'ไม่พบร้านค้า';
  return 'ดำเนินการไม่สำเร็จ กรุณาตรวจการตั้งค่าแล้วลองใหม่';
}
export default function AdminMerchantRecipient({ merchantId }) {
  const session = useAdmin();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({ bankCode: '', bankNumber: '', enabled: true });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const inFlight = useRef(false);
  const dialog = useRef(null);
  const endpoint = `/api/admin/merchants/${encodeURIComponent(merchantId)}/payment-recipient`;
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { const result = await api(endpoint); setData(result); setEditing(false); setDraft({ bankCode: result.bank_code, bankNumber: '', enabled: result.source === 'NOT_CONFIGURED' || result.enabled }); }
    catch (failure) { setError(safeError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }, [endpoint]);
  useEffect(() => { if (session.admin?.role === 'SUPER_ADMIN') { void Promise.resolve().then(load); } }, [session.admin?.role, load]);
  useEffect(() => {
    if (confirmation && !dialog.current?.open) dialog.current?.showModal();
    else if (!confirmation && dialog.current?.open) dialog.current.close();
  }, [confirmation]);
  async function save(clear) {
    if (inFlight.current || !data) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice(''); setConfirmation(null);
    const body = clear ? { version: data.version, clear: true, confirm: true } : { version: data.version, ...draft, confirm: true };
    setDraft((current) => ({ ...current, bankNumber: '' }));
    try {
      const result = await session.mutate(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
      setData(result); setEditing(false); setDraft({ bankCode: result.bank_code, bankNumber: '', enabled: result.source === 'NOT_CONFIGURED' || result.enabled });
      setNotice(clear ? 'ล้างค่าหลังบ้านแล้ว · ใช้ Server Environment หากมี' : 'บันทึกบัญชีรับชำระเงินแล้ว · มีผลกับการตรวจสอบครั้งถัดไป');
    } catch (failure) { setError(safeError(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (session.admin?.role !== 'SUPER_ADMIN') return null;
  return <section className={`admin-panel ${styles.card}`} aria-labelledby="recipient-title">
    <h2 id="recipient-title">การรับชำระเงิน</h2>
    <p>ผูกบัญชีธนาคารที่ลงทะเบียนใน EasySlip กับ PromptPay ของร้าน · ไม่เปลี่ยน QR หรือเลือก provider ให้อัตโนมัติ</p>
    <button type="button" className={styles.secondary} disabled={busy} onClick={load}>โหลดการรับชำระเงินใหม่</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {data && <>
      <p><strong>{data.configured ? 'พร้อมตรวจสอบผู้รับเงิน' : data.reason === 'DISABLED' ? 'ปิดใช้งานบัญชีรับชำระเงิน' : 'ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับชำระเงิน'}</strong></p>
      <dl><dt>แหล่งข้อมูล</dt><dd>{sources[data.source]}</dd><dt>PromptPay ของ QR ร้าน ({data.promptpay_type})</dt><dd>{data.promptpay_masked}</dd>
        <dt>รหัสธนาคาร / เลขบัญชีปัจจุบัน</dt><dd>{data.bank_code || '—'} · {data.bank_number_masked || 'ยังไม่ได้ตั้งค่า'}</dd></dl>
      <p>PromptPay อ่านจากข้อมูลร้านบน server หากร้านเปลี่ยน PromptPay ให้ตรวจและบันทึก mapping ใหม่ เลขบัญชีต้องตรงกับบัญชีที่รับเงินและลงทะเบียนไว้กับ EasySlip</p>
      {!editing ? <button type="button" className={styles.primary} disabled={busy || !data.encryption_ready} onClick={() => { setEditing(true); setNotice(''); }}>{data.source === 'NOT_CONFIGURED' ? 'ตั้งค่าบัญชีรับชำระเงิน' : 'แก้ไขบัญชีรับชำระเงิน'}</button>
        : <form onSubmit={(event) => { event.preventDefault(); setConfirmation('save'); }}>
          <div className={styles.field}><label htmlFor="recipient-bank-code">รหัสธนาคาร EasySlip (3 หลัก)</label><input id="recipient-bank-code" inputMode="numeric" pattern="[0-9]{3}" maxLength={3} required value={draft.bankCode} disabled={busy} onChange={(e) => setDraft({ ...draft, bankCode: e.target.value })} /><small>ใช้ bank code ตามบัญชีที่ลงทะเบียนใน EasySlip รวมเลขศูนย์ด้านหน้า</small></div>
          <div className={styles.field}><label htmlFor="recipient-bank-number">{data.bank_number_masked ? 'เปลี่ยนเลขบัญชีธนาคาร' : 'เลขบัญชีธนาคาร'}</label><input id="recipient-bank-number" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6,20}" maxLength={20} required={!data.bank_number_masked} value={draft.bankNumber} disabled={busy} onChange={(e) => setDraft({ ...draft, bankNumber: e.target.value })} /><small>ตัวเลข 6–20 หลัก ไม่ใส่ขีด · เว้นว่างเพื่อคงเลขบัญชีที่ตั้งไว้</small></div>
          <div className={styles.field}><label htmlFor="recipient-enabled">การตรวจสอบบัญชีนี้</label><select id="recipient-enabled" value={String(draft.enabled)} disabled={busy} onChange={(e) => setDraft({ ...draft, enabled: e.target.value === 'true' })}><option value="true">เปิดใช้งาน</option><option value="false">ปิดใช้งาน (ไม่กลับไปใช้ ENV)</option></select></div>
          <div className={styles.actions}><button className={styles.primary} disabled={busy} type="submit">{busy ? 'กำลังบันทึก...' : 'บันทึกบัญชีรับชำระเงิน'}</button><button className={styles.secondary} type="button" disabled={busy} onClick={() => { setEditing(false); setDraft({ bankCode: data.bank_code, bankNumber: '', enabled: data.enabled }); }}>ยกเลิกแก้ไข</button></div>
        </form>}
      {data.source === 'DATABASE' && <div className={styles.actions}><button className={styles.secondary} type="button" disabled={busy} onClick={() => setConfirmation('clear')}>ล้างค่าหลังบ้าน / กลับใช้ ENV</button></div>}
    </>}
    <dialog ref={dialog} className={styles.confirmation} aria-labelledby="recipient-confirm-title" onCancel={() => setConfirmation(null)}>
      <h2 id="recipient-confirm-title">ยืนยันการตั้งค่ารับชำระเงิน</h2><p>{confirmation === 'clear' ? 'ล้าง mapping หลังบ้านของร้านนี้ และกลับใช้ ENV หากมี?' : 'ใช้บัญชีนี้ตรวจสอบผู้รับเงินของร้าน? การเปลี่ยนค่ามีผลกับคำขอถัดไป รวมออเดอร์ที่ยังไม่ชำระเงิน'}</p>
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setConfirmation(null)}>ยกเลิก</button><button type="button" className={styles.primary} disabled={busy} onClick={() => save(confirmation === 'clear')}>ยืนยัน</button></div>
    </dialog>
  </section>;
}
