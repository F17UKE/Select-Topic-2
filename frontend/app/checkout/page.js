'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, LoadingCards, SignInCard } from '../../components/app-shell';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { CheckoutAddress, CheckoutDeliveryNote, CheckoutItems, CheckoutDiscounts, CheckoutTotals, CheckoutPayment, checkoutErrorMessage } from '../../components/customer/checkout-sections';
import styles from '../../components/customer/checkout.module.css';
import { Icon } from '../../components/icons';
import { api, baht } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { useCustomer } from '../../lib/use-customer';
import { requestCheckoutQuote } from '../../lib/checkout-quote.mjs';

export default function CheckoutPage() {
  const router = useRouter();
  const session = useCustomer();
  const { cart, clear } = useCart();
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [merchant, setMerchant] = useState(null);
  const [promotions, setPromotions] = useState([]);
  const [promotionId, setPromotionId] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [quoteResult, setQuoteResult] = useState(null);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [promotionsLoadedFor, setPromotionsLoadedFor] = useState(null);
  const [quoteRequest, setQuoteRequest] = useState({ pending: false, key: null, kind: null, error: '' });
  const idempotencyKey = useRef(null);
  const quoteInFlight = useRef(null);
  const confirmedQuoteKey = useRef(null);

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

  const orderPayload = useCallback(() => ({
    merchantId: cart.merchantId, addressId: Number(addressId), deliveryType: 'DELIVERY', deliveryNote,
    promotionId: promotionId ? Number(promotionId) : null,
    couponCode: couponCode || null,
    items: cart.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity, note: item.note, optionChoiceIds: item.optionChoiceIds })),
  }), [cart.merchantId, cart.items, addressId, deliveryNote, promotionId, couponCode]);

  useEffect(() => {
    if (!session.customer || !cart.merchantId) return;
    let active = true;
    api('/api/promotions?merchantId=' + cart.merchantId).then((result) => { if (active) setPromotions(result.promotions); }).catch(() => { if (active) setPromotions([]); }).finally(() => { if (active) setPromotionsLoadedFor(cart.merchantId); });
    return () => { active = false; };
  }, [session.customer, cart.merchantId]);

  const payloadKey = JSON.stringify(orderPayload());
  const quote = quoteResult?.key === payloadKey ? quoteResult.value : null;
  const displayQuote = quoteResult?.value || null;
  const quoting = quoteRequest.pending || (!!addressId && !!cart.items.length && !quote && quoteRequest.key !== payloadKey);

  const cancelQuote = useCallback(() => {
    const request = quoteInFlight.current;
    quoteInFlight.current = null;
    request?.controller.abort();
  }, []);

  const refreshQuote = useCallback(async (key, kind = 'checkout', onSuccess) => {
    // Synchronous guard also catches double-click/Enter before React renders disabled controls.
    if (quoteInFlight.current) return;
    if (kind === 'checkout' && confirmedQuoteKey.current === key) {
      setQuoteRequest({ pending: false, key, kind, error: '' });
      return;
    }
    const request = { controller: new AbortController() };
    quoteInFlight.current = request;
    setQuoteRequest({ pending: true, key, kind, error: '' });
    setError('');
    let failure = '';
    try {
      const value = await requestCheckoutQuote(key, request.controller);
      if (quoteInFlight.current !== request) return;
      confirmedQuoteKey.current = key;
      setQuoteResult({ key, value });
      onSuccess?.();
    } catch (requestError) {
      if (quoteInFlight.current !== request) return;
      failure = requestError.body?.error || 'quote_failed';
      if (kind === 'checkout') setError(failure);
    } finally {
      if (quoteInFlight.current === request) {
        quoteInFlight.current = null;
        setQuoteRequest({ pending: false, key, kind, error: failure });
      }
    }
  }, []);

  useEffect(() => {
    if (!session.customer || !addressId || !cart.items.length) return;
    // Defer the request lifecycle; StrictMode cleanup can cancel before transport starts.
    let active = true;
    queueMicrotask(() => { if (active) refreshQuote(payloadKey); });
    return () => { active = false; cancelQuote(); };
  }, [session.customer, addressId, cart.items.length, payloadKey, refreshQuote, cancelQuote]);

  function changeDiscount(nextPromotion, nextCoupon, kind) {
    if (quoting || loading || submitting || quoteInFlight.current || !addressId) return;
    if (nextPromotion === promotionId && nextCoupon === couponCode && quote) return;
    const nextPayload = { ...orderPayload(), promotionId: nextPromotion ? Number(nextPromotion) : null, couponCode: nextCoupon || null };
    return refreshQuote(JSON.stringify(nextPayload), kind, () => {
      setPromotionId(nextPromotion); setCouponCode(nextCoupon);
      if (!nextCoupon) setCouponInput('');
      idempotencyKey.current = null;
    });
  }

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
    if (!merchant?.accepting_orders || !quote || quoting || !merchant?.delivery?.available) return;
    setSubmitting(true); setError('');
    if (!idempotencyKey.current) idempotencyKey.current = globalThis.crypto.randomUUID();
    try {
      const result = await api('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify(orderPayload()),
      });
      clear();
      router.replace(`/orders/${result.order.id}/payment`);
    } catch (requestError) {
      const messages = {
        unsupported_delivery_location: 'ร้านนี้ยังไม่จัดส่งไปยังที่อยู่ที่เลือก',
        menu_item_unavailable: 'มีเมนูที่หมดหรือจำนวนไม่เพียงพอ กรุณากลับไปตรวจตะกร้า',
        option_min_choices: 'ตัวเลือกของเมนูไม่ครบ กรุณากลับไปแก้ไขรายการ',
        option_max_choices: 'เลือกตัวเลือกเกินจำนวนที่ร้านกำหนด',
        merchant_closed: 'ร้านปิดชั่วคราว ยังไม่สามารถสร้างออเดอร์ได้',
        merchant_suspended: 'ร้านนี้ถูกระงับชั่วคราว ยังไม่รับออเดอร์ใหม่',
        coupon_unavailable: 'คูปองนี้ยังไม่เริ่ม หมดอายุ หรือปิดใช้งานแล้ว',
        coupon_minimum_not_met: 'ยอดอาหารยังไม่ถึงขั้นต่ำของคูปอง',
        coupon_usage_limit: 'คูปองนี้ถูกใช้ครบจำนวนแล้ว',
        coupon_customer_limit: 'คุณใช้คูปองนี้ครบจำนวนแล้ว',
        coupon_wrong_merchant: 'คูปองนี้ใช้กับร้านอื่น',
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
    <div className={styles.page}><AppShell variant="checkout" header={detailHeader}>
      <CheckoutAddress addresses={addresses} addressId={addressId} selectedAddress={selectedAddress} onChange={changeAddress}>
        <CheckoutDeliveryNote value={deliveryNote} onChange={changeDeliveryNote} />
      </CheckoutAddress>
      <CheckoutItems cart={cart} />
      <CheckoutDiscounts promotions={promotions} promotionId={promotionId} couponInput={couponInput} couponCode={couponCode}
        promotionsLoading={promotionsLoadedFor !== cart.merchantId} quote={displayQuote} quoting={quoting}
        pendingKind={quoteRequest.kind} discountError={quoteRequest.kind !== 'checkout' ? quoteRequest.error : ''}
        controlsDisabled={loading || submitting}
        onPromotionChange={(event) => changeDiscount(event.target.value, event.target.value ? '' : couponCode, 'promotion')}
        onCouponInput={(event) => setCouponInput(event.target.value.toUpperCase())}
        onApplyCoupon={() => { const normalized = couponInput.trim().toUpperCase(); if (!normalized) return; return changeDiscount('', normalized, 'coupon'); }}
        onRemoveCoupon={() => changeDiscount(promotionId, '', 'remove')} />
      <CheckoutPayment />
      {merchant && !merchant.accepting_orders && <div className="notice error-notice">{merchant.is_active ? 'ร้านปิดชั่วคราว' : 'ร้านถูกระงับชั่วคราว'} · ไม่รับออเดอร์ใหม่</div>}
      {!displayQuote && (loading || quoting) ? <LoadingCards /> : <CheckoutTotals quote={displayQuote} />}
      {!quoting && quoteRequest.kind === 'checkout' && quoteRequest.error && <button type="button" className={styles.couponCancel} onClick={() => refreshQuote(payloadKey)}>ลองตรวจสอบยอดอีกครั้ง</button>}
      {deliveryFee === null && !loading && <div className="notice error-notice">ร้านนี้ยังไม่จัดส่งไปยังที่อยู่ที่เลือก</div>}
      {error && <p className="form-error" role="alert">{checkoutErrorMessage(error)}</p>}
      <section className={styles.confirmBar} aria-label="ยืนยันออเดอร์">
        <div><span>ยอดสุทธิ</span><strong>{displayQuote ? baht(displayQuote.total_amount) : '—'}</strong></div>
        <button type="button" disabled={submitting || loading || quoting || !quote || !merchant?.accepting_orders || deliveryFee === null || !addresses.length} aria-busy={submitting} onClick={createOrder}>{submitting ? 'กำลังสร้างออเดอร์...' : 'ยืนยันสั่งอาหาร'}</button>
      </section>
    </AppShell></div>
  );
}
