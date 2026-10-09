'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminError, AdminShell } from '../../../../components/admin-shell';
import { api } from '../../../../lib/api';
import { useAdmin } from '../../../../lib/use-admin';
import IntegrationSecretReveal from '../../../../components/integration-secret-reveal';
import styles from './settings.module.css';
import { channelSecretField, integrationState, settingLabel, settingValue } from '../../../../lib/integration-presentation.mjs';

const sections = [
  ['payment', 'Payment', 'การรับชำระเงินและผู้ตรวจสอบสลิป'],
  ['easyslip', 'EasySlip', 'ตรวจสอบสลิปอัตโนมัติ'],
  ['login', 'LINE Login / LIFF', 'การเข้าสู่ระบบของลูกค้าผ่าน LINE'],
  ['messaging', 'LINE Messaging / Webhook', 'การแจ้งเตือนและรับเหตุการณ์จาก LINE'],
];
function SectionIcon() { return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /></svg>; }
const sources = { DATABASE: 'ตั้งค่าจากระบบหลังบ้าน', ENVIRONMENT: 'ใช้ค่าจาก Server Environment', DEFAULT: 'ค่าเริ่มต้น' };
const accountErrors = {
  INVALID_API_KEY: 'API Key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน',
  ACCOUNT_INACTIVE: 'บัญชี EasySlip ยังไม่เปิดใช้งาน กรุณาตรวจสอบสถานะบัญชี',
  MISSING_KEY: 'กรุณาตั้งค่า EasySlip API Key ก่อน',
};
const accountUnavailable = 'ไม่สามารถเชื่อมต่อ EasySlip ได้ กรุณาลองใหม่อีกครั้ง';
function message(error) {
  if (error.status === 409) return 'มีการเปลี่ยนค่าจากอีกหน้าต่าง กรุณาโหลดข้อมูลใหม่ก่อนบันทึก';
  if (error.status === 403) return 'เฉพาะ Super Admin และ session ที่ถูกต้องเท่านั้น';
  if (error.status === 503) return 'ยังไม่พร้อมใช้งาน กรุณาตรวจ encryption master key และฐานข้อมูลที่ server';
  if (error.status === 422) return 'การตั้งค่าไม่ครบ กรุณาตรวจ key, recipient mapping และข้อมูลที่จำเป็นก่อนเปิดใช้งาน';
  return 'ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองใหม่';
}
export default function IntegrationSettingsPage() {
  const session = useAdmin();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedbackSection, setFeedbackSection] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [accountTest, setAccountTest] = useState(null);
  const [editing, setEditing] = useState(null);
  const [runtime, setRuntime] = useState({});
  const accountVerified = accountTest?.state === 'success' && accountTest.version === data?.version && !draft.EASYSLIP_API_KEY;
  const inFlight = useRef(false);
  const dialog = useRef(null);
  useEffect(() => {
    if (confirmation && !dialog.current?.open) dialog.current?.showModal();
    else if (!confirmation && dialog.current?.open) dialog.current.close();
  }, [confirmation]);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy('load'); setFeedbackSection(null); setNotice(''); setAccountTest(null);
    try {
      setData(await api('/api/admin/settings/integrations')); setDraft({}); setEditing(null); setError('');
      const [auth, finance] = await Promise.allSettled([api('/api/auth/config'), api('/api/finance/admin')]);
      setRuntime({ authMode: auth.status === 'fulfilled' ? auth.value.mode : null, paymentMode: finance.status === 'fulfilled' ? finance.value.runtime?.mode : null });
    }
    catch (e) { setError(message(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }, []);
  useEffect(() => { if (session.admin?.role === 'SUPER_ADMIN') { const request = Promise.resolve().then(load); return () => { void request; }; } }, [session.admin, load]);
  async function save(section, clear = [], confirmed = false) {
    if (inFlight.current || !data) return;
    const values = Object.fromEntries(data.fields.filter((f) => !clear.length && f.section === section && Object.hasOwn(draft, f.name) && !clear.includes(f.name)).map((f) => [f.name, draft[f.name]]));
    const impact = clear.length ? 'ล้างค่าที่บันทึกในหลังบ้าน และกลับไปใช้ Server Environment หากมี ค่าที่ใช้งานอาจเปลี่ยนทันที' : 'บันทึกการตั้งค่านี้? การปิดบริการหรือเปลี่ยน provider/key มีผลกับคำขอถัดไปทันที บัญชีรับเงินจริงและ payment model ยังคงจัดการจากหน้าการเงิน';
    if (!confirmed) { setConfirmation({ kind: 'save', section, clear, message: impact }); return; }
    inFlight.current = true; setBusy(`save:${section}`); setFeedbackSection(section); setError(''); setNotice(''); setAccountTest(null);
    // Clear submitted plaintext immediately, including failed submissions. Other drafts stay intact.
    setDraft((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !data.fields.some((f) => f.section === section && f.name === name && f.type === 'secret'))));
    try {
      const saved = await session.mutate('/api/admin/settings/integrations', { method: 'PATCH', body: JSON.stringify({ version: data.version, values, clear, confirm: true }) });
      setData(saved); setEditing(null);
      setDraft((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !data.fields.some((f) => f.section === section && f.name === name))));
      setNotice('บันทึกการตั้งค่าแล้ว · มีผลกับคำขอถัดไป ไม่ต้อง restart');
    }
    catch (e) { setError(message(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function test(real = false, confirmed = false) {
    if (inFlight.current || !data) return;
    if (real && !data.fields.find((f) => f.name === 'EASYSLIP_API_KEY')?.configured) {
      setAccountTest({ state: 'error', message: accountErrors.MISSING_KEY }); return;
    }
    if (real && !confirmed) { setConfirmation({ kind: 'test', message: 'ส่งคำขอ GET /v2/info ไป EasySlip จริงด้วย key ที่บันทึกแล้ว? ไม่ตรวจสลิป และไม่เปลี่ยนการชำระเงิน' }); return; }
    inFlight.current = true; setBusy(real ? 'test:easyslip' : 'test'); setFeedbackSection(real ? 'easyslip' : null); setError(''); setNotice('');
    if (real) setAccountTest({ state: 'loading', message: 'กำลังตรวจสอบบัญชี EasySlip...' });
    try {
      const result = await session.mutate(`/api/admin/settings/integrations/${real ? 'test-easyslip' : 'test'}`, { method: 'POST', body: JSON.stringify(real ? { version: data.version, confirmRealRequest: true } : {}), ...(real ? { signal: AbortSignal.timeout(10000) } : {}) });
      if (real) setAccountTest(result.result === 'ACCOUNT_AUTH_VERIFIED' && result.version === data.version
        ? { state: 'success', message: 'เชื่อมต่อ EasySlip สำเร็จ', version: result.version, active: result.account_status === 'ACTIVE' }
        : { state: 'error', message: accountErrors[result.failure_code] || accountUnavailable });
      else { setData((current) => ({ ...current, status: result.status })); setNotice('ตรวจเฉพาะการตั้งค่าแล้ว · ยังไม่ได้ทดสอบ provider จริง'); }
    } catch (e) {
      if (real) setAccountTest({ state: 'error', message: (e.body?.code || e.body?.error) === 'easyslip_api_key_missing' ? accountErrors.MISSING_KEY
        : [401, 403, 409].includes(e.status) ? message(e) : accountUnavailable });
      else setError(message(e));
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  const fieldByName = (name) => data?.fields.find((field) => field.name === name);
  const savedValue = (name) => fieldByName(name)?.value;
  const provider = savedValue('PAYMENT_VERIFICATION_MODE');
  const canonicalSecret = data ? channelSecretField(data.fields) : null;
  function cancelEdit() { setDraft({}); setEditing(null); }
  function beginEdit(field) {
    if (busy) return;
    const name = field.editName || field.name;
    if (field.section === 'promptpay') {
      // Type and identifier must remain a valid pair in the existing atomic settings API.
      setDraft(Object.fromEntries(data.fields.filter((item) => item.section === 'promptpay').map((item) => [item.name, item.type === 'secret' ? '' : item.value])));
      setEditing('promptpay');
    } else { setDraft({ [name]: field.type === 'secret' ? '' : field.value }); setEditing(name); }
    setError(''); setNotice(''); setFeedbackSection(null);
    if (name === 'EASYSLIP_API_KEY') setAccountTest(null);
  }
  function renderField(original) {
    if (!original) return null;
    const field = { ...original, label: original.editName ? original.label : settingLabel(original) };
    const name = field.editName || field.name;
    const isEditing = editing === name || editing === 'promptpay' && field.section === 'promptpay';
    const secret = field.type === 'secret';
    return <div key={name} className={styles.field} data-setting={name}>
      {isEditing ? <>
        <label htmlFor={name}>{field.label}{secret ? ' ใหม่' : ''}</label>
        {['enum', 'boolean'].includes(field.type) ? <select id={name} disabled={Boolean(busy)} value={draft[name] ?? field.value} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}>
          {(field.options || ['true', 'false']).filter((value) => !(data.production && value === 'mock') && (name !== 'LINE_MESSAGING_MODE' || value !== 'mock' || field.value === 'mock')).map((value) => <option key={value} value={value} disabled={name === 'LINE_MESSAGING_MODE' && value === 'mock'}>{settingValue(value)}</option>)}
        </select> : <input id={name} type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} disabled={Boolean(busy) || secret && !data.encryption_ready} value={draft[name] ?? ''} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })} />}
        {secret && <small>เว้นว่างเพื่อเก็บค่าเดิม · ค่าที่บันทึกจะถูกเข้ารหัส</small>}
        {name === 'PAYMENT_VERIFICATION_MODE' && <p className={styles.warning}>การเปลี่ยนผู้ตรวจสอบสลิปมีผลกับคำขอถัดไปทันที โปรดตรวจการตั้งค่าก่อนยืนยัน</p>}
        {(editing !== 'promptpay' || name === 'PLATFORM_PROMPTPAY_NAME') && <div className={styles.actions}><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={cancelEdit}>ยกเลิก</button><button className={styles.primary} type="button" disabled={Boolean(busy)} onClick={() => save(field.section)}>{busy === `save:${field.section}` ? 'กำลังบันทึก…' : 'บันทึก'}</button></div>}
      </> : secret && !field.identifier ? <IntegrationSecretReveal key={`${field.name}:${data.version}:${busy}:${editing}`} field={field} mutate={session.mutate} disabled={Boolean(busy)} action={<button className={styles.secondary} type="button" disabled={Boolean(busy) || !data.encryption_ready} onClick={() => beginEdit(field)}>{name === 'EASYSLIP_API_KEY' ? 'เปลี่ยน Key' : 'เปลี่ยน'}</button>} /> : <>
        <span className={styles.fieldLabel}>{field.label}</span>
        <div className={styles.currentRow}><span className={styles.currentValue}>{secret ? field.masked || 'ยังไม่ได้ตั้งค่า' : settingValue(field.value)}</span>{field.type !== 'fixed' && <button className={styles.secondary} type="button" disabled={Boolean(busy) || secret && !data.encryption_ready} onClick={() => beginEdit(field)}>แก้ไข</button>}</div>
      </>}
    </div>;
  }
  const renderFields = (names) => names.map((name) => renderField(fieldByName(name)));
  function feedback(section) {
    return feedbackSection === section && <><AdminError>{error}</AdminError>{notice && <p role="status" className="admin-alert">{notice}</p>}</>;
  }
  function statusText(section) {
    const state = integrationState(data, section, accountVerified, runtime.authMode);
    return <div className={styles.statusLines}><span>{state.configuration}</span><span>{state.activity}</span><small>{state.verification}</small></div>;
  }
  const promptpayConfigured = data?.fields.some((field) => field.section === 'promptpay' && ['PLATFORM_PROMPTPAY_ID', 'PLATFORM_PROMPTPAY_NAME'].includes(field.name) && field.configured);
  const promptpay = <div className={styles.nested}><h3>Platform PromptPay</h3><p>ข้อมูลที่บันทึกใน Integration Settings · บัญชีรับเงินจริงและการเปลี่ยน payment model จัดการที่ <a href="/admin/finance">การเงินของแพลตฟอร์ม</a></p>{renderFields(['PLATFORM_PROMPTPAY_ENABLED', 'PLATFORM_PROMPTPAY_TYPE', 'PLATFORM_PROMPTPAY_ID', 'PLATFORM_PROMPTPAY_NAME'])}{feedback('promptpay')}</div>;
  const checkslip = <div className={styles.nested}><h3>CheckSlip{provider !== 'checkslip' ? ' — ไม่ได้เลือกใช้งาน' : ''}</h3>{renderFields(['CHECKSLIP_API_URL', 'CHECKSLIP_API_KEY'])}{feedback('checkslip')}</div>;
  return <AdminShell title="การเชื่อมต่อระบบ" description="จัดการการชำระเงินและ LINE · เปิดดู Secret ต้องยืนยันรหัสผ่านทุกครั้ง">
    <dialog ref={dialog} className={styles.confirmation} aria-labelledby="integration-confirm-title" aria-describedby="integration-confirm-description" onCancel={() => setConfirmation(null)} onClose={() => setConfirmation(null)}>
      <h2 id="integration-confirm-title">ยืนยันการดำเนินการ</h2><p id="integration-confirm-description">{confirmation?.message}</p>
      <div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => setConfirmation(null)}>ยกเลิก</button><button className={styles.primary} type="button" disabled={Boolean(busy)} onClick={() => {
        if (!confirmation) return;
        setConfirmation(null);
        return confirmation.kind === 'save' ? save(confirmation.section, confirmation.clear, true) : test(true, true);
      }}>ยืนยัน</button></div>
    </dialog>
    {!feedbackSection && <AdminError>{error}</AdminError>}
    {session.admin && session.admin.role !== 'SUPER_ADMIN' ? <p>ไม่มีสิทธิ์เข้าถึงการตั้งค่านี้</p> : <>
      {notice && !feedbackSection && <p role="status" className="admin-alert">{notice}</p>}
      <div className={styles.toolbar}><span className={styles.encryption}>{data?.encryption_ready ? <>การเข้ารหัส Secret พร้อมใช้งาน{data.encryption_key_source === 'DEVELOPMENT_FILE' && <small>Development key ถูกจัดการโดยระบบ</small>}</> : data ? 'ยังไม่มี encryption master key ที่ server' : 'กำลังโหลดการตั้งค่า…'}</span><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={load}>{busy === 'load' ? 'กำลังโหลด…' : 'โหลดข้อมูลใหม่'}</button></div>
      {data && <>
        <nav className={styles.summary} aria-label="สถานะการเชื่อมต่อ">{sections.map(([key, title]) => <a key={key} href={`#integration-${key}`}><strong>{title}</strong>{statusText(key)}</a>)}</nav>
        <div className={styles.grid}>{sections.map(([section, title, description]) => <section id={`integration-${section}`} key={section} className={`admin-panel ${styles.card}`}>
          <header><div><h2 className={styles.sectionTitle}><SectionIcon />{title}</h2><p>{description}</p></div><span className={styles.badge}>{section === 'easyslip' && accountVerified ? 'ตรวจสอบแล้ว' : data.status[section]?.configuration === 'READY' ? 'ตั้งค่าแล้ว' : 'ยังตั้งค่าไม่ครบ'}</span></header>
          {section === 'payment' && <>
            {renderFields(['PAYMENT_INTEGRATION_ENABLED', 'PAYMENT_VERIFICATION_MODE'])}
            <div className={styles.field}><span className={styles.fieldLabel}>รูปแบบการรับเงิน</span><span className={styles.currentValue}>{runtime.paymentMode === 'PLATFORM_CENTRALIZED' ? 'Platform Centralized · รับผ่านแพลตฟอร์ม' : runtime.paymentMode === 'LEGACY_MERCHANT_DIRECT' ? 'Merchant Direct · รับโดยร้านค้า' : 'ตรวจสอบรูปแบบปัจจุบันในหน้าการเงิน'}</span><a className={styles.textLink} href="/admin/finance">จัดการในหน้าการเงิน</a></div>
            {(promptpayConfigured || runtime.paymentMode === 'PLATFORM_CENTRALIZED') && promptpay}
            {provider === 'checkslip' && checkslip}
          </>}
          {section === 'easyslip' && <>
            {renderFields(['EASYSLIP_API_KEY'])}
            <div className={styles.actions} aria-busy={busy === 'test:easyslip'}><button className={styles.secondary} type="button" disabled={Boolean(busy) || !fieldByName('EASYSLIP_API_KEY')?.configured || editing === 'EASYSLIP_API_KEY'} onClick={() => test(true)}>{busy === 'test:easyslip' ? 'กำลังตรวจสอบ...' : 'ตรวจสอบบัญชี EasySlip'}</button></div>
            {!fieldByName('EASYSLIP_API_KEY')?.configured && <p className={styles.accountHint}>{accountErrors.MISSING_KEY}</p>}
            {accountTest && <div role={accountTest.state === 'error' ? 'alert' : 'status'} aria-live="polite" className={`${styles.accountFeedback} ${accountTest.state === 'success' && accountVerified ? styles.accountSuccess : accountTest.state === 'error' ? styles.accountError : ''}`}>
              <strong>{accountTest.state === 'success' && !accountVerified ? 'ข้อมูลมีการเปลี่ยนแปลง กรุณาตรวจสอบบัญชีอีกครั้งหลังบันทึก' : accountTest.message}</strong>
              {accountVerified && <><p>Real verification: VERIFIED{accountTest.active ? ' · สถานะบัญชี: เปิดใช้งาน' : ''}</p><p>ตรวจเฉพาะบัญชี ยังไม่ได้ตรวจสลิปจริง · ผลนี้แสดงเฉพาะหน้านี้และจะถูกล้างเมื่อโหลดใหม่หรือบันทึก</p></>}
            </div>}
          </>}
          {section === 'login' && <>
            {renderFields(['LINE_LOGIN_ENABLED', 'LINE_CHANNEL_ID', 'LINE_LIFF_ID'])}
            <div className={styles.endpoint}><span>Public LIFF URL / Endpoint</span><strong>{data.liff_endpoint || 'รอ Public HTTPS URL'}</strong></div>
            <p>{!data.liff_endpoint ? 'บันทึก credentials ได้แล้ว การเปิด LINE Login จริงจะทำหลังมี HTTPS' : 'ตั้งค่าครบไม่ได้ยืนยันการเข้าสู่ระบบจริง กรุณาทดสอบผ่าน LINE'}</p>
          </>}
          {section === 'messaging' && <>
            {renderFields(['LINE_MESSAGING_MODE', 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN'])}{renderField(canonicalSecret)}{renderFields(['LINE_WEBHOOK_ENABLED'])}
            <div className={styles.endpoint}><span>Webhook URL</span><strong>{data.webhook_url || 'รอ Public HTTPS URL'}</strong></div>
            <p>{!data.webhook_url ? 'บันทึก credentials ได้แล้ว การเปิด Webhook จริงจะทำหลังมี HTTPS' : 'ตั้ง URL นี้ใน LINE Developers แล้วทดสอบ Webhook Verify'} · ยังไม่ได้ทดสอบการเชื่อมต่อ LINE จริง</p>
          </>}
          {feedback(section)}
        </section>)}</div>
        <details className={`admin-panel ${styles.advanced}`}>
          <summary>การตั้งค่าขั้นสูง</summary>
          <p>แหล่งที่มาของค่า การตรวจการตั้งค่า และความเข้ากันได้กับระบบเดิม</p>
          {renderFields(['EASYSLIP_API_BASE_URL'])}
          {provider !== 'checkslip' && checkslip}
          {!promptpayConfigured && runtime.paymentMode !== 'PLATFORM_CENTRALIZED' && promptpay}
          <div className={styles.nested}><h3>แหล่งที่มาและค่าระบบเดิม</h3><p>Channel Secret ใช้ LINE_WEBHOOK_SECRET ก่อน แล้วจึง LINE_CHANNEL_SECRET ตาม resolver เดิม การเปลี่ยนค่าจากช่องหลักจะบันทึก LINE_WEBHOOK_SECRET โดยไม่ลบค่าเดิม</p>
            <dl className={styles.sources}>{data.fields.filter((field) => field.type !== 'fixed').map((field) => <div key={field.name}><dt>{field.name}</dt><dd>{sources[field.source]} · {field.configured ? 'มีการตั้งค่า' : 'ยังไม่ได้ตั้งค่า'}{field.source === 'DATABASE' && <button className={styles.clear} type="button" disabled={Boolean(busy)} onClick={() => save(field.section, [field.name])}>ลบค่าที่ตั้งในระบบ</button>}</dd></div>)}</dl>
          </div>
          <div className={styles.actions}><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => test()}>{busy === 'test' ? 'กำลังตรวจสอบ…' : 'ทดสอบการตั้งค่า (ไม่เรียก provider)'}</button></div>
        </details>
      </>}
    </>}
  </AdminShell>;
}
