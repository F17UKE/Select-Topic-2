"use client";

import Link from "next/link";
import { OrderSnapshotChoices } from "../../../components/customer/order-snapshot-choice";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { customerErrorMessage } from '../../../lib/customer-error.mjs';
import {
  AppShell,
  LoadingCards,
  SignInCard,
} from "../../../components/app-shell";
import { CustomerDetailHeader } from "../../../components/customer/detail-header";
import { Icon } from "../../../components/icons";
import { api, baht } from "../../../lib/api";
import {
  orderStatusLabel,
  paymentStatusClass,
  paymentStatusLabel,
  statusClass,
} from "../../../lib/order-presentation.mjs";
import { useCustomer } from "../../../lib/use-customer";
import { useCart } from "../../../lib/cart";
import { orderPaymentPresentation } from "../../../lib/payment-presentation.mjs";

const steps = [
  "PENDING",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "DELIVERING",
  "COMPLETED",
];

export default function OrderDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const session = useCustomer();
  const cart = useCart();
  const [order, setOrder] = useState(null);
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [reviewInfo, setReviewInfo] = useState({
    review: null,
    eligible: false,
  });
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [engagementBusy, setEngagementBusy] = useState(false);
  const [reorderResult, setReorderResult] = useState(null);
  const [engagementError, setEngagementError] = useState("");

  useEffect(() => {
    if (!session.customer) return;
    let active = true;
    api(`/api/orders/${id}`)
      .then(async (result) => {
        if (!active) return;
        setOrder(result.order);
        if (result.order.payment_method === "PROMPTPAY" && result.order.payment_status !== "PAID") {
          try {
            const paymentResult = await api(`/api/orders/${id}/payment`);
            if (active) setPayment(paymentResult.payment);
          } catch { /* Order detail remains available if the read-only payment view is temporarily unavailable. */ }
        }
        if (result.order.status === "COMPLETED")
          setReviewInfo(await api(`/api/orders/${id}/review`));
      })
      .catch((requestError) => {
        if (active) setError(customerErrorMessage(requestError));
      });
    return () => {
      active = false;
    };
  }, [id, session.customer]);

  async function submitReview(event) {
    event.preventDefault();
    setEngagementBusy(true);
    setEngagementError("");
    try {
      const result = await api(`/api/orders/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ rating, comment: reviewComment }),
      });
      setReviewInfo({ review: result.review, eligible: false });
    } catch (requestError) {
      setEngagementError(customerErrorMessage(requestError));
    } finally {
      setEngagementBusy(false);
    }
  }

  async function previewReorder() {
    setEngagementBusy(true);
    setEngagementError("");
    try {
      const result = await api(`/api/orders/${id}/reorder-preview`, {
        method: "POST",
      });
      setReorderResult(result);
      if (!result.unavailable_items.length && result.available_items.length) {
        cart.replace({
          merchantId: result.merchant_id,
          merchantName: result.merchant_name,
          items: result.available_items,
        });
        router.push("/cart");
      }
    } catch (requestError) {
      setEngagementError(customerErrorMessage(requestError));
    } finally {
      setEngagementBusy(false);
    }
  }

  function continueAvailableReorder() {
    if (!reorderResult?.available_items.length) return;
    cart.replace({
      merchantId: reorderResult.merchant_id,
      merchantName: reorderResult.merchant_name,
      items: reorderResult.available_items,
    });
    router.push("/cart");
  }

  const detailHeader = (
    <CustomerDetailHeader
      title={order?.order_code || "รายละเอียดออเดอร์"}
      backHref="/orders"
    />
  );
  if (session.loading || (session.customer && !order && !error)) {
    return (
      <AppShell variant="order-detail" header={detailHeader}>
        <LoadingCards />
      </AppShell>
    );
  }
  if (!session.customer) {
    return (
      <AppShell variant="order-detail" header={detailHeader}>
        <SignInCard
          config={session.authConfig}
          loading={session.loading}
          error={session.error}
          onLogin={session.devLogin}
        />
      </AppShell>
    );
  }
  if (error) {
    return (
      <AppShell variant="order-detail" header={detailHeader}>
        <section className="empty-state">
          <h1>ไม่พบออเดอร์นี้</h1>
          <p>{error}</p>
        </section>
      </AppShell>
    );
  }

  const activeIndex = steps.indexOf(order.status);
  const terminal = ["CANCELLED", "REJECTED"].includes(order.status);
  const paymentView = orderPaymentPresentation(order, payment);
  const { paid, processing: reconciling, status: visiblePaymentStatus } = paymentView;

  return (
    <AppShell variant="order-detail" header={detailHeader}>
      <section className="order-summary-card">
        <div className="order-summary-heading">
          <div>
            <h1>{order.store_name}</h1>
            <p>{order.order_code}</p>
          </div>
          <span className={`order-status ${statusClass(order.status)}`}>
            {orderStatusLabel(order.status)}
          </span>
        </div>
        <div className="order-payment-state">
          <span>สถานะการชำระเงิน</span>
          <strong
            className={`payment-status ${paymentStatusClass(visiblePaymentStatus)}`}
          >
            {paymentStatusLabel(visiblePaymentStatus)}
          </strong>
        </div>
      </section>

      {order.payment_method === "PROMPTPAY" && (
        <section className="order-section-card" aria-label="การชำระเงิน">
          {paid ? <p>ชำระเงินแล้ว · PromptPay · {baht(order.total_amount)}</p>
            : reconciling ? <><p>กำลังตรวจสอบการชำระเงิน · ไม่ต้องชำระซ้ำ</p><Link className="secondary-button inline-link" href={`/orders/${id}/payment`}>ดูสถานะการตรวจสอบ</Link></>
              : paymentView.canPay && <Link className="primary-button inline-link" href={`/orders/${id}/payment`}>ชำระเงิน</Link>}
        </section>
      )}

      <section className="order-section-card order-timeline-card">
        <h2>สถานะออเดอร์</h2>
        {terminal ? (
          <div className="terminal-status">
            <Icon name="receipt" />
            <div>
              <strong>{orderStatusLabel(order.status)}</strong>
              <p>ออเดอร์นี้สิ้นสุดแล้ว</p>
            </div>
          </div>
        ) : (
          <ol className="status-timeline">
            {steps.map((step, index) => {
              const stepState =
                (index < activeIndex || order.status === "COMPLETED")
                  ? "complete"
                  : index === activeIndex
                    ? "current"
                    : "future";
              return (
                <li className={stepState} key={step}>
                  <span>
                    {(index < activeIndex || order.status === "COMPLETED") ? (
                      <Icon name="check" size={14} />
                    ) : null}
                  </span>
                  <div>
                    <strong>{orderStatusLabel(step)}</strong>
                    {index === activeIndex && <small>สถานะปัจจุบัน</small>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section className="order-section-card">
        <h2>รายการอาหาร</h2>
        <div className="order-detail-items">
          {order.items.map((item) => (
            <article key={item.id}>
              <div>
                <strong>
                  {item.quantity} × {item.item_name}
                </strong>
                {item.choices.length > 0 && (
                  <OrderSnapshotChoices item={item} merchantId={order.merchant_id} />
                )}
                {item.note && <small>หมายเหตุ: {item.note}</small>}
              </div>
              <strong>{baht(item.line_total)}</strong>
            </article>
          ))}
        </div>
      </section>
      {order.delivery_type === "DELIVERY" && (
        <section className="order-section-card delivery-info-card">
          <h2>ข้อมูลจัดส่ง</h2>
          <div className="delivery-address-heading">
            <span>
              <Icon name="map" size={20} />
            </span>
            <div>
              <strong>
                {order.delivery_address_label} · {order.delivery_dormitory_name}
              </strong>
              <p>
                {order.delivery_soi_name} · ห้อง {order.delivery_room_number}
              </p>
            </div>
          </div>
          {order.delivery_location_text && (
            <p className="snapshot-lines">{order.delivery_location_text}</p>
          )}
          {order.delivery_note && (
            <div className="delivery-note">
              <span>หมายเหตุถึงคนส่ง</span>
              <p>{order.delivery_note}</p>
            </div>
          )}
          {order.delivery_contact_phone && (
            <a
              className="delivery-phone"
              href={`tel:${order.delivery_contact_phone}`}
            >
              <Icon name="phone" size={18} />
              โทร {order.delivery_contact_phone}
            </a>
          )}
        </section>
      )}
      <section className="order-price-summary">
        <div>
          <span>ค่าอาหาร</span>
          <strong>{baht(order.subtotal_amount)}</strong>
        </div>
        <div>
          <span>ค่าจัดส่ง</span>
          <strong>{baht(order.delivery_fee)}</strong>
        </div>
        {Number(order.discount_amount) > 0 && order.promotion_snapshot && (
          <div>
            <span>ส่วนลด · {order.promotion_snapshot.name}</span>
            <strong>−{baht(order.discount_amount)}</strong>
          </div>
        )}
        {Number(order.discount_amount) > 0 && order.coupon_snapshot && (
          <div>
            <span>คูปอง · {order.coupon_snapshot.code}</span>
            <strong>−{baht(order.discount_amount)}</strong>
          </div>
        )}
        <div className="grand-total">
          <span>ยอดสุทธิ</span>
          <strong>{baht(order.total_amount)}</strong>
        </div>
      </section>
      {order.status === "COMPLETED" && (
        <section className="order-section-card order-engagement-card">
          <div className="order-engagement-heading">
            <div>
              <p>กลับมาอร่อยอีกครั้ง</p>
              <h2>รีวิวหรือสั่งเมนูเดิม</h2>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={engagementBusy}
              onClick={previewReorder}
            >
              สั่งอีกครั้ง
            </button>
          </div>
          {engagementError && (
            <p className="form-error" role="alert">
              {engagementError}
            </p>
          )}
          {reorderResult?.changed_prices.length > 0 && (
            <div className="notice">
              ราคาบางรายการมีการเปลี่ยนแปลง ระบบใช้ราคาปัจจุบันในตะกร้า
            </div>
          )}
          {reorderResult?.unavailable_items.length > 0 && (
            <div className="reorder-warning">
              <strong>เพิ่มบางรายการไม่ได้</strong>
              {reorderResult.unavailable_items.map((item) => (
                <p key={item.order_item_id}>
                  {item.item_name} ·{" "}
                  {item.reason === "OPTION_MISSING"
                    ? `ตัวเลือกเดิมไม่มีแล้ว (${item.missing_options.join(", ")})`
                    : "เมนูไม่พร้อมจำหน่าย"}
                </p>
              ))}
              {reorderResult.available_items.length > 0 && (
                <button type="button" onClick={continueAvailableReorder}>
                  เพิ่มเฉพาะรายการที่พร้อม
                </button>
              )}
            </div>
          )}
          {reviewInfo.review ? (
            <div className="submitted-review">
              <strong>{"★".repeat(reviewInfo.review.rating)}</strong>
              <p>
                {reviewInfo.review.comment || "ให้คะแนนโดยไม่เพิ่มความคิดเห็น"}
              </p>
            </div>
          ) : reviewInfo.eligible ? (
            <form className="review-form" onSubmit={submitReview}>
              <fieldset>
                <legend>ให้คะแนนร้าน</legend>
                <div className="star-input">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={value <= rating ? "is-active" : ""}
                      onClick={() => setRating(value)}
                      aria-label={`${value} ดาว`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>
                ความคิดเห็น (ไม่บังคับ)
                <textarea
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="อาหารและบริการเป็นอย่างไรบ้าง"
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={engagementBusy}
              >
                ส่งรีวิว
              </button>
            </form>
          ) : null}
        </section>
      )}
    </AppShell>
  );
}
