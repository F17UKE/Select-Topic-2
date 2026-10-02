'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, LoadingCards, SignInCard } from '../../components/app-shell';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { Icon } from '../../components/icons';
import { api, baht } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { useCustomer } from '../../lib/use-customer';

export default function CheckoutPage() {
  const router = useRouter();
  const session = useCustomer();
  const { cart, estimatedSubtotal, clear } = useCart();
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [merchant, setMerchant] = useState(null);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const idempotencyKey = useRef(null);

  const loadQuote = useCallback(async (nextAddressId) => {
    if (!cart.merchantId || !nextAddressId) return;
    setLoading(true); setError('');
    try {
      const result = await api(`/api/merchants/${cart.merchantId}?addressId=${nextAddressId}`);
      setMerchant(result.merchant);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [cart.merchantId]);

  useEffect(() => {
    if (!session.customer || !cart.items.length) return;
    let active = true;
    api('/api/customer/addresses').then(async (result) => {
      if (!active) return;
      setAddresses(result.addresses);
      const selected = result.addresses.find((address) => address.is_default)?.id || result.addresses[0]?.id || '';
      setAddressId(String(selected));
      if (selected) await loadQuote(selected);
      else setLoading(false);
    }).catch((requestError) => { if (active) { setError(requestError.message); setLoading(false); } });
    return () => { active = false; };
  }, [session.customer, cart.items.length, loadQuote]);

  function changeAddress(event) {
    const next = event.target.value;
    setAddressId(next);
    idempotencyKey.current = null;
    loadQuote(next);
  }

  function changeDeliveryNote(event) {
    setDeliveryNote(event.target.value);
    idempotencyKey.current = null;
  }

  async function createOrder() {
    if (!merchant?.delivery?.available) return;
    setSubmitting(true); setError('');
    if (!idempotencyKey.current) idempotencyKey.current = globalThis.crypto.randomUUID();
    try {
      const result = await api('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({
          merchantId: cart.merchantId,
          addressId: Number(addressId),
          deliveryType: 'DELIVERY',
          deliveryNote,
          items: cart.items.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            note: item.note,
            optionChoiceIds: item.optionChoiceIds,
          })),
        }),
      });
      clear();
      router.replace(`/orders/${result.order.id}`);
    } catch (requestError) {
      const messages = {
        unsupported_delivery_location: 'ร้านนี้ยังไม่จัดส่งไปยังที่อยู่ที่เลือก',
        menu_item_unavailable: 'มีเมนูที่หมดหรือจำนวนไม่เพียงพอ กรุณากลับไปตรวจตะกร้า',
        option_min_choices: 'ตัวเลือกของเมนูไม่ครบ กรุณากลับไปแก้ไขรายการ',
        option_max_choices: 'เลือกตัวเลือกเกินจำนวนที่ร้านกำหนด',
        merchant_closed: 'ร้านปิดชั่วคราว ยังไม่สามารถสร้างออเดอร์ได้',
      };
      setError(messages[requestError.body?.error] || requestError.message);
    } finally { setSubmitting(false); }
  }

  const detailHeader = <CustomerDetailHeader title="ตรวจสอบออเดอร์" backHref="/cart" />;
  if (session.loading) return <AppShell variant="checkout" header={detailHeader}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell variant="checkout" header={detailHeader}><SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} /></AppShell>;
  if (!cart.items.length) return <AppShell variant="checkout" header={detailHeader}><section className="empty-state cart-empty"><span><Icon name="cart" size={38} /></span><h1>ไม่มีรายการสำหรับตรวจสอบ</h1><p>เพิ่มอาหารลงตะกร้าก่อนสร้างออเดอร์</p></section></AppShell>;

  const deliveryFee = merchant?.delivery?.available ? merchant.delivery.fee : null;
  const selectedAddress = addresses.find((address) => String(address.id) === addressId);
  return (
    <AppShell variant="checkout" header={detailHeader}>
      <section className="checkout-section checkout-address-section">
        <div className="checkout-section-title"><span><Icon name="map" size={20} /></span><div><p>ที่อยู่จัดส่ง</p>{selectedAddress && <><h1>{selectedAddress.label} · {selectedAddress.dormitory_name}</h1><small>ห้อง {selectedAddress.room_number}</small></>}</div></div>
        {addresses.length ? <label className="checkout-address-select"><span className="sr-only">เลือกที่อยู่จัดส่ง</span><select value={addressId} onChange={changeAddress} aria-label="เลือกที่อยู่จัดส่ง">{addresses.map((address) => <option key={address.id} value={address.id}>{address.label} · {address.dormitory_name} · ห้อง {address.room_number}</option>)}</select><Icon name="chevronDown" size={18} /></label> : <p className="form-error">กรุณาเพิ่มที่อยู่ในหน้าโปรไฟล์ก่อน</p>}
      </section>
      <section className="checkout-section checkout-order-section"><div className="checkout-section-title"><span><Icon name="receipt" size={20} /></span><div><p>รายการอาหาร</p><h2>{cart.merchantName}</h2></div></div><div className="checkout-items">{cart.items.map((item) => <div key={item.id}><span><b>{item.quantity} × {item.name}</b>{!!item.choices.length && <small>{item.choices.map((choice) => choice.name).join(' · ')}</small>}{item.note && <small>หมายเหตุ: {item.note}</small>}</span><strong>{baht((item.unitPriceEstimate + item.choices.reduce((sum, choice) => sum + choice.extraPrice, 0)) * item.quantity)}</strong></div>)}</div></section>
      <section className="checkout-section checkout-note-section"><label>หมายเหตุถึงคนส่ง<textarea value={deliveryNote} onChange={changeDeliveryNote} maxLength={1000} rows={3} placeholder="เช่น ฝากไว้ที่ล็อบบี้ หรือโทรเมื่อถึง" /></label><p className="helper-text">หมายเหตุนี้แยกจากหมายเหตุของแต่ละเมนู</p></section>
      {loading ? <LoadingCards /> : <section className="checkout-total"><div><span>ค่าอาหาร</span><strong>{baht(estimatedSubtotal)}</strong></div><div><span>ค่าจัดส่ง {merchant?.delivery?.soi_name || 'ที่อยู่ที่เลือก'}</span><strong>{deliveryFee === null ? 'ไม่รองรับ' : baht(deliveryFee)}</strong></div><div className="grand-total"><span>ยอดรวม</span><strong>{deliveryFee === null ? '—' : baht(estimatedSubtotal + deliveryFee)}</strong></div></section>}
      {deliveryFee === null && !loading && <div className="notice error-notice">ร้านนี้ยังไม่จัดส่งไปยังที่อยู่ที่เลือก</div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button order-submit" type="button" disabled={submitting || loading || deliveryFee === null || !addresses.length} aria-busy={submitting} onClick={createOrder}>{submitting ? 'กำลังสร้างออเดอร์…' : 'ยืนยันสั่งอาหาร'}</button>
    </AppShell>
  );
}
