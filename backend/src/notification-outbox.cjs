const { buildOrderFlexMessage } = require('./line-flex-messages.cjs');
const { supportedEvents } = require('./line-order-notifier.cjs');

function createNotificationOutbox({ db, messaging, publicAppUrl, logger = console, now = Date.now }) {
  const customerCopy = {
    PAYMENT_VERIFIED: ['ชำระเงินสำเร็จ', 'ตรวจสอบการชำระเงินแล้ว ร้านค้าจะเริ่มรับออเดอร์'],
    ORDER_ACCEPTED: ['ร้านรับออเดอร์แล้ว', 'ร้านค้ายืนยันออเดอร์ของคุณแล้ว'],
    PREPARING: ['กำลังเตรียมอาหาร', 'ร้านค้ากำลังจัดเตรียมรายการอาหาร'],
    READY: ['อาหารพร้อมแล้ว', 'ออเดอร์พร้อมรับหรือพร้อมส่งแล้ว'],
    DELIVERING: ['กำลังจัดส่ง', 'ไรเดอร์กำลังนำอาหารไปส่งให้คุณ'],
    COMPLETED: ['จัดส่งสำเร็จ', 'ออเดอร์เสร็จสมบูรณ์ ขอบคุณที่ใช้บริการ'],
    REJECTED: ['ร้านไม่สามารถรับออเดอร์', 'ออเดอร์ถูกปฏิเสธ โปรดตรวจสอบรายละเอียด'],
  };
  async function enqueueOrderEvent(trx, event, orderId) {
    if (!supportedEvents.has(event)) throw new Error(`Unsupported notification event: ${event}`);
    const order = await trx('orders as o')
      .join('customers as c', 'c.id', 'o.customer_id')
      .join('merchants as m', 'm.id', 'o.merchant_id')
      .select('o.id', 'o.customer_id', 'o.order_code', 'o.total_amount', 'o.status', 'c.line_user_id', 'm.store_name')
      .where({ 'o.id': orderId }).first();
    if (!order) return { queued: false, no_order: true };
    const copy = customerCopy[event];
    if (copy) {
      await trx('customer_notifications').insert({
        customer_id: order.customer_id,
        type: event,
        title: copy[0],
        message: `${copy[1]} · ${order.order_code}`,
        order_id: order.id,
        event_key: `${event}:${order.id}`,
      }).onConflict('event_key').ignore();
    }
    if (!order?.line_user_id) return { queued: false, no_recipient: true };
    const inserted = await trx('notification_outbox').insert({
      event_type: event, order_id: orderId, recipient_line_user_id: order.line_user_id,
      payload: JSON.stringify(buildOrderFlexMessage(event, order, publicAppUrl)),
      status: 'PENDING', attempts: 0, next_attempt_at: trx.fn.now(), dedupe_key: `${event}:${orderId}`,
    }).onConflict('dedupe_key').ignore().returning('id');
    return { queued: inserted.length === 1, duplicate: inserted.length === 0 };
  }

  async function claim() {
    return db.transaction(async (trx) => {
      const stale = new Date(now() - 5 * 60 * 1000);
      const row = await trx('notification_outbox')
        .where((builder) => builder.whereIn('status', ['PENDING', 'RETRY'])
          .where('next_attempt_at', '<=', new Date(now()))
          .orWhere((nested) => nested.where({ status: 'PROCESSING' }).where('updated_at', '<', stale)))
        .orderBy('id').forUpdate().skipLocked().first();
      if (!row) return null;
      await trx('notification_outbox').where({ id: row.id }).update({
        status: 'PROCESSING', attempts: row.attempts + 1, updated_at: trx.fn.now(),
      });
      return { ...row, attempts: row.attempts + 1 };
    });
  }

  async function processNext() {
    const row = await claim();
    if (!row) return { processed: false };
    try {
      const result = await messaging.push(row.recipient_line_user_id, row.payload);
      if (!result.sent && !result.disabled) {
        const error = new Error('line_notification_not_sent');
        error.code = 'line_notification_not_sent';
        throw error;
      }
      await db('notification_outbox').where({ id: row.id }).update({
        status: 'SENT', sent_at: db.fn.now(), last_error_code: null, updated_at: db.fn.now(),
      });
      return { processed: true, sent: Boolean(result.sent), disabled: Boolean(result.disabled) };
    } catch (error) {
      const delaySeconds = Math.min(3600, 5 * (2 ** Math.min(row.attempts - 1, 9)));
      await db('notification_outbox').where({ id: row.id }).update({
        status: 'RETRY', next_attempt_at: new Date(now() + delaySeconds * 1000),
        last_error_code: String(error.code || 'line_notification_error').slice(0, 120), updated_at: db.fn.now(),
      });
      logger.error('LINE outbox delivery failed', {
        outbox_id: row.id, order_id: row.order_id, event: row.event_type,
        code: error.code || 'line_notification_error',
      });
      return { processed: true, sent: false, retry: true };
    }
  }

  async function processBatch(limit = 20) {
    let processed = 0;
    for (; processed < limit; processed += 1) {
      const result = await processNext();
      if (!result.processed) break;
    }
    return processed;
  }
  return { enqueueOrderEvent, processNext, processBatch };
}

function startNotificationOutboxWorker(outbox, { intervalMs = 5000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await outbox.processBatch(); }
    finally { running = false; }
  };
  const timer = setInterval(() => run().catch(() => {}), intervalMs);
  timer.unref();
  run().catch(() => {});
  return { stop: () => clearInterval(timer), run };
}

async function enqueueNotification(notifier, trx, event, orderId) {
  if (!notifier?.enqueueOrderEvent) return false;
  await notifier.enqueueOrderEvent(trx, event, orderId);
  return true;
}

module.exports = { createNotificationOutbox, enqueueNotification, startNotificationOutboxWorker };
