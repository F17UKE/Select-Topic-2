'use client';
import { snapshotChoiceLabel } from '../../../../components/merchant-snapshot-label';
import { staffErrorMessage } from '../../../../lib/staff-portal.mjs';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RiderAssignmentPicker } from '../../../../components/rider-assignment-picker';
import { LoadingCards } from '../../../../components/app-shell';
import { MerchantShell, MerchantSignIn } from '../../../../components/merchant-shell';
import { api, baht } from '../../../../lib/api';
import {
  formatStaffDate,
  staffOrderStatusLabel,
  staffPaymentStatusLabel,
} from '../../../../lib/staff-presentation.mjs';
import { useMerchantStaff } from '../../../../lib/use-merchant-staff';

export default function MerchantOrderDetailPage() {
  const { id } = useParams();
  const session = useMerchantStaff();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const pending = useRef(false);
  const [riders, setRiders] = useState([]);
  const [selectedRiderId, setSelectedRiderId] = useState('');

  useEffect(() => {
    if (!session.staff) return;
    let active = true;
    api(`/api/merchant/orders/${id}`)
      .then((result) => {
        if (active) setOrder(result.order);
      })
      .catch((requestError) => {
        if (active) setError(staffErrorMessage(requestError));
      });
    return () => {
      active = false;
    };
  }, [id, session.staff]);

  useEffect(() => {
    if (session.staff?.role !== 'MANAGER') return;
    let active = true;
    api('/api/merchant/riders')
      .then((result) => {
        if (!active) return;
        setRiders(result.riders);
        setSelectedRiderId((current) => current || String(result.riders[0]?.id || ''));
      })
      .catch((requestError) => {
        if (active) setError(staffErrorMessage(requestError));
      });
    return () => {
      active = false;
    };
  }, [session.staff]);

  async function transition(action) {
    if (pending.current) return;
    pending.current = true;
    setBusy(action);
    setError('');
    try {
      const result = await api(`/api/merchant/orders/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setOrder(result.order);
    } catch (requestError) {
      setError(staffErrorMessage(requestError));
    } finally {
      pending.current = false;
      setBusy('');
    }
  }
  async function toggleItem(item) {
    if (pending.current) return;
    pending.current = true;
    setBusy(`item-${item.id}`);
    setError('');
    try {
      const result = await api(`/api/merchant/orders/${id}/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !item.is_completed }),
      });
      setOrder(result.order);
    } catch (requestError) {
      setError(staffErrorMessage(requestError));
    } finally {
      pending.current = false;
      setBusy('');
    }
  }
  async function completeAll() {
    if (pending.current) return;
    pending.current = true;
    setBusy('complete-all-items');
    setError('');
    try {
      const result = await api(`/api/merchant/orders/${id}/complete-all-items`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setOrder(result.order);
    } catch (requestError) {
      setError(staffErrorMessage(requestError));
    } finally {
      pending.current = false;
      setBusy('');
    }
  }
  async function riderAssignment(action) {
    if (pending.current) return;
    pending.current = true;
    setBusy(action);
    setError('');
    try {
      const result = await api(`/api/merchant/orders/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'assign-rider' ? { riderId: Number(selectedRiderId) } : {}),
      });
      setOrder(result.order);
    } catch (requestError) {
      setError(staffErrorMessage(requestError));
    } finally {
      pending.current = false;
      setBusy('');
    }
  }

  if (session.loading || (session.staff && !order && !error))
    return (
      <MerchantShell session={session} staff={session.staff} title="รายละเอียดออเดอร์" showNav={false}>
        <LoadingCards />
      </MerchantShell>
    );
  if (!session.staff)
    return (
      <MerchantShell session={session} staff={session.staff} title="เข้าสู่ระบบร้านค้า" showNav={false}>
        <MerchantSignIn
          config={session.authConfig}
          loading={session.loading}
          error={session.error}
          onLogin={session.login}
        />
      </MerchantShell>
    );
  if (!order)
    return (
      <MerchantShell session={session} staff={session.staff} title="รายละเอียดออเดอร์" backHref="/merchant/orders">
        <section className="empty-state">
          <h2>ไม่พบออเดอร์</h2>
          <p>{error}</p>
        </section>
      </MerchantShell>
    );

  const role = session.staff.role;
  const canCashierAction = ['MANAGER', 'CASHIER'].includes(role);
  const canKds = ['MANAGER', 'KITCHEN'].includes(role);
  const allComplete = order.items.length > 0 && order.items.every((item) => item.is_completed);
  const riderPanel = role !== 'KITCHEN' && order.delivery_type === 'DELIVERY' && (
        <section className="merchant-panel rider-assignment-panel">
          <div className="merchant-panel-title">
            <span>การจัดส่ง</span>
            <h2>ผู้จัดส่ง</h2>
          </div>
          {order.assigned_rider ? (
            <div className="assigned-rider">
              <div>
                <strong>{order.assigned_rider.full_name}</strong>
                <small>{order.assigned_rider.phone || 'ไม่มีเบอร์โทร'}</small>
              </div>
              <span>
                {order.status === 'COMPLETED'
                  ? 'ส่งสำเร็จ'
                  : order.status === 'DELIVERING'
                    ? 'กำลังจัดส่ง'
                    : 'รับงานแล้ว'}
              </span>
            </div>
          ) : (
            <p className="muted">ยังไม่ได้มอบหมายไรเดอร์</p>
          )}
          {role === 'MANAGER' &&
            order.status === 'READY' &&
            (order.assigned_rider ? (
              <button
                className="merchant-secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => riderAssignment('unassign-rider')}
              >
                ยกเลิกการมอบหมาย
              </button>
            ) : (
              <RiderAssignmentPicker riders={riders} selectedId={selectedRiderId} onSelect={setSelectedRiderId}
                busy={Boolean(busy)} error={error} onAssign={() => riderAssignment('assign-rider')} />
            ))}
          {['DELIVERING', 'COMPLETED'].includes(order.status) && (
            <p className="ready-hint">
              {order.status === 'DELIVERING'
                ? 'เริ่มจัดส่งแล้ว จึงปิดการเปลี่ยนไรเดอร์'
                : 'ออเดอร์นี้ส่งสำเร็จแล้ว'}
            </p>
          )}
        </section>
      );
  return (
    <MerchantShell session={session} staff={session.staff} title={order.order_code} backHref="/merchant/orders">
      <section className="merchant-order-hero">
        <div>
          <span>{order.order_code}</span>
          <h1>{order.customer?.display_name || 'ออเดอร์ในครัว'}</h1>
          <p>{formatStaffDate(order.created_at)}</p>{order.total_amount !== undefined && <strong className="merchant-hero-amount">{baht(order.total_amount)}</strong>}
        </div>
        <div>
          <span className={`merchant-state state-${order.status.toLowerCase()}`}>
            {staffOrderStatusLabel(order.status)}
          </span>
          <b className={order.payment_status === 'PAID' ? 'paid-text' : 'waiting-text'}>
            {staffPaymentStatusLabel(order.payment_status)}
          </b>
        </div>
      </section>

      {order.payment_method === 'PROMPTPAY' && order.payment_status !== 'PAID' && (
        <div className="merchant-alert waiting">
          <strong>รอชำระเงิน</strong>
          <p>ร้านยังรับออเดอร์ PromptPay นี้ไม่ได้</p>
        </div>
      )}
      {order.refund_required && (
        <div className="merchant-alert danger">
          <strong>ต้องดำเนินการคืนเงินด้วยตนเอง</strong>
          <p>ออเดอร์ถูกปฏิเสธหลังชำระเงิน กรุณาติดต่อผู้เกี่ยวข้องเพื่อคืนเงิน</p>
        </div>
      )}
      {error && (
        <p className="form-error merchant-error" role="alert">
          {error}
        </p>
      )}

      {busy && <p role="status">กำลังบันทึก…</p>}
      <section className="merchant-panel action-panel">
        <div className="merchant-panel-title">
          <span>สถานะออเดอร์</span>
          <h2>จัดการออเดอร์</h2>
        </div>
        <div className="merchant-button-row">
          {order.status === 'PENDING' && canCashierAction && (
            <>
              <button
                className="merchant-primary"
                type="button"
                disabled={Boolean(busy) || order.payment_status !== 'PAID'}
                onClick={() => transition('accept')}
              >
                รับออเดอร์
              </button>
              <button
                className="merchant-danger"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => transition('reject')}
              >
                ปฏิเสธ
              </button>
            </>
          )}
          {order.status === 'ACCEPTED' && canCashierAction && (
            <button
              className="merchant-primary"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => transition('start-preparing')}
            >
              เริ่มเตรียมอาหาร
            </button>
          )}
          {order.status === 'PREPARING' && <><p>กำลังเตรียมในครัว</p><Link className="merchant-secondary" href="/merchant/kitchen">เปิด KDS</Link></>}
          {!['PENDING', 'ACCEPTED', 'PREPARING'].includes(order.status) && (
            <p className="muted">{order.status === "READY" ? "อาหารพร้อมแล้ว ตรวจสอบผู้จัดส่งด้านล่าง" : order.status === "DELIVERING" ? "ไรเดอร์กำลังจัดส่ง" : "ออเดอร์นี้สิ้นสุดแล้ว"}</p>
          )}
        </div>
      </section>

      {order.status === 'READY' && riderPanel}

      <section className="merchant-panel">
        <div className="merchant-panel-heading">
          <div className="merchant-panel-title">
            <span>ครัว</span>
            <h2>รายการอาหาร</h2>
          </div>
          <strong>
            {order.items.filter((item) => item.is_completed).length}/{order.items.length}
          </strong>
        </div>
        <div className="kds-items">
          {order.items.map((item) => (
            <article className={item.is_completed ? 'complete' : ''} key={item.id}>
              {canKds && order.status === 'PREPARING' && <button
                type="button"
                aria-label={`${item.is_completed ? 'เปิดงานอีกครั้ง' : 'ทำเสร็จ'} ${item.item_name}`}
                disabled={!canKds || order.status !== 'PREPARING' || Boolean(busy)}
                onClick={() => toggleItem(item)}
              >
                <span>{item.is_completed ? '✓' : ''}</span>
              </button>}
              <div>
                <h3>
                  {item.quantity}× {item.item_name}
                </h3>
                {item.choices.length > 0 && (
                  <p>
                    {item.choices
                      .map(
                        (choice) =>
                          snapshotChoiceLabel(item, choice),
                      )
                      .join(' · ')}
                  </p>
                )}
                {item.note && <small>โน้ตอาหาร: {item.note}</small>}
              </div>
            </article>
          ))}
        </div>
        {canKds && order.status === 'PREPARING' && !allComplete && (
          <button
            className="merchant-secondary"
            type="button"
            disabled={Boolean(busy) || allComplete}
            onClick={completeAll}
          >
            ทำเสร็จทุกรายการ
          </button>
        )}
        {allComplete && order.status === 'PREPARING' && (
          <p className="ready-hint">ครบทุกรายการแล้ว กรุณากด “อาหารพร้อมจัดส่ง” เพื่อเปลี่ยนสถานะ</p>
        )}
      </section>

      {canKds && order.status === 'PREPARING' && allComplete && <div className="merchant-ready-action"><p>ครบทุกเมนูแล้ว</p><button className="merchant-primary" disabled={Boolean(busy)} onClick={() => transition('ready')}>อาหารพร้อมจัดส่ง</button></div>}
      {order.delivery && (
        <section className="merchant-panel">
          <div className="merchant-panel-title">
            <span>ข้อมูลจัดส่ง</span>
            <h2>ที่อยู่จัดส่ง</h2>
          </div>
          <h3>
            {order.delivery.label} · {order.delivery.dormitory_name}
          </h3>
          <p>
            {order.delivery.soi_name} · ห้อง {order.delivery.room_number}
          </p>
          <p className="snapshot-lines">{order.delivery.location_text}</p>
          {order.delivery_note && <div className="notice">หมายเหตุถึงคนส่ง: {order.delivery_note}</div>}
        </section>
      )}
      {order.customer && (
        <section className="merchant-panel">
          <div className="merchant-panel-title">
            <span>ข้อมูลออเดอร์</span>
            <h2>ลูกค้า</h2>
          </div>
          <h3>{order.customer.display_name}</h3>
          {(order.delivery?.contact_phone || order.customer.phone) ? <a className="merchant-phone" href={`tel:${order.delivery?.contact_phone || order.customer.phone}`}>โทร {order.delivery?.contact_phone || order.customer.phone}</a> : <p>ไม่มีเบอร์ติดต่อ</p>}
        </section>
      )}
      {order.total_amount !== undefined && (
        <section className="merchant-panel merchant-payment-panel">
          <div className="merchant-panel-title">
            <span>การชำระเงิน</span>
            <h2>{staffPaymentStatusLabel(order.payment_status)}</h2>
          </div>
          <p>{order.payment_method === 'PROMPTPAY' ? 'PromptPay' : 'ชำระเงิน'} · {baht(order.total_amount)}</p>
        </section>
      )}
      {order.status !== 'READY' && riderPanel}
      {order.total_amount !== undefined && (
        <section className="merchant-total">
          <div>
            <span>ค่าอาหาร</span>
            <strong>{baht(order.subtotal_amount)}</strong>
          </div>
          <div>
            <span>ค่าส่ง</span>
            <strong>{baht(order.delivery_fee)}</strong>
          </div>
          {order.promotion_snapshot && (
            <div>
              <span>ส่วนลด · {order.promotion_snapshot.name}</span>
              <strong>−{baht(order.discount_amount)}</strong>
            </div>
          )}
          {order.coupon_snapshot && (
            <div>
              <span>คูปอง · {order.coupon_snapshot.code}</span>
              <strong>−{baht(order.discount_amount)}</strong>
            </div>
          )}
          <div>
            <span>ยอดรวม</span>
            <strong>{baht(order.total_amount)}</strong>
          </div>
        </section>
      )}
    </MerchantShell>
  );
}
