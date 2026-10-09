'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { financeBaht as money, inputSatang, remainingWindow, financeLabels as labels } from '../lib/finance-presentation.mjs';
import styles from './finance-panel.module.css';

const date = value => value ? new Date(value).toLocaleString('th-TH') : '—';
const state = value => labels[value] || value;
const password = { name:'password', label:'ยืนยันรหัสผ่าน Super Admin', type:'password' };
const reason = { name:'reason', label:'เหตุผล', maxLength:500 };
function Table({ headers, rows, render }) { return <div className={styles.table}>{rows?.length ? <table><thead><tr>{headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id || i}>{render(r)}</tr>)}</tbody></table> : <p>ยังไม่มีรายการ</p>}</div>; }

export function FinancePanel({ admin = false, owner = false, mutate = api }) {
  const scope = admin ? 'admin' : 'merchant', base = `/api/finance/${scope}`;
  const [data,setData]=useState(null), [error,setError]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false), [form,setForm]=useState(null);
  const pending=useRef(false), formElement=useRef(null);
  const [destination,setDestination]=useState(null);
  const [clock,setClock]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(!destination)return;const hide=()=>setDestination(null),timer=setTimeout(hide,60000);window.addEventListener('blur',hide);return()=>{clearTimeout(timer);window.removeEventListener('blur',hide);};},[destination]);
  const load=useCallback(async()=>{ const result=await api(base);setData(result);return result; },[base]);
  useEffect(()=>{let active=true;api(base).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[base]);
  useEffect(()=>{if(form)formElement.current?.querySelector('input,select')?.focus();},[form]);
  function open(title,path,fields=[],extra={}) { setDestination(null);setError('');setNotice('');setForm({title,path,fields,extra,key:crypto.randomUUID()}); }
  async function submit(event) {
    event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try {
      const values=Object.fromEntries(new FormData(event.currentTarget));
      if (values.proof?.size) {
        const payload=new FormData();payload.append('proof',values.proof);
        const uploaded=await mutate(`${base}/proofs`,{method:'POST',body:payload});values.proofKey=uploaded.object_key;
      }
      delete values.proof;
      for(const f of form.fields) if(f.money)values[f.name]=inputSatang(values[f.name]);
      for(const f of form.fields) if(f.number)values[f.name]=Number(values[f.name]);
      for(const f of form.fields) if(f.type==='checkbox')values[f.name]=values[f.name]==='on';
      const path=form.path.replace('ORDER',encodeURIComponent(values.orderId || ''));
      delete values.orderId;
      const result=await mutate(`${base}${path}`,{method:'POST',headers:{'Idempotency-Key':form.key,...(!admin?{'X-Finance-CSRF':data.csrf_token}:{})},body:JSON.stringify({...values,...form.extra})});
      if(path.endsWith('/reveal'))setDestination(result);
      setForm(null);setNotice(result.issues === undefined ? 'ดำเนินการสำเร็จ' : `ตรวจสอบแล้ว พบ ${result.issues} รายการที่ต้องตรวจสอบ`);await load();
    } catch(e) {setError(e.message);} finally {pending.current=false;setBusy(false);}
  }
  const action=(title,path,fields,extra)=> <button disabled={busy} onClick={()=>open(title,path,fields,extra)}>{title}</button>;
  const paidFields=[{name:'reference',label:'เลขอ้างอิงธนาคาร (จำเป็น)',maxLength:160},{name:'proof',label:'หลักฐาน private (ไม่บังคับ) · JPG, PNG, WebP ไม่เกิน 4 MB',type:'file',optional:true},password];
  return <div className={styles.panel}>
    {error&&<div className={styles.error} role="alert">{error}</div>}{notice&&<div className={styles.notice} role="status">{notice}</div>}
    {destination&&<section className={styles.section}><h2>บัญชีสำหรับตรวจสอบ / โอนเงิน</h2><p>{destination.bank_code} · {destination.account_name}</p><p>{destination.identifier}</p><p>ซ่อนอัตโนมัติภายใน 60 วินาที หรือเมื่อออกจากหน้าต่าง</p><button onClick={()=>setDestination(null)}>ซ่อนทันที</button></section>}
    {form&&<section className={styles.section} aria-labelledby="finance-form-title"><h2 id="finance-form-title">{form.title}</h2><form ref={formElement} className={styles.form} onSubmit={submit}>
      {form.fields.map(f=><label key={f.name} className={f.type==='checkbox'?styles.check:undefined}>{f.label}{f.options?<select name={f.name} required defaultValue=""><option value="" disabled>เลือก</option>{f.options.map(o=><option value={o.value??o} key={o.value??o}>{o.label??o}</option>)}</select>:<input name={f.name} type={f.type||'text'} required={f.optional!==true} maxLength={f.maxLength||200} accept={f.type==='file'?'image/jpeg,image/png,image/webp':undefined} inputMode={f.money?'decimal':undefined} autoComplete={f.type==='password'?'off':undefined} />}</label>)}
      <label className={styles.check}><input type="checkbox" required />ตรวจสอบข้อมูลและยืนยันดำเนินการ</label><div className={styles.actions}><button className={styles.primary} disabled={busy}>{busy?'กำลังดำเนินการ…':'ยืนยัน'}</button><button type="button" disabled={busy} onClick={()=>setForm(null)}>ยกเลิก</button></div>
    </form></section>}
    {!data ? <p role="status">กำลังโหลดข้อมูลการเงิน…</p> : <>
      <section className={styles.metrics}>{admin ? [
        ['GMV อาหาร',data.summary.gmv_satang],['GP รับรู้แล้ว',data.accounts.find(a=>a.kind==='COMMISSION_REVENUE')?.balance||'0'],
        ['หนี้ร้านพร้อมถอน',data.accounts.find(a=>a.kind==='MERCHANT_AVAILABLE')?.balance||'0'],['ยอดถอนรอดำเนินการ',data.accounts.find(a=>a.kind==='MERCHANT_RESERVED')?.balance||'0'],
        ['ค่าโฆษณารับรู้แล้ว',data.accounts.find(a=>a.kind==='AD_REVENUE')?.balance||'0'],['ค่าโฆษณารอรับรู้',data.accounts.find(a=>a.kind==='AD_DEFERRED')?.balance||'0'],
        ['ภาระจ่ายร้านรอส่งสำเร็จ',data.accounts.find(a=>a.kind==='MERCHANT_PENDING')?.balance||'0'],['จ่ายร้านแล้ว',data.summary.paid_out_satang],['คืนลูกค้าแล้ว',data.summary.refunded_satang],
        ['ยอดร้านรอตรวจสอบ',data.accounts.find(a=>a.kind==='MERCHANT_HELD')?.balance||'0'],['ลูกหนี้ร้านค้า',-BigInt(data.accounts.find(a=>a.kind==='MERCHANT_DEBT')?.balance||'0')],
      ].map(([k,v])=><article key={k}><span>{k}</span><strong>{money(v)}</strong></article>) : Object.entries({...data.balances, PAID_OUT:data.paid_out_satang}).map(([k,v])=><article key={k}><span>{state(k)}</span><strong>{money(v)}</strong></article>)}</section>
      {!admin&&<section className={styles.section}><h2>ถอนเงินและรอบการจ่าย</h2><p>ขั้นต่ำ ฿300 · ไม่มีค่าธรรมเนียม · เว้น 72 ชั่วโมงหลังโอนสำเร็จ</p><p>เวลาถัดไปตาม hold/cooldown: {date(data.eligibility.next_eligible_at)}</p><p>{remainingWindow(data.eligibility.next_eligible_at,clock)}</p><p>เปลี่ยนบัญชีรับเงินมีช่วงพักถอน 24 ชั่วโมง และต้องยืนยันบัญชีก่อน</p><div className={styles.actions}>
        {action('ขอถอนเงิน','/withdrawals',[{name:'amountSatang',label:'จำนวนเงิน (บาท)',money:true}])}
        {action(data.settlement_mode==='AUTO_3_DAYS'?'เปลี่ยนเป็นถอนด้วยตนเอง':'เปิดสร้างคำขอทุก 3 วัน','/settlement-mode',[],{mode:data.settlement_mode==='AUTO_3_DAYS'?'MANUAL_WITHDRAWAL':'AUTO_3_DAYS'})}
      </div><p>รอบปัจจุบัน: {data.settlement_mode==='AUTO_3_DAYS'?'สร้างคำขอทุก 3 วัน':'ถอนด้วยตนเอง'} · การโอนยังผ่านการตรวจสอบของผู้ดูแล</p></section>}
      {admin&&owner&&<section className={styles.section}><h2>การรับเงิน Platform</h2><p>โหมดปัจจุบัน: {data.runtime.mode} · เปลี่ยนเฉพาะออเดอร์ใหม่ ออเดอร์เดิมใช้ผู้รับเดิม</p><div className={styles.actions}>{action('เปิด Platform / สร้างผู้รับรุ่นใหม่','/configure',[
        {name:'promptpayType',label:'ประเภท PromptPay',options:['PHONE','NATIONAL_ID','TAX_ID','EWALLET']},{name:'promptpayId',label:'หมายเลข PromptPay',type:'password'},
        {name:'displayName',label:'ชื่อแสดงผู้รับ'},{name:'bankCode',label:'รหัสธนาคาร 3 หลัก'},{name:'bankNumber',label:'บัญชีธนาคารที่ผูก PromptPay',type:'password'},password,
      ],{mode:'PLATFORM_CENTRALIZED',confirm:true})}{action('ใช้ Merchant Direct สำหรับออเดอร์ใหม่','/configure',[password],{mode:'LEGACY_MERCHANT_DIRECT',confirm:true})}</div><p>ไม่เปลี่ยนโหมดอัตโนมัติ และไม่ย้ายยอดเก่าเข้าบัญชี Platform</p></section>}
      <section className={styles.section}><h2>บัญชีรับเงินร้านค้า</h2>{!admin&&action('เพิ่ม / เปลี่ยนบัญชี','/payout-accounts',[
        {name:'accountType',label:'ประเภทบัญชี',options:['BANK_ACCOUNT','PROMPTPAY']},{name:'bankCode',label:'รหัสธนาคาร / ประเภท PromptPay'},{name:'accountName',label:'ชื่อบัญชี'},{name:'identifier',label:'เลขบัญชี / PromptPay',type:'password'},
      ])}<Table headers={['ร้าน / บัญชี','สถานะ','จัดการ']} rows={admin?data.payout_accounts:data.accounts} render={r=><><td>{admin&&<small>ร้าน #{r.merchant_id}</small>}{r.bank_code} · {r.masked_account}</td><td>{state(r.status)}</td><td>{owner&&action('ดูบัญชีเพื่อยืนยัน',`/destinations/payout-accounts/${r.id}/reveal`,[password])}{owner&&r.status==='PENDING_VERIFICATION'&&action('ยืนยันบัญชี',`/payout-accounts/${r.id}/verify`,[password])}</td></>} /></section>
      <section className={styles.section}><h2>รายการถอนเงิน</h2><Table headers={['รายการ','ยอดถอน','สถานะ','จัดการ']} rows={admin?data.payouts:data.withdrawals} render={r=><><td>{r.id.slice(0,8)}<small>{date(r.created_at)}{admin&&` · ${r.store_name || `ร้าน #${r.merchant_id}`}`}</small></td><td>{money(r.amount_satang)}<small>{r.bank_code} {r.masked_account}</small></td><td>{state(r.status)}{r.account_review_required&&<small>บัญชีเปลี่ยน ต้องตรวจสอบ</small>}</td><td><div className={styles.actions}>
        {admin&&r.status==='REQUESTED'&&<>{action('อนุมัติ',`/withdrawals/${r.id}/approve`)}{action('ปฏิเสธ',`/withdrawals/${r.id}/reject`,[reason])}</>}
        {admin&&r.status==='APPROVED'&&action('เริ่มดำเนินการโอน',`/withdrawals/${r.id}/processing`)}
        {owner&&r.status==='PROCESSING'&&<>{action('ดูบัญชีปลายทาง',`/destinations/payout-accounts/${r.payout_account_id}/reveal`,[password])}{action('ยืนยันโอนสำเร็จ',`/withdrawals/${r.id}/paid`,paidFields)}{action('ยืนยันไม่มีการโอน',`/withdrawals/${r.id}/failed`,[reason,password,{name:'confirmNoTransfer',label:'ตรวจสอบแล้วไม่มีเงินออกจากบัญชี',type:'checkbox'}])}</>}
        {!admin&&['REQUESTED','APPROVED'].includes(r.status)&&action('ยกเลิกคำขอ',`/withdrawals/${r.id}/cancel`,[reason])}
      </div></td></>} /></section>
      <section className={styles.section}><h2>โปรโมตร้าน · Homepage Banner</h2><p>฿300 / 30 วัน · หักจากยอดพร้อมใช้เมื่อยืนยัน · ต้องผ่านผู้ดูแลก่อนเผยแพร่</p><p>ก่อนเริ่มแสดงคืนเต็มจำนวน · ร้านยกเลิกหลังเริ่มแสดงไม่มีการคืนอัตโนมัติ</p>
        {!admin&&action('ซื้อโฆษณา ฿300','/advertising',[{name:'bannerId',label:'แบนเนอร์ของร้านที่เตรียมไว้',number:true,options:data.banners.filter(b=>['DRAFT','ARCHIVED'].includes(b.status)).map(b=>({value:b.id,label:b.title}))}],{confirm:true})}
        <Table headers={['รายการ','สถานะ','บริการ / คืนยอด','จัดการ']} rows={data.advertising} render={r=><><td>{r.id.slice(0,8)}<small>{date(r.activated_at)}</small></td><td>{state(r.status)}</td><td>{money(r.served_satang)} / {money(r.refunded_satang)}</td><td><div className={styles.actions}>
          {admin&&r.status==='PAID_PENDING_REVIEW'&&<>{action('อนุมัติและเริ่มแสดง',`/advertising/${r.id}/activate`)}{action('ปฏิเสธ / คืนยอด',`/advertising/${r.id}/reject`,[reason])}</>}
          {admin&&r.status==='ACTIVE'&&action('ยุติโดย Platform / คืนส่วนที่ยังไม่แสดง',`/advertising/${r.id}/terminate`,[reason])}
          {!admin&&['ACTIVE','PAID_PENDING_REVIEW'].includes(r.status)&&action('ยกเลิกโฆษณา',`/advertising/${r.id}/cancel`,[reason])}
        </div></td></>} /></section>
      {admin&&<section className={styles.section}><h2>คืนเงินและตรวจสอบบัญชี</h2><div className={styles.actions}>{owner&&<button onClick={()=>open('บันทึกคืนเงิน','/orders/ORDER/refunds',[{name:'orderId',label:'Order ID'},{name:'foodSatang',label:'มูลค่าอาหารก่อนส่วนลดที่คืน (บาท)',money:true},{name:'deliverySatang',label:'ค่าส่งที่คืน (บาท; 0 หากไม่รวม)',money:true},{name:'destinationBankCode',label:'รหัสธนาคารผู้รับคืน 3 หลัก'},{name:'destinationIdentifier',label:'บัญชีคืนเงินที่ตรวจสอบกับลูกค้าแล้ว',type:'password'},{name:'destinationName',label:'ชื่อบัญชีคืนเงิน'},reason,password])}>บันทึกคืนเงินตามส่วนประกอบ</button>}{action('ตรวจสอบความสอดคล้องของบัญชี','/reconcile')}</div>
        <Table headers={['ออเดอร์','คืนลูกค้า','สถานะ','จัดการ']} rows={data.refunds} render={r=><><td>#{r.order_id}</td><td>{money(r.customer_refund_satang)}</td><td>{state(r.status)}</td><td>{owner&&r.destination_masked&&action('ดูบัญชีคืนเงิน',`/destinations/refunds/${r.id}/reveal`,[password])}{owner&&r.status==='APPROVED'&&action('เริ่มโอนคืน',`/refunds/${r.id}/processing`,[password])}{owner&&r.status==='PROCESSING'&&action('ยืนยันโอนคืนแล้ว',`/refunds/${r.id}/paid`,paidFields)}</td></>} />
        <h3>รายการที่ต้องตรวจสอบ</h3><Table headers={['ประเภท','สถานะ']} rows={data.cases} render={r=><><td>{r.kind}</td><td>{r.status}</td></>} />
      </section>}
      {!admin&&<>{data.summary&&<section className={styles.section}><h2>สรุปยอดขายที่รับชำระ</h2><p>ยอดก่อนรายการคืนเงิน · ยอดที่ถอนได้ดูจากบัญชีด้านบน</p><div className={styles.metrics}>{[['อาหาร',data.summary.gross_food_satang],['ส่วนลดร้าน',data.summary.merchant_discount_satang],['ส่วนลด Platform',data.summary.platform_discount_satang],['GP',data.summary.commission_satang],['รายได้ร้านก่อนคืน',data.summary.merchant_net_satang],['ค่าโฆษณาสุทธิ',data.summary.advertising_expense_satang]].map(([k,v])=><article key={k}><span>{k}</span><strong>{money(v)}</strong></article>)}</div></section>}<section className={styles.section}><h2>รายได้จากออเดอร์</h2><Table headers={['ออเดอร์','อาหาร','ส่วนลดร้าน / Platform','GP','รายได้ร้าน']} rows={data.snapshots} render={r=><><td>#{r.order_id}</td><td>{money(r.food_subtotal_satang)}</td><td>{money(BigInt(r.merchant_food_discount_satang)+BigInt(r.merchant_delivery_discount_satang))} / {money(r.platform_subsidy_satang)}</td><td>{money(r.commission_satang)}</td><td>{money(r.merchant_entitlement_satang)}</td></>} /></section>
      <section className={styles.section}><h2>ประวัติการเงิน</h2><Table headers={['รายการ','บัญชี / เดบิต / เครดิต','เวลา']} rows={data.transactions} render={r=><><td>{state(r.kind)}<small>#{r.id}</small></td><td>{r.postings.map((p,i)=><small key={i}>{p.kind} · {p.side==='D'?'เดบิต':'เครดิต'} {money(p.amount_satang)}</small>)}</td><td>{date(r.posted_at)}</td></>} /></section></>}
    </>}
  </div>;
}
