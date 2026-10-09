'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons';
import { baht } from '../../lib/api';
import { cartChoiceLabel } from './cart-item-card';
// Reuse the existing native-dialog focus, dismissal and mobile scroll-lock lifecycle.
import { openReviewDialog as openCheckoutDialog } from '../../lib/review-dialog.mjs';
import styles from './checkout.module.css';

function outsideDialog(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
}

export const checkoutBackdrop = {
  onPointerDown(event) { event.currentTarget.dataset.backdropStart = String(outsideDialog(event)); },
  onClick(event) {
    if (event.currentTarget.dataset.backdropStart === 'true' && outsideDialog(event)) event.currentTarget.close();
    delete event.currentTarget.dataset.backdropStart;
  },
};

const checkoutErrors = {
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
  promotion_minimum_not_met: 'ยอดอาหารยังไม่ถึงขั้นต่ำของโปรโมชัน',
  promotion_unavailable: 'โปรโมชันนี้ไม่สามารถใช้ได้',
};

export function checkoutErrorMessage(error) {
  return (Object.hasOwn(checkoutErrors, error) ? checkoutErrors[error] : null) || (Object.values(checkoutErrors).includes(error) ? error : 'ไม่สามารถดำเนินการได้ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง');
}

export function CheckoutAddress({ addresses, addressId, selectedAddress, onChange, children }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className={styles.section}>
    <h2>ที่อยู่จัดส่ง</h2>
    {addresses.length ? <>
      <div className={styles.addressCard}>
        <Icon name="map" size={22} />
        <div>{selectedAddress ? <><strong>{selectedAddress.label} · {selectedAddress.dormitory_name}</strong>
          <p>ห้อง {selectedAddress.room_number}</p><p>{selectedAddress.soi_name}</p></> : <strong>เลือกที่อยู่จัดส่ง</strong>}</div>
        <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
          onClick={() => { dialog.current.showModal(); setOpen(true); dialog.current.querySelector('[aria-pressed="true"]')?.focus(); }}>เปลี่ยน</button>
      </div>
      <dialog ref={dialog} id={id} className={styles.addressDialog} aria-modal="true" aria-labelledby={`${id}-title`} {...checkoutBackdrop}
        onClose={() => { setOpen(false); trigger.current?.focus(); }}>
        <div className={styles.dialogHeading}><h2 id={`${id}-title`}>เลือกที่อยู่จัดส่ง</h2><button type="button" aria-label="ปิดตัวเลือกที่อยู่" onClick={() => dialog.current.close()}>ปิด</button></div>
        <div className={styles.addressOptions}>{addresses.map((address) => <button key={address.id} type="button"
          aria-pressed={String(address.id) === String(addressId)} onClick={() => { onChange({ target: { value: String(address.id) } }); dialog.current.close(); }}>
          <Icon name={String(address.id) === String(addressId) ? 'check' : 'map'} size={20} />
          <span><strong>{address.label} · {address.dormitory_name}</strong><small>ห้อง {address.room_number}</small><small>{address.soi_name}</small></span>
        </button>)}</div>
      </dialog>
    </> : <p className="form-error">กรุณาเพิ่มที่อยู่ในหน้าโปรไฟล์ก่อน</p>}
    {children}
  </section>;
}

