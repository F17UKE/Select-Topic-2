'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { financeBaht as money, inputSatang, remainingWindow, financeLabels as labels } from '../lib/finance-presentation.mjs';
import { openReviewDialog } from '../lib/review-dialog.mjs';
import { Icon } from './icons';
import styles from './merchant-finance.module.css';

const base = '/api/finance/merchant';
const date = value => value ? new Date(value).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
const state = value => labels[value] || value;
const accountFields = [
  { name:'accountType', label:'ประเภทบัญชี', options:[{value:'BANK_ACCOUNT',label:'บัญชีธนาคาร'},{value:'PROMPTPAY',label:'PromptPay'}] },
  { name:'bankCode', label:'รหัสธนาคาร / ประเภท PromptPay', helper:'รหัสธนาคาร 3 หลัก หรือ PHONE / NATIONAL_ID / TAX_ID / EWALLET' },
  { name:'accountName', label:'ชื่อบัญชี' },
  { name:'identifier', label:'เลขบัญชี / PromptPay', type:'password' },
];
const reasonFields = [{name:'reason',label:'เหตุผล',maxLength:500}];
function Badge({ value }) {
  const tone = ['PAID','VERIFIED','ACTIVE'].includes(value) ? 'good' : ['FAILED','REJECTED','REJECTED_REFUNDED'].includes(value) ? 'danger' : 'muted';
  return <span className={`${styles.badge} ${styles[tone]}`}>{state(value)}</span>;
}
function Empty({ icon='receipt', title, children }) {
  return <div className={styles.empty}><span className={styles.icon}><Icon name={icon}/></span><div><strong>{title}</strong><p>{children}</p></div></div>;
}
function Account({ account }) {
  return <div className={styles.account}><span className={styles.icon}><Icon name="receipt"/></span><div><strong>{account.account_type === 'PROMPTPAY' ? 'PromptPay' : 'บัญชีธนาคาร'} · {account.bank_code}</strong><p className={styles.accountNumber}>{account.masked_account}</p><Badge value={account.status}/></div></div>;
}

