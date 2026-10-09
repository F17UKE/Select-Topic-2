'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../app/admin/settings/integrations/settings.module.css';

export default function IntegrationSecretReveal({ field, mutate, disabled = false, action = null }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const dialog = useRef(null);
  const lifecycle = useRef({ generation: 0, controller: null, timer: null });
  const hide = useCallback(() => {
    const state = lifecycle.current;
    state.generation++; state.controller?.abort(); state.controller = null;
    clearTimeout(state.timer); state.timer = null;
    setValue(''); setPassword(''); setOpen(false); setBusy(false); setError(''); setCopied(false);
  }, []);
  useEffect(() => {
    const state = lifecycle.current;
    const onVisibility = () => { if (document.visibilityState !== 'visible') hide(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', hide);
      state.generation++; state.controller?.abort(); clearTimeout(state.timer);
      // Component state is discarded on route change/unmount; pending work is invalidated.
    };
  }, [hide]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  async function reveal(event) {
    event.preventDefault();
    const state = lifecycle.current;
    if (disabled || !open || !field.revealable || state.controller) return;
    const generation = ++state.generation;
    const controller = new AbortController(); state.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setBusy(true); setPassword(''); setError('');
    try {
      const result = await mutate(`/api/admin/settings/integrations/secrets/${encodeURIComponent(field.name)}/reveal`, {
        method: 'POST', body: JSON.stringify({ password }), signal: controller.signal,
      });
      if (state.generation !== generation || controller.signal.aborted || document.visibilityState !== 'visible') return;
      if (typeof result.value !== 'string' || !result.value) throw new Error('invalid_reveal');
      setValue(result.value); setOpen(false); setCopied(false);
      state.timer = setTimeout(hide, 60000);
    } catch (failure) {
      if (state.generation !== generation) return;
      const code = failure.body?.code;
      setError(code === 'invalid_reauth_password' ? 'รหัสผ่านไม่ถูกต้อง'
        : failure.status === 429 ? 'ตรวจสอบหลายครั้งเกินไป กรุณาลองใหม่ใน 15 นาที'
          : [401, 403].includes(failure.status) ? 'Session หรือสิทธิ์ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'
            : 'ไม่สามารถเปิดดูข้อมูลลับได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      clearTimeout(timeout);
      if (state.generation === generation) { state.controller = null; setBusy(false); }
    }
  }
  async function copy() {
    if (!value || disabled) return;
    const generation = lifecycle.current.generation;
    try {
      await navigator.clipboard.writeText(value);
      if (lifecycle.current.generation === generation) setCopied(true);
    } catch { if (lifecycle.current.generation === generation) setError('คัดลอกไม่สำเร็จ กรุณาลองใหม่'); }
  }
  return <div className={styles.secretDisplay}>
    <label htmlFor={`${field.name}-current`}>{field.label}</label>
    <input id={`${field.name}-current`} readOnly autoComplete="off" spellCheck={false} value={value || (field.configured ? '••••••••••••••••' : 'ยังไม่ได้ตั้งค่า')} />
    <small>{field.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}{field.configured && !field.revealable ? ' · ค่า Environment ไม่เปิดเผยผ่านหน้านี้' : ''}</small>
    <div className={styles.actions}>
      {value ? <><button type="button" className={styles.secondary} onClick={hide}>ซ่อน</button><button type="button" className={styles.secondary} disabled={disabled} onClick={copy}>คัดลอก</button></>
        : <button type="button" className={styles.secondary} disabled={disabled || !field.revealable} onClick={() => { hide(); setOpen(true); }}>ดู Key</button>}
      {action}
    </div>
    {value && <small>ซ่อนอัตโนมัติภายใน 60 วินาที หรือเมื่อออกจากหน้านี้ · การซ่อนไม่ล้างคลิปบอร์ดที่คุณคัดลอก</small>}
    {copied && <p role="status">คัดลอกแล้ว</p>}
    {!open && error && <p role="alert">{error}</p>}
    <dialog ref={dialog} className={styles.confirmation} aria-labelledby={`${field.name}-reauth-title`} onCancel={hide}>
      <form onSubmit={reveal}>
        <h2 id={`${field.name}-reauth-title`}>ยืนยันตัวตนเพื่อดูข้อมูลลับ</h2>
        <p>{field.label} · ต้องยืนยันรหัสผ่านทุกครั้งที่เปิดดู</p>
        <label htmlFor={`${field.name}-reauth`}>รหัสผ่านปัจจุบัน</label>
        <input id={`${field.name}-reauth`} type="password" autoComplete="current-password" value={password} disabled={busy} required maxLength={200} onChange={(event) => setPassword(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={hide}>ยกเลิก</button><button type="submit" className={styles.primary} disabled={busy || !password}>{busy ? 'กำลังยืนยัน...' : 'ยืนยัน'}</button></div>
      </form>
    </dialog>
  </div>;
}