export function CheckoutDeliveryNote({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef(null);
  const trigger = useRef(null);
  const restoreFocus = useRef(false);
  const id = useId();
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (restoreFocus.current) { trigger.current?.focus(); restoreFocus.current = false; }
  }, [editing]);
  function close() { restoreFocus.current = true; setEditing(false); }
  return <div className={styles.note}>
    {editing ? <>
      <label htmlFor={id}>หมายเหตุถึงคนส่ง</label>
      <textarea ref={input} id={id} value={draft} onChange={(event) => setDraft(event.target.value)}
        maxLength={1000} rows={3} placeholder="เช่น ฝากไว้ที่ล็อบบี้ หรือโทรเมื่อถึง" aria-describedby={`${id}-helper`} />
      <p id={`${id}-helper`} className={styles.helper}>หมายเหตุนี้แยกจากหมายเหตุของแต่ละเมนู</p>
      <div className={styles.noteActions}>
        <button className={styles.noteSave} type="button" onClick={() => { onChange({ target: { value: draft } }); close(); }}>บันทึก</button>
        <button type="button" onClick={close}>ยกเลิก</button>
      </div>
    </> : <>
      <div className={styles.noteHeading}>
        <h3>หมายเหตุถึงคนส่ง</h3>
        <button ref={trigger} type="button" className={styles.noteEdit} aria-expanded="false"
          aria-label={`${value ? 'แก้ไข' : 'เพิ่ม'}หมายเหตุถึงคนส่ง`}
          onClick={() => { setDraft(value); setEditing(true); }}>{value ? 'แก้ไข' : '+ เพิ่มหมายเหตุ'}</button>
      </div>
      {value && <p className={styles.noteText} title={value}>{value}</p>}
    </>}
  </div>;
}

export function CheckoutItems({ cart }) {
  return <section className={styles.section}>
    <div className={styles.sectionHeading}><h2>รายการอาหาร</h2><Link href="/cart">แก้ไข</Link></div>
    <p className={styles.merchant}>{cart.merchantName}</p>
    <div className={styles.items}>{cart.items.map((item) => <div key={item.id}>
      <div className={styles.itemDetails}><strong>{item.quantity} × {item.name}</strong>
        {!!item.choices.length && <ul>{item.choices.map((choice) => <li key={choice.id}>{cartChoiceLabel(item, choice)}</li>)}</ul>}
        {item.note && <p>หมายเหตุ: {item.note}</p>}</div>
      <strong>{baht((item.unitPriceEstimate + item.choices.reduce((sum, choice) => sum + choice.extraPrice, 0)) * item.quantity)}</strong>
    </div>)}</div>
  </section>;
}

export function CheckoutPromotion({ promotions, promotionId, onChange, loading, couponActive = false, disabled = false, pending = false }) {
  const choose = (value) => { if (!disabled) return onChange({ target: { value } }); };
  const selected = (value) => !couponActive && String(promotionId || '') === value;
  return <div className={styles.promotion}>
    <h3>โปรโมชันที่ใช้ได้</h3>
    {loading ? <p className={styles.helper} role="status">กำลังโหลดโปรโมชัน…</p> : <div className={styles.addressOptions}>
        <button type="button" disabled={disabled} aria-pressed={selected('')} onClick={() => choose('')}><Icon name={selected('') ? 'check' : 'ticket'} size={20} /><span><strong>ไม่ใช้โปรโมชัน</strong></span></button>
        {promotions.map((promotion) => <button key={promotion.id} type="button" disabled={disabled} aria-pressed={selected(String(promotion.id))} onClick={() => choose(String(promotion.id))}>
          <Icon name={selected(String(promotion.id)) ? 'check' : 'ticket'} size={20} />
          <span><strong>{promotion.name}</strong>
            <small>{promotion.promotion_type === 'PERCENTAGE' ? `ลด ${Number(promotion.value)}%` : promotion.promotion_type === 'FIXED_AMOUNT' ? `ลด ${baht(promotion.value)}` : promotion.promotion_type === 'FREE_DELIVERY' ? 'ส่งฟรี' : 'ส่วนลดตามเงื่อนไข'}</small>
            {Number(promotion.minimum_order_amount) > 0 && <small>ขั้นต่ำ {baht(promotion.minimum_order_amount)}</small>}
            {promotion.maximum_discount_amount != null && <small>สูงสุด {baht(promotion.maximum_discount_amount)}</small>}
            {promotion.ends_at && Number.isFinite(Date.parse(promotion.ends_at)) && <small>ใช้ได้ถึง {new Date(promotion.ends_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })}</small>}
          </span>
        </button>)}
      </div>}
    {pending && <p className={styles.helper} role="status">กำลังตรวจสอบส่วนลด...</p>}
  </div>;
}