export function MerchantFinance({ request = api }) {
  const [data,setData] = useState(null), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false), [form,setForm] = useState(null), [clock,setClock] = useState(()=>Date.now());
  const pending = useRef(false), dialog = useRef(null), trigger = useRef(null);
  useEffect(()=>{let active=true; request(base).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!form || !dialog.current)return;
    const opener=trigger.current, close=openReviewDialog(dialog.current,opener);
    return()=>{close();queueMicrotask(()=>{if(opener?.isConnected && !document.querySelector('dialog[open]'))opener.focus({preventScroll:true});});};
  },[form]);
  useEffect(()=>{
    // A successful submit closes while its trigger is disabled during refresh.
    // Restore focus after the existing request/refresh finishes and enables it.
    if(!form && !busy && trigger.current?.isConnected)trigger.current.focus({preventScroll:true});
  },[form,busy]);
  function open(event,title,path,fields=[],extra={}) {
    trigger.current=event.currentTarget;setError('');setNotice('');setForm({title,path,fields,extra,key:crypto.randomUUID()});
  }
  const pendingAccount = data?.accounts.find(a=>a.status==='PENDING_VERIFICATION');
  const account = data?.accounts.find(a=>a.is_current) || pendingAccount;
  const available = BigInt(data?.balances.AVAILABLE || '0');
  const cooling = Boolean(data?.eligibility.next_eligible_at && new Date(data.eligibility.next_eligible_at).valueOf()>clock);
  const auto = data?.settlement_mode==='AUTO_3_DAYS';
  const editAccount = event=>open(event,account?'เปลี่ยนบัญชีรับเงิน':'เพิ่มบัญชีรับเงิน','/payout-accounts',accountFields);
  function withdraw(event) {
    if(available<=0n || cooling || busy)return;
    if(!account || account.status!=='VERIFIED'){editAccount(event);return;}
    open(event,'ถอนเงิน','/withdrawals',[{name:'amountSatang',label:'จำนวนถอน (บาท)',money:true}]);
  }
  const editMode = event=>open(event,'รอบการจ่าย','/settlement-mode',[],{mode:auto?'MANUAL_WITHDRAWAL':'AUTO_3_DAYS'});
  function containFocus(event) {
    if(event.key!=='Tab')return;
    const controls=Array.from(event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)'));
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey && event.target===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && event.target===last){event.preventDefault();first?.focus();}
  }
  async function submit(event) {
    event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try {
      const values=Object.fromEntries(new FormData(event.currentTarget));
      for(const field of form.fields){if(field.money)values[field.name]=inputSatang(values[field.name]);if(field.number)values[field.name]=Number(values[field.name]);}
      await request(`${base}${form.path}`,{method:'POST',headers:{'Idempotency-Key':form.key,'X-Finance-CSRF':data.csrf_token},body:JSON.stringify({...values,...form.extra})});
      setForm(null);setNotice('ดำเนินการสำเร็จ');setData(await request(base));
    } catch(e){setError(e.message);} finally {pending.current=false;setBusy(false);}
  }
  const withdrawDisabled = available<=0n || cooling || busy;
  return <div className={styles.page}>
    <p className={styles.subtitle}>ติดตามรายรับ ยอดคงเหลือ การถอนเงิน และค่าธรรมเนียมของร้าน</p>
    {!form&&error&&<p role="alert" className={styles.error}>{error}</p>}
    {notice&&<p role="status" className={styles.notice}>{notice}</p>}
    {!data ? <p role="status">{error?'โหลดข้อมูลไม่สำเร็จ กรุณาลองเปิดหน้านี้อีกครั้ง':'กำลังโหลดข้อมูลการเงิน…'}</p> : <div className={styles.grid}>
      <section className={`${styles.card} ${styles.hero}`} aria-labelledby="wallet-title">
        <span className={styles.eyebrow}>บัญชีร้านค้า</span><h2 id="wallet-title">ยอดถอนได้</h2>
        <strong className={styles.balance}>{money(data.balances.AVAILABLE)}</strong>
        <div className={styles.actions}><button className={styles.primary} onClick={withdraw} disabled={withdrawDisabled}>ถอนเงิน <Icon name="arrow" size={18}/></button><button disabled={busy} onClick={editAccount}>จัดการบัญชีรับเงิน</button></div>
        <div className={styles.eligibility}><Icon name="clock" size={18}/><div>{cooling ? <><strong>ถอนเงินได้อีกครั้ง {date(data.eligibility.next_eligible_at)}</strong><small>{remainingWindow(data.eligibility.next_eligible_at,clock)}</small></> : <><strong>{!account?'เพิ่มบัญชีรับเงินเพื่อเริ่มถอน':account.status!=='VERIFIED'?'รอการยืนยันบัญชีรับเงิน':available<=0n?'ยังไม่มียอดพร้อมถอน':'พร้อมส่งคำขอถอนเงิน'}</strong><small>ขั้นต่ำ ฿300 · ไม่มีค่าธรรมเนียม · ตรวจสอบสิทธิ์อีกครั้งเมื่อยืนยัน</small></>}</div></div>
      </section>
      <nav className={styles.quick} aria-label="การเงินทางลัด">
        <button disabled={withdrawDisabled} onClick={withdraw}><Icon name="arrow"/><span>ถอนเงิน</span></button>
        <button disabled={busy} onClick={editAccount}><Icon name="receipt"/><span>บัญชีรับเงิน</span></button>
        <button disabled={busy} onClick={editMode}><Icon name="clock"/><span>รอบการจ่าย</span></button>
      </nav>
      <section className={`${styles.card} ${styles.breakdown}`} aria-labelledby="balance-title"><h2 id="balance-title">ภาพรวมยอดเงิน</h2><div className={styles.metrics}>
        {[
          ['PENDING','รอดำเนินการ','จากออเดอร์ที่ยังไม่เสร็จ'],['RESERVED','สำรองเพื่อถอน','อยู่ระหว่างดำเนินการถอน'],['HELD','รอตรวจสอบ','พักยอดไว้เพื่อตรวจสอบ'],['DEBT','ยอดค้างชำระ','รอหักจากรายได้ในอนาคต'],['PAID_OUT','โอนให้ร้านแล้ว','ยอดโอนสำเร็จสะสม'],
        ].map(([key,title,helper])=><div key={key} className={key==='DEBT'&&BigInt(data.balances.DEBT)!==0n?styles.debt:undefined}><span>{title}</span><strong>{money(key==='PAID_OUT'?data.paid_out_satang:data.balances[key])}</strong><small>{helper}</small></div>)}
      </div></section>
      <section className={`${styles.card} ${styles.activity}`}><div className={styles.heading}><h2>รายการล่าสุด</h2><span className={styles.caption}>5 รายการล่าสุด</span></div>
        {data.transactions.length ? <ul className={styles.list}>{data.transactions.slice(0,5).map(row=><li key={row.id}><div className={styles.row}><strong>{state(row.kind)}</strong><time dateTime={row.posted_at}>{date(row.posted_at)}</time></div><small>{row.order_id?`ออเดอร์ #${row.order_id}`:`รายการ #${row.id}`}</small>
          <div className={styles.postings}>{row.postings.filter(p=>p.kind.startsWith('MERCHANT_')).map((p,i)=>{const debt=p.kind==='MERCHANT_DEBT';const increase=debt?p.side==='D':p.side==='C';return <div key={i} className={styles.row}><span>{state(p.kind.replace('MERCHANT_',''))} · {increase?'เพิ่ม':'ลด'}</span><strong className={increase&&!debt?styles.income:styles.deduction}>{increase?'+':'−'}{money(p.amount_satang)}</strong></div>;})}</div>
        </li>)}</ul> : <Empty title="ยังไม่มีความเคลื่อนไหว">เมื่อมีรายรับหรือรายการหักยอด จะแสดงที่นี่</Empty>}
      </section>
      {data.summary&&<section className={`${styles.card} ${styles.revenue}`}><h2>สรุปรายรับ</h2><p className={styles.caption}>ยอดขายที่รับชำระ · ก่อนรายการคืนเงิน</p><dl className={styles.summary}>
        <div><dt>ยอดขายอาหาร</dt><dd>{money(data.summary.gross_food_satang)}</dd></div>
        <div><dt>ส่วนลดที่ร้านออก</dt><dd>{money(-BigInt(data.summary.merchant_discount_satang))}</dd></div>
        <div><dt>ค่าธรรมเนียม GP</dt><dd>{money(-BigInt(data.summary.commission_satang))}</dd></div>
        <div className={styles.total}><dt>รายได้ร้านก่อนคืนเงิน</dt><dd>{money(data.summary.merchant_net_satang)}</dd></div>
        <div><dt>ส่วนลดที่ Platform ออก</dt><dd>{money(data.summary.platform_discount_satang)}</dd></div>
        <div><dt>ค่าโฆษณาสุทธิ</dt><dd>{money(data.summary.advertising_expense_satang)}</dd></div>
      </dl><p className={styles.caption}>ยอดนี้ไม่ใช่ยอดพร้อมถอน ดูยอดที่ถอนได้จากบัญชีด้านบน</p>
        <details className={styles.details}><summary>รายละเอียดรายได้ออเดอร์</summary>{data.snapshots.length?<ul className={styles.list}>{data.snapshots.map(row=><li key={row.order_id}><strong>ออเดอร์ #{row.order_id}</strong><dl className={styles.summary}><div><dt>อาหาร</dt><dd>{money(row.food_subtotal_satang)}</dd></div><div><dt>ค่าส่ง</dt><dd>{money(row.delivery_fee_satang)}</dd></div><div><dt>ส่วนลดร้าน</dt><dd>{money(BigInt(row.merchant_food_discount_satang)+BigInt(row.merchant_delivery_discount_satang))}</dd></div><div><dt>ส่วนลด Platform</dt><dd>{money(row.platform_subsidy_satang)}</dd></div><div><dt>GP</dt><dd>{money(row.commission_satang)}</dd></div><div><dt>รายได้ร้านก่อนคืนเงิน</dt><dd>{money(row.merchant_entitlement_satang)}</dd></div></dl></li>)}</ul>:<Empty title="ยังไม่มีรายได้จากออเดอร์">ออเดอร์ที่รับชำระแล้วจะแสดงรายละเอียดที่นี่</Empty>}</details>
      </section>}
      <section className={`${styles.card} ${styles.advertising}`}><span className={styles.icon}><Icon name="ticket"/></span><h2>โปรโมตร้าน</h2><p className={styles.caption}>Homepage Banner</p><p className={styles.price}>฿300 <span>/ 30 วัน</span></p>
        <ul className={styles.benefits}><li>แสดงบนหน้าแรก</li><li>ตรวจสอบโดย Admin ก่อนเผยแพร่</li><li>หักจากยอดถอนได้หลังยืนยัน</li></ul>
        {data.advertising.some(a=>['ACTIVE','PAID_PENDING_REVIEW'].includes(a.status)) ? <p className={styles.caption}>คุณมีแคมเปญอยู่แล้ว ดูสถานะด้านล่าง</p> : <><button className={styles.primary} disabled={busy||available<30000n||!data.banners.some(b=>['DRAFT','ARCHIVED'].includes(b.status))} onClick={event=>open(event,'ยืนยันซื้อโฆษณา ฿300','/advertising',[{name:'bannerId',label:'แบนเนอร์ที่เตรียมไว้',number:true,options:data.banners.filter(b=>['DRAFT','ARCHIVED'].includes(b.status)).map(b=>({value:b.id,label:b.title}))}],{confirm:true})}>ซื้อโฆษณา ฿300</button>{available<30000n?<p className={styles.caption}>ยอดถอนได้ไม่เพียงพอ</p>:!data.banners.some(b=>['DRAFT','ARCHIVED'].includes(b.status))&&<p className={styles.caption}>เตรียมแบนเนอร์ในเมนูแบนเนอร์ก่อนซื้อโฆษณา</p>}</>}
        <p className={styles.caption}>ก่อนเริ่มแสดงคืนเต็มจำนวน · ร้านยกเลิกหลังเริ่มแสดงไม่มีการคืนอัตโนมัติ</p>
        {data.advertising.length>0&&<ul className={styles.list}>{data.advertising.map(row=><li key={row.id}><Badge value={row.status}/><p className={styles.caption}>เริ่ม {date(row.activated_at)}<br/>สิ้นสุด {date(row.scheduled_end_at)}</p><p className={styles.caption}>ใช้บริการ {money(row.served_satang)} · คืนยอด {money(row.refunded_satang)}</p>{['ACTIVE','PAID_PENDING_REVIEW'].includes(row.status)&&<button disabled={busy} onClick={event=>open(event,'ยกเลิกโฆษณา',`/advertising/${row.id}/cancel`,reasonFields)}>ยกเลิกโฆษณา</button>}</li>)}</ul>}
      </section>
      <section className={`${styles.card} ${styles.payout}`}><div className={styles.heading}><h2>บัญชีรับเงิน</h2>{account&&<button disabled={busy} onClick={editAccount}>แก้ไข</button>}</div>{account?<Account account={account}/>:<><Empty icon="receipt" title="ยังไม่ได้เพิ่มบัญชีรับเงิน">เพิ่มบัญชีก่อนจึงจะถอนเงินได้</Empty><button disabled={busy} onClick={editAccount}>+ เพิ่มบัญชีรับเงิน</button></>}{pendingAccount&&pendingAccount.id!==account?.id&&<div className={styles.pendingAccount}><strong>บัญชีใหม่รอการยืนยัน</strong><Account account={pendingAccount}/></div>}<p className={styles.caption}>เปลี่ยนบัญชีมีช่วงพักถอน 24 ชั่วโมง และต้องยืนยันบัญชีก่อน</p></section>
      <section className={`${styles.card} ${styles.history}`}><div className={styles.heading}><h2>การถอนล่าสุด</h2><span className={styles.caption}>5 รายการล่าสุด</span></div>{data.withdrawals.length?<ul className={styles.list}>{data.withdrawals.slice(0,5).map(row=><li key={row.id}><div className={styles.row}><strong>{money(row.amount_satang)}</strong><Badge value={row.status}/></div><p className={styles.caption}>{date(row.created_at)} · คำขอ {row.id.slice(0,8)}</p><p className={styles.caption}>{row.bank_code} · {row.masked_account}</p>{row.account_review_required&&<p className={styles.warning}>บัญชีเปลี่ยน ต้องตรวจสอบอีกครั้ง</p>}{['REQUESTED','APPROVED'].includes(row.status)&&<button disabled={busy} onClick={event=>open(event,'ยกเลิกคำขอถอนเงิน',`/withdrawals/${row.id}/cancel`,reasonFields)}>ยกเลิกคำขอ</button>}</li>)}</ul>:<Empty title="ยังไม่มีประวัติการถอนเงิน">เมื่อถอนเงิน รายการจะปรากฏที่นี่</Empty>}</section>
      <section className={`${styles.card} ${styles.settings}`}><div><h2>รอบการจ่าย</h2><strong>{auto?'สร้างคำขอทุก 3 วัน':'ถอนด้วยตนเอง'}</strong><p className={styles.caption}>การโอนยังผ่านการตรวจสอบของผู้ดูแล · เว้น 72 ชั่วโมงหลังโอนสำเร็จ</p></div><button disabled={busy} onClick={editMode}>เปลี่ยนการตั้งค่า</button></section>
    </div>}
    {form&&<dialog ref={dialog} className={styles.dialog} aria-labelledby="merchant-finance-dialog-title" onKeyDown={containFocus} onClose={()=>setForm(null)}><div className={styles.heading}><h2 id="merchant-finance-dialog-title">{form.title}</h2><button type="button" data-review-close aria-label="ปิดหน้าต่าง" onClick={()=>setForm(null)}>×</button></div>
      {error&&<p role="alert" className={styles.error}>{error}</p>}
      {form.path==='/withdrawals'&&<><div className={styles.modalBalance}><span>ยอดถอนได้</span><strong>{money(data.balances.AVAILABLE)}</strong><small>ขั้นต่ำ ฿300</small></div><Account account={account}/></>}
      {form.path==='/payout-accounts'&&<p className={styles.caption}>เพิ่มบัญชีรุ่นใหม่เพื่อการตรวจสอบ · ข้อมูลเดิมแสดงเฉพาะเลขที่ปิดบัง · พักถอน 24 ชั่วโมงหลังเปลี่ยนบัญชี</p>}
      {form.path==='/settlement-mode'&&<p>เปลี่ยนเป็น{auto?'ถอนด้วยตนเอง':'สร้างคำขอทุก 3 วัน'} · เป็นการสร้างคำขอตามสิทธิ์ ไม่ใช่การโอนเข้าธนาคารอัตโนมัติ</p>}
      {form.path==='/advertising'&&<p>ยืนยันหัก ฿300 จากยอดถอนได้ สำหรับ 30 วัน · ต้องผ่านผู้ดูแลก่อนเริ่มแสดง</p>}
      {form.path.startsWith('/advertising/')&&<p>ก่อนเริ่มแสดงคืนเต็มจำนวน · ยกเลิกหลังเริ่มแสดงไม่มีการคืนอัตโนมัติ</p>}
      <form onSubmit={submit} className={styles.form}>{form.fields.map(field=><label key={field.name}>{field.label}{field.options?<select name={field.name} required defaultValue=""><option value="" disabled>เลือก</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input name={field.name} type={field.type||'text'} inputMode={field.money?'decimal':undefined} required maxLength={field.maxLength||200} autoComplete={field.type==='password'?'off':undefined}/ >}{field.helper&&<small>{field.helper}</small>}</label>)}
        <label className={styles.check}><input type="checkbox" required/>ตรวจสอบข้อมูลและยืนยันดำเนินการ</label><div className={styles.actions}><button type="button" onClick={()=>setForm(null)} disabled={busy}>ยกเลิก</button><button className={styles.primary} disabled={busy}>{busy?'กำลังดำเนินการ…':form.path==='/withdrawals'?'ยืนยันถอน':'ยืนยัน'}</button></div>
      </form>
    </dialog>}
  </div>;
}
