'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../../../components/app-shell';
import { CustomerDetailHeader } from '../../../../components/customer/detail-header';
import { api, baht } from '../../../../lib/api';
import { useCustomer } from '../../../../lib/use-customer';
import { Icon } from '../../../../components/icons';
import { paymentErrorMessage, validateSlipFile, paymentNeedsReconciliation, savePaymentQr } from '../../../../lib/payment-presentation.mjs';
import styles from './payment.module.css';

export default function PaymentPage() {
  const { id } = useParams();
  const router = useRouter();
  const session = useCustomer();
  const [order, setOrder] = useState(null);
  const [result, setResult] = useState(null);
  const [qr, setQr] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scenario, setScenario] = useState('success');
  const [uncertain, setUncertain] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const [qrHelp, setQrHelp] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconciliationNonce, setReconciliationNonce] = useState(0);
  const picker = useRef(null);
  const latestPayment = useRef(null);
  const unresolved = useRef(false);
  const generation = useRef(0);
  const reconciliationStarted = useRef(0);
  const reconciliationRequested = useRef(false);
  const inFlight = useRef(false);
  const upload = useRef(null);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const currentOrder = String(order?.id) === String(id);
  const paid = currentOrder && (order?.payment_status === 'PAID' || result?.payment?.status === 'PAID');
  const terminal = ['REJECTED', 'CANCELLED', 'COMPLETED'].includes(order?.status);
  const reconciliationAvailable = Boolean(result?.payment?.reconciliation_available);
  const reconciliationRequired = Boolean(result?.payment?.reconciliation_required);
  const processing = paymentNeedsReconciliation(result?.payment) || uncertain || reconciling
    || (!result && order?.payment_status === 'PENDING_VERIFICATION');
  const mock = ['development', 'test'].includes(process.env.NODE_ENV) && result?.verification_mode === 'mock';
  const diagnostic = result?.payment?.verification?.diagnostic;

  useEffect(() => {
    if (!session.customer) return;
    generation.current++;
    inFlight.current = false; unresolved.current = false;
    let active = true;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const deadline = setTimeout(() => controller.abort(), 15000);
    async function load() {
      try {
        const response = await api(`/api/orders/${id}`, options);
        if (!active) return;
        setResult(null); setQr(null); setFile(null); setError(''); setUncertain(false); setPollStopped(false);
        latestPayment.current = null; reconciliationStarted.current = 0; reconciliationRequested.current = false;
        setOrder(response.order);
        if (response.order.payment_status === 'PAID' || ['REJECTED', 'CANCELLED', 'COMPLETED'].includes(response.order.status)) return;
        let attempt;
        try { attempt = await api(`/api/orders/${id}/payment`, options); }
        catch (failure) {
          if (failure.status !== 404) throw failure;
          attempt = await api(`/api/orders/${id}/payments`, { ...options, method: 'POST', body: '{}' });
        }
        if (!active) return;
        latestPayment.current = attempt.payment;
        setResult(attempt);
      } catch (failure) {
        if (active) setError(failure.status === 404 ? 'ไม่พบออเดอร์นี้' : paymentErrorMessage(failure.body?.error));
      } finally { clearTimeout(deadline); }
    }
    load();
    return () => { active = false; controller.abort(); clearTimeout(deadline); upload.current?.abort(); invalidate(); };
  }, [id, session.customer, invalidate]);

  useEffect(() => {
    if (!paid) return;
    const timer = setTimeout(() => router.replace(`/orders/${id}`), 1100);
    return () => clearTimeout(timer);
  }, [paid, id, router]);

  // Poll durable state only; a lost response never automatically uploads the file again.
  useEffect(() => {
    if (!processing || paid || busy || pollStopped) return;
    let active = true;
    const controller = new AbortController();
    if (!reconciliationStarted.current) reconciliationStarted.current = Date.now();
    const deadline = setTimeout(() => controller.abort(), 12000);
    const timer = setTimeout(async () => {
      try {
        const current = await api(`/api/orders/${id}/payment`, { signal: controller.signal });
        if (!active) return;
        unresolved.current = false; latestPayment.current = current.payment;
        setResult(current); setUncertain(false);
        if (paymentNeedsReconciliation(current.payment) && Date.now() - reconciliationStarted.current >= 70000) {
          setPollStopped(true);
        } else if (current.payment.status === 'FAILED') {
          setError(paymentErrorMessage(current.payment.verification?.failure_code));
        } else { setError(''); }
      } catch {
        if (active) { setPollStopped(true); setError(paymentErrorMessage()); }
      } finally { clearTimeout(deadline); }
    }, 2000);
    return () => { active = false; controller.abort(); clearTimeout(timer); clearTimeout(deadline); };
  }, [processing, paid, busy, pollStopped, result, id]);

  useEffect(() => {
    if (!currentOrder || !result || paid || processing || reconciliationAvailable || terminal || qr) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    api(`/api/orders/${id}/payment/qr`, { signal: controller.signal })
      .then((response) => { if (active) setQr(response.qr); })
      .catch(() => { if (active) setError(paymentErrorMessage()); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [currentOrder, result, paid, processing, reconciliationAvailable, terminal, qr, id]);

  useEffect(() => {
    if (!currentOrder || !reconciliationAvailable || (!reconciliationRequired && reconciliationNonce === 0)
      || paid || terminal || busy || reconciliationRequested.current) return;
    reconciliationRequested.current = true;
    let active = true;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 70000);
    setReconciling(true); setError(''); setPollStopped(false);
    api(`/api/orders/${id}/payment/reconcile`, { method: 'POST', body: '{}', signal: controller.signal })
      .then((current) => {
        if (!active) return;
        latestPayment.current = current.payment; setResult(current); setUncertain(false);
        if (current.payment.status === 'FAILED') {
          setError(paymentErrorMessage(current.payment.verification?.failure_code));
          setPollStopped(true);
        }
      })
      .catch((failure) => {
        if (!active) return;
        setError(paymentErrorMessage(failure.body?.error)); setPollStopped(true);
      })
      .finally(() => { clearTimeout(deadline); if (active) setReconciling(false); });
    return () => { active = false; controller.abort(); clearTimeout(deadline); };
  }, [currentOrder, reconciliationAvailable, reconciliationRequired, paid, terminal, busy, id, reconciliationNonce]);

  async function uploadAndVerify(selected) {
    if (!selected || inFlight.current || unresolved.current || !currentOrder || paid || processing || reconciliationAvailable || terminal
      || latestPayment.current?.status === 'PAID' || paymentNeedsReconciliation(latestPayment.current)) return;
    const invalid = validateSlipFile(selected);
    if (invalid) { setError(invalid); return; }
    inFlight.current = true;
    const version = generation.current;
    const active = () => generation.current === version;
    setFile(selected); setBusy(true); setError(''); setPollStopped(false);
    reconciliationStarted.current = 0;
    const controller = new AbortController();
    upload.current = controller;
    const timer = setTimeout(() => controller.abort(), 70000);
    try {
      const attempt = await api(`/api/orders/${id}/payments`, { method: 'POST', body: '{}', signal: controller.signal });
      if (!active()) return;
      latestPayment.current = attempt.payment;
      if (attempt.payment.status === 'PAID' || paymentNeedsReconciliation(attempt.payment)) { setResult(attempt); return; }
      const body = new FormData(); body.append('slip', selected);
      if (mock) body.append('mockScenario', scenario);
      const verified = await api(`/api/orders/${id}/payment/slip`, { method: 'POST', body, signal: controller.signal });
      if (!active()) return;
      latestPayment.current = verified.payment;
      setResult(verified);
      if (verified.payment.status !== 'PAID' && !paymentNeedsReconciliation(verified.payment)) setError(paymentErrorMessage(verified.payment.verification?.failure_code));
    } catch (failure) {
      if (!active()) return;
      setError(paymentErrorMessage(failure.body?.error));
      // Until a bounded status read succeeds, don't offer a second upload.
      unresolved.current = true; setUncertain(true);
      const reconcile = new AbortController();
      upload.current = reconcile;
      const deadline = setTimeout(() => reconcile.abort(), 10000);
      try {
        const current = await api(`/api/orders/${id}/payment`, { signal: reconcile.signal });
        if (active()) { unresolved.current = false; latestPayment.current = current.payment; setResult(current); setUncertain(false); }
      } catch { if (active()) setPollStopped(true); }
      finally { clearTimeout(deadline); }
    } finally {
      clearTimeout(timer);
      if (active()) { upload.current = null; inFlight.current = false; setBusy(false); }
    }
  }

  function selectSlip(event) {
    const selected = event.target.files?.[0];
    event.target.value = ''; // Allows the same file after failure or transient network errors.
    return uploadAndVerify(selected);
  }

  function retryReconciliation() {
    reconciliationRequested.current = false;
    reconciliationStarted.current = 0;
    setPollStopped(false);
    setError('');
    setReconciliationNonce((value) => value + 1);
  }

  const saveQr = async () => {
    const outcome = await savePaymentQr(qr?.image_data_url, order.order_code);
    if (outcome !== 'cancelled') setQrHelp(true);
  };

  const header = <CustomerDetailHeader title="ชำระเงิน" backHref={`/orders/${id}`} />;
  return <div className={styles.surface}><AppShell variant="payment" header={header} hideBottomNav>
    {session.loading ? <LoadingCards /> : !session.customer
      ? <SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} />
      : !currentOrder ? (error ? <p className={styles.error} role="alert">{error}</p> : <LoadingCards />)
      : <section className={styles.page}>
        {paid ? <div className={styles.success} role="status" aria-live="polite"><Icon name="check" size={40} /><h1>ชำระเงินสำเร็จ</h1><strong className={styles.amount}>{baht(order.total_amount)}</strong><p>ตรวจสอบการชำระเงินเรียบร้อยแล้ว</p><p>กำลังไปหน้าสถานะออเดอร์…</p><Link href={`/orders/${id}`}>ดูสถานะออเดอร์</Link></div>
          : terminal ? <p>ออเดอร์นี้สิ้นสุดแล้ว <Link href={`/orders/${id}`}>ดูออเดอร์</Link></p>
            : <>
              <div className={styles.primaryCard}>
              <h1>{order.store_name}</h1><p className={styles.code}>ออเดอร์ {order.order_code}</p><p className={styles.amountLabel}>ยอดที่ต้องชำระ</p><strong className={styles.amount}>{baht(order.total_amount)}</strong>
                    {!busy && !processing && !reconciliationAvailable && qr && <div className={styles.qr}><Image src={qr.image_data_url} alt={`QR Code PromptPay สำหรับชำระเงิน ${baht(order.total_amount)}`} width={280} height={280} unoptimized /><span>สแกน QR เพื่อชำระ {baht(qr.amount)}</span><small>PromptPay · {qr.merchant.promptpay_identifier}</small><button type="button" className={styles.saveQr} onClick={saveQr}><Icon name="upload" size={18} />บันทึก QR</button>{qrHelp && <details className={styles.qrHelp}><summary>บันทึกไม่ได้? เปิดรูปสำหรับบันทึก</summary><p>แตะรูปค้างเพื่อบันทึกหรือแชร์ตามที่อุปกรณ์รองรับ</p><Image src={qr.image_data_url} alt="รูป QR สำหรับบันทึก" width={280} height={280} unoptimized /></details>}</div>}
              </div>
              {busy ? <div className={styles.processing} role="status" aria-live="polite"><span className={styles.spinner} aria-hidden="true" /><h2>กำลังตรวจสอบการชำระเงิน</h2><p>กำลังตรวจสอบยอดเงินและข้อมูลผู้รับ…</p><small>กรุณารอสักครู่</small>{file && <p className={styles.filename}>{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>}</div>
                : processing ? <div className={styles.processing} role="status" aria-live="polite"><h2>ได้รับข้อมูลการชำระเงินแล้ว</h2><p>ระบบกำลังยืนยันรายการของคุณ</p><p>ไม่ต้องอัปโหลดสลิปซ้ำ</p>{pollStopped && <><p>ยังยืนยันสถานะล่าสุดไม่ได้ กรุณาตรวจสอบอีกครั้ง</p><button type="button" onClick={retryReconciliation}>ตรวจสอบสถานะอีกครั้ง</button></>}<Link href={`/orders/${id}`}>ดูสถานะออเดอร์</Link></div>
                  : <>
                    {error && <div className={styles.error} role="alert"><h2>ตรวจสอบการชำระเงินไม่สำเร็จ</h2><p>{error}</p>{reconciliationAvailable && <button type="button" onClick={retryReconciliation}>ตรวจสอบสลิปเดิมอีกครั้ง</button>}</div>}
                    {qr && !reconciliationAvailable && <div className={styles.form}>
                      <h2>อัปโหลดหลักฐานการชำระเงิน</h2>
                      <input ref={picker} id="payment-slip" className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-label="เลือกรูปสลิป" aria-describedby="slip-help" disabled={busy || processing || paid} onChange={selectSlip} />
                      <button type="button" className={styles.picker} onClick={() => picker.current?.click()} aria-describedby="slip-help"><Icon name="upload" size={28} /><strong>{error ? 'เลือกรูปสลิปใหม่' : 'เลือกรูปสลิป'}</strong><small id="slip-help">JPG, PNG หรือ WebP · ไม่เกิน 4 MB</small></button>
                      <p className={styles.autoHint}>เลือกรูปแล้วตรวจสอบอัตโนมัติ</p>
                    </div>}
                      {qr && (mock || diagnostic) && <details className={styles.devTools}><summary>Developer tools</summary>
                        {mock && <label>Local mock scenario<select value={scenario} onChange={(event) => setScenario(event.target.value)}>{['success', 'amount_mismatch', 'recipient_mismatch', 'duplicate_reference', 'invalid_slip', 'provider_error'].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>}
                        {diagnostic && <dl><dt>Verification stage</dt><dd>{diagnostic.stage || 'UNKNOWN'}</dd><dt>Provider code</dt><dd>{diagnostic.provider_code || 'NONE'}</dd><dt>HTTP status</dt><dd>{diagnostic.http_status || 'NETWORK'}</dd><dt>Request ID</dt><dd>{diagnostic.request_id || 'NONE'}</dd></dl>}
                      </details>}
                    {!qr && error && <Link href={`/orders/${id}`}>กลับไปหน้าสถานะออเดอร์</Link>}
                  </>}
            </>}
      </section>}
  </AppShell></div>;
}