export function CheckoutDiscounts({ promotions, promotionId, couponInput, couponCode, onPromotionChange, onCouponInput, onApplyCoupon, onRemoveCoupon, promotionsLoading = false, quote = null, quoting = false, pendingKind = null, discountError = '', controlsDisabled = false }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const cleanup = useRef(null);
  const applying = useRef(false);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const sheet = dialog.current;
    const update = () => {
      // Match the visible viewport when a mobile keyboard resizes/pans it.
      sheet.style.setProperty('--discount-visible-height', `${viewport.height}px`);
      sheet.style.setProperty('--discount-keyboard-offset', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
      if (sheet.contains(document.activeElement) && document.activeElement?.id === 'coupon-code') {
        document.activeElement.parentElement.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      sheet.style.removeProperty('--discount-visible-height');
      sheet.style.removeProperty('--discount-keyboard-offset');
    };
  }, [open]);
  const couponApplied = !!couponCode && quote?.coupon_snapshot?.code === couponCode;
  const couponPending = quoting && pendingKind === 'coupon';
  const couponError = !!discountError && pendingKind === 'coupon';
  const disabled = quoting || controlsDisabled;
  const applyDisabled = disabled || !couponInput.trim();
  async function apply(event) {
    event.preventDefault();
    if (applyDisabled || applying.current) return;
    applying.current = true;
    try { await onApplyCoupon(); } finally { applying.current = false; }
  }
  const safeDiscountError = ({
    invalid_coupon_code: 'โค้ดส่วนลดต้องมี 3–32 ตัวอักษร',
    coupon_unavailable: 'ไม่พบโค้ดที่พร้อมใช้งาน โค้ดอาจยังไม่เริ่มหรือหมดอายุแล้ว',
    coupon_minimum_not_met: 'ยอดสั่งซื้อยังไม่ถึงขั้นต่ำของโค้ดนี้',
    coupon_usage_limit: 'โค้ดส่วนลดนี้ถูกใช้ครบจำนวนแล้ว',
    coupon_customer_limit: 'คุณใช้โค้ดส่วนลดนี้ครบจำนวนแล้ว',
    coupon_wrong_merchant: 'โค้ดส่วนลดนี้ใช้กับร้านอื่น',
    promotion_unavailable: 'โปรโมชันนี้ยังไม่พร้อมใช้งานหรือหมดอายุแล้ว',
    promotion_minimum_not_met: 'ยอดสั่งซื้อยังไม่ถึงขั้นต่ำของโปรโมชัน',
  })[discountError] || 'ตรวจสอบส่วนลดไม่สำเร็จ กรุณาลองอีกครั้ง';
  // Presentation only: a current successful quote owns the confirmed selection.
  const displayedPromotionId = quote ? String(quote.promotion_snapshot?.id || '') : promotionId;
  const summary = quoting ? 'กำลังตรวจสอบส่วนลด...'
    : couponApplied ? `${couponCode} · ลด ${baht(quote.discount_amount)}`
      : quote?.promotion_snapshot?.name || 'เลือกโปรโมชันหรือคูปอง';
  return <section className={`${styles.section} ${styles.discountSection}`}>
    <h2 id={`${id}-label`}>ส่วนลด</h2>
    <button ref={trigger} type="button" className={styles.promotionTrigger} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={id} aria-labelledby={`${id}-label ${id}-summary`}
      onClick={() => { cleanup.current = openCheckoutDialog(dialog.current, trigger.current); setOpen(true); }}>
      <Icon name="ticket" size={20} /><span id={`${id}-summary`}>{summary}</span><Icon name="arrow" size={18} />
    </button>
    <dialog ref={dialog} id={id} className={`${styles.addressDialog} ${styles.discountDialog}`} aria-modal="true" aria-labelledby={`${id}-title`}
      onClose={() => { cleanup.current?.(); cleanup.current = null; setOpen(false); }}>
      <div className={styles.dialogHeading}><h2 id={`${id}-title`}>ส่วนลดและคูปอง</h2>
        <button data-review-close type="button" aria-label="ปิดส่วนลดและคูปอง" onClick={() => dialog.current.close()}><span aria-hidden="true">×</span></button></div>
    <CheckoutPromotion promotions={promotions} promotionId={displayedPromotionId} couponActive={couponApplied} onChange={onPromotionChange} loading={promotionsLoading} disabled={disabled} pending={quoting && pendingKind === 'promotion'} />
    <div className={styles.coupon}>{couponApplied ? <span>โค้ดส่วนลดที่ใช้</span> : <label htmlFor="coupon-code">มีโค้ดส่วนลด?</label>}
      {couponApplied ? <div className={styles.selectedDiscount} role="status"><Icon name="ticket" size={20} /><span><strong>{couponCode}</strong><small>ลด {baht(quote.discount_amount)}</small></span><button type="button" disabled={disabled} aria-label="นำคูปองออก" onClick={onRemoveCoupon}>นำออก</button></div> : <>
        <form className={styles.couponInput} onSubmit={apply}><input id="coupon-code" value={couponInput} onChange={onCouponInput} maxLength={32} placeholder="กรอกโค้ดคูปอง" autoCapitalize="characters" aria-invalid={couponError} aria-describedby={couponError ? 'checkout-coupon-error' : undefined}
          onFocus={(event) => event.currentTarget.parentElement.scrollIntoView({ block: 'nearest', behavior: 'instant' })} />
          <button type="submit" disabled={applyDisabled} aria-busy={couponPending} aria-disabled={applyDisabled}>{couponPending ? 'กำลังตรวจสอบ...' : 'ใช้โค้ด'}</button></form>
      </>}
      {discountError && <p id="checkout-coupon-error" className={styles.couponError} role="alert">{safeDiscountError}</p>}
      {quoting && pendingKind === 'remove' && <p className={styles.helper} role="status">กำลังตรวจสอบส่วนลด...</p>}
    </div>
    <p className={styles.helper}>เลือกใช้โปรโมชันหรือโค้ดส่วนลดอย่างใดอย่างหนึ่ง</p>
    </dialog>
  </section>;
}

