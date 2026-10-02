'use client';

import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../../components/app-shell';
import { CustomerDetailHeader } from '../../../components/customer/detail-header';
import { Icon } from '../../../components/icons';
import { api, ApiError, baht } from '../../../lib/api';
import { maskPaymentIdentifier, orderStatusLabel, paymentStatusClass, paymentStatusLabel, statusClass } from '../../../lib/order-presentation.mjs';
import { useCustomer } from '../../../lib/use-customer';

const steps = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED'];
const paymentMessages = {
  AMOUNT_MISMATCH: 'ยอดโอนในสลิปไม่ตรงกับยอดออเดอร์',
  RECIPIENT_MISMATCH: 'บัญชีผู้รับในสลิปไม่ตรงกับร้านค้า',
  DUPLICATE_TRANSACTION_REFERENCE: 'สลิปนี้ถูกใช้ชำระออเดอร์อื่นแล้ว',
  mock_provider_error: 'ผู้ให้บริการตรวจสลิปขัดข้อง กรุณาลองใหม่',
  checkslip_not_configured: 'ระบบตรวจสลิปยังไม่พร้อมใช้งาน',
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const session = useCustomer();
  const [order, setOrder] = useState(null);
  const [paymentResult, setPaymentResult] = useState(null);
  const [qr, setQr] = useState(null);
  const [file, setFile] = useState(null);
  const [mockScenario, setMockScenario] = useState('success');
  const [paymentAction, setPaymentAction] = useState('');
  const [error, setError] = useState('');
  const [paymentError, setPaymentError] = useState('');

  async function loadOrder() {
    const result = await api(`/api/orders/${id}`);
    setOrder(result.order);
    return result.order;
  }

  async function preparePayment(currentOrder) {
    if (currentOrder.payment_method !== 'PROMPTPAY') return;
    setPaymentAction('loading');
    try {
      let current;
      try {
        current = await api(`/api/orders/${id}/payment`);
      } catch (requestError) {
        if (!(requestError instanceof ApiError) || requestError.status !== 404) throw requestError;
        if (currentOrder.payment_status === 'PAID') throw requestError;
        current = await api(`/api/orders/${id}/payments`, { method: 'POST', body: JSON.stringify({}) });
      }
      setPaymentResult(current);
      if (current.payment.status !== 'FAILED' && current.payment.status !== 'PAID') {
        setQr((await api(`/api/orders/${id}/payment/qr`)).qr);
      }
    } catch (requestError) {
      setPaymentError(requestError.message);
    } finally {
      setPaymentAction('');
    }
  }

  useEffect(() => {
    if (!session.customer) return;
    let active = true;
    api(`/api/orders/${id}`).then(async (result) => {
      if (!active) return;
      setOrder(result.order);
      await preparePayment(result.order);
    }).catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
    // preparePayment is intentionally scoped to this page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session.customer]);

  async function retryPayment() {
    setPaymentAction('loading');
    setPaymentError('');
    try {
      const result = await api(`/api/orders/${id}/payments`, { method: 'POST', body: JSON.stringify({}) });
      setPaymentResult(result);
      setQr((await api(`/api/orders/${id}/payment/qr`)).qr);
      await loadOrder();
    } catch (requestError) {
      setPaymentError(requestError.message);
    } finally {
      setPaymentAction('');
    }
  }

  async function uploadSlip(event) {
    event.preventDefault();
    if (!file) return setPaymentError('กรุณาเลือกรูปสลิป');
    setPaymentAction('uploading');
    setPaymentError('');
    const form = new FormData();
    form.append('slip', file);
    if (paymentResult?.verification_mode === 'mock') form.append('mockScenario', mockScenario);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setPaymentAction('verifying');
      const result = await api(`/api/orders/${id}/payment/slip`, { method: 'POST', body: form });
      setPaymentResult(result);
      setOrder((await api(`/api/orders/${id}`)).order);
      if (result.payment.status === 'PAID') setQr(null);
    } catch (requestError) {
      setPaymentError(requestError.message);
    } finally {
      setPaymentAction('');
    }
  }

  const detailHeader = <CustomerDetailHeader title={order?.order_code || 'รายละเอียดออเดอร์'} backHref="/orders" />;
  if (session.loading || (session.customer && !order && !error)) {
    return <AppShell variant="order-detail" header={detailHeader}><LoadingCards /></AppShell>;
  }
  if (!session.customer) {
    return <AppShell variant="order-detail" header={detailHeader}><SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} /></AppShell>;
  }
  if (error) {
    return <AppShell variant="order-detail" header={detailHeader}><section className="empty-state"><h1>ไม่พบออเดอร์นี้</h1><p>{error}</p></section></AppShell>;
  }

  const activeIndex = steps.indexOf(order.status);
  const terminal = ['CANCELLED', 'REJECTED'].includes(order.status);
  const payment = paymentResult?.payment;
  const verificationFailure = payment?.verification?.failure_code;
  const paid = order.payment_status === 'PAID' || payment?.status === 'PAID';
  const visiblePaymentStatus = paid
    ? 'PAID'
    : ['uploading', 'verifying'].includes(paymentAction)
      ? 'PROCESSING'
      : order.payment_status;
  const showMockTools = process.env.NODE_ENV !== 'production' && paymentResult?.verification_mode === 'mock';

  return (
    <AppShell variant="order-detail" header={detailHeader}>
      <section className="order-summary-card">
        <div className="order-summary-heading"><div><h1>{order.store_name}</h1><p>{order.order_code}</p></div><span className={`order-status ${statusClass(order.status)}`}>{orderStatusLabel(order.status)}</span></div>
        <div className="order-payment-state"><span>สถานะการชำระเงิน</span><strong className={`payment-status ${paymentStatusClass(visiblePaymentStatus)}`}>{paymentStatusLabel(visiblePaymentStatus)}</strong></div>
      </section>

      {order.payment_method === 'PROMPTPAY' && !terminal && (
        <section className={`payment-card ${paid ? 'paid' : ''}`} aria-live="polite">
          <div className="payment-heading">
            <div><p>ชำระเงิน</p><h2>{paid ? 'ชำระเงินเรียบร้อย' : 'ยอดที่ต้องชำระ'}</h2></div>
            <span className="payment-mark"><Icon name={paid ? 'check' : 'receipt'} /></span>
          </div>
          {paid ? (
            <div className="payment-success"><strong>{baht(order.total_amount)}</strong><p>ระบบตรวจสอบการชำระเงินเรียบร้อยแล้ว</p></div>
          ) : payment?.status === 'FAILED' ? (
            <div className="payment-failed">
              <strong>{payment?.verification_status === 'ERROR' ? 'ตรวจสลิปไม่สำเร็จ' : 'สลิปไม่ผ่านการตรวจสอบ'}</strong>
              <p>{paymentMessages[verificationFailure] || verificationFailure || 'กรุณาลองชำระอีกครั้ง'}</p>
              <button className="primary-button" type="button" onClick={retryPayment} disabled={Boolean(paymentAction)}>สร้างรายการชำระใหม่</button>
            </div>
          ) : (
            <>
              <div className="payment-amount-row"><span>PromptPay</span><strong>{baht(order.total_amount)}</strong></div>
              {qr && <div className="promptpay-qr"><Image src={qr.image_data_url} alt={`PromptPay QR สำหรับ ${qr.merchant.store_name}`} width={280} height={280} unoptimized /><p>{qr.merchant.store_name}</p><small>{maskPaymentIdentifier(qr.merchant.promptpay_identifier)}</small><strong>{baht(qr.amount)}</strong></div>}
              {paymentAction === 'loading' && <p className="payment-progress">กำลังเตรียม QR สำหรับชำระเงิน…</p>}
              <form className="slip-form" onSubmit={uploadSlip}>
                <span className="slip-form-title">อัปโหลดสลิป</span>
                <input className="slip-file-input" id={`slip-file-${id}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} disabled={Boolean(paymentAction)} />
                <label className="slip-file-picker" htmlFor={`slip-file-${id}`}><Icon name="upload" size={19} /><span>{file ? file.name : 'เลือกรูปสลิป'}</span></label>
                <small>รองรับ PNG, JPEG และ WebP ขนาดไม่เกิน 5 MB</small>
                {showMockTools && <label className="mock-scenario"><span>Developer tool · Local mock scenario</span>
                  <select value={mockScenario} onChange={(event) => setMockScenario(event.target.value)} disabled={Boolean(paymentAction)}>
                    <option value="success">Success</option><option value="amount_mismatch">Amount mismatch</option>
                    <option value="recipient_mismatch">Recipient mismatch</option><option value="duplicate_reference">Duplicate reference</option>
                    <option value="provider_error">Provider error</option>
                  </select>
                </label>}
                <button className="primary-button" type="submit" disabled={!file || Boolean(paymentAction)}>
                  {paymentAction === 'uploading' ? 'กำลังอัปโหลด…' : paymentAction === 'verifying' ? 'กำลังตรวจสอบสลิป…' : 'อัปโหลดและตรวจสอบ'}
                </button>
              </form>
            </>
          )}
          {paymentError && <p className="form-error">{paymentError}</p>}
        </section>
      )}

      <section className="order-section-card order-timeline-card">
        <h2>สถานะออเดอร์</h2>
        {terminal ? <div className="terminal-status"><Icon name="receipt" /><div><strong>{orderStatusLabel(order.status)}</strong><p>ออเดอร์นี้สิ้นสุดแล้ว</p></div></div> : <ol className="status-timeline">{steps.map((step, index) => { const stepState = index < activeIndex ? 'complete' : index === activeIndex ? 'current' : 'future'; return <li className={stepState} key={step}><span>{index < activeIndex ? <Icon name="check" size={14} /> : null}</span><div><strong>{orderStatusLabel(step)}</strong>{index === activeIndex && <small>สถานะปัจจุบัน</small>}</div></li>; })}</ol>}
      </section>
      <section className="order-section-card"><h2>รายการอาหาร</h2><div className="order-detail-items">{order.items.map((item) => <article key={item.id}><div><strong>{item.quantity} × {item.item_name}</strong>{item.choices.length > 0 && <p>{item.choices.map((choice) => `${choice.choice_name}${choice.extra_price ? ` +${baht(choice.extra_price)}` : ''}`).join(' · ')}</p>}{item.note && <small>หมายเหตุ: {item.note}</small>}</div><strong>{baht(item.line_total)}</strong></article>)}</div></section>
      {order.delivery_type === 'DELIVERY' && <section className="order-section-card delivery-info-card"><h2>ข้อมูลจัดส่ง</h2><div className="delivery-address-heading"><span><Icon name="map" size={20} /></span><div><strong>{order.delivery_address_label} · {order.delivery_dormitory_name}</strong><p>{order.delivery_soi_name} · ห้อง {order.delivery_room_number}</p></div></div>{order.delivery_location_text && <p className="snapshot-lines">{order.delivery_location_text}</p>}{order.delivery_note && <div className="delivery-note"><span>หมายเหตุถึงคนส่ง</span><p>{order.delivery_note}</p></div>}{order.delivery_contact_phone && <a className="delivery-phone" href={`tel:${order.delivery_contact_phone}`}><Icon name="phone" size={18} />โทร {order.delivery_contact_phone}</a>}</section>}
      <section className="order-price-summary"><div><span>ค่าอาหาร</span><strong>{baht(order.subtotal_amount)}</strong></div><div><span>ค่าจัดส่ง</span><strong>{baht(order.delivery_fee)}</strong></div><div className="grand-total"><span>ยอดรวม</span><strong>{baht(order.total_amount)}</strong></div></section>
    </AppShell>
  );
}