export function CheckoutPayment() {
  return <section className={`${styles.section} ${styles.payment}`} aria-labelledby="checkout-payment-title">
    <h2 id="checkout-payment-title">วิธีชำระเงิน</h2>
    <div className={styles.paymentRow}>
      <span className={styles.paymentIcon} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" focusable="false">
          <rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="15" width="6" height="6" rx="1" /><path d="M15 13v4h6v4h-6M3 12h6m3-9v6m0 6v6m9-9v2M12 12h5" />
        </svg>
      </span>
      <div><strong>PromptPay</strong><p className={styles.helper}>จะแสดง QR หลังยืนยันออเดอร์</p></div>
    </div>
  </section>;
}

export function CheckoutTotals({ quote }) {
  return <section className={`${styles.section} ${styles.totals}`} aria-label="สรุปยอด">
    <div><span>ค่าอาหาร</span><strong>{quote ? baht(quote.subtotal_amount) : '—'}</strong></div>
    <div><span>ค่าส่ง</span><strong>{quote ? baht(quote.delivery_fee) : '—'}</strong></div>
    {quote && Number(quote.discount_amount) > 0 && <div><span>ส่วนลด {quote.coupon_snapshot ? `คูปอง ${quote.coupon_snapshot.code}` : quote.promotion_snapshot?.name || ''}</span><strong>−{baht(quote.discount_amount)}</strong></div>}
    <div className={styles.grandTotal}><span>ยอดสุทธิ</span><strong>{quote ? baht(quote.total_amount) : '—'}</strong></div>
  </section>;
}
