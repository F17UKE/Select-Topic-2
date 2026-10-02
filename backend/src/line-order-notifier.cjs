const { buildOrderFlexMessage } = require('./line-flex-messages.cjs');

const supportedEvents = new Set([
  'PAYMENT_VERIFIED', 'ORDER_ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'REJECTED',
]);

function safeLog(logger, event, orderId, error) {
  logger.error('LINE notification failed', { event, order_id: orderId, code: error?.code || 'line_notification_error' });
}

function createLineOrderNotifier({ db, messaging, publicAppUrl, logger = console }) {
  const sent = new Set();
  const inFlight = new Set();

  async function notifyOrderEvent(event, orderId) {
    if (!supportedEvents.has(event)) throw new Error(`Unsupported notification event: ${event}`);
    const key = `${event}:${orderId}`;
    if (sent.has(key) || inFlight.has(key)) return { sent: false, duplicate: true };
    inFlight.add(key);
    try {
      const order = await db('orders as o')
        .join('customers as c', 'c.id', 'o.customer_id')
        .join('merchants as m', 'm.id', 'o.merchant_id')
        .select('o.id', 'o.order_code', 'o.total_amount', 'o.status', 'c.line_user_id', 'm.store_name')
        .where({ 'o.id': orderId }).first();
      if (!order?.line_user_id) return { sent: false, no_recipient: true };
      const result = await messaging.push(order.line_user_id, buildOrderFlexMessage(event, order, publicAppUrl));
      if (result.sent) sent.add(key);
      return result;
    } catch (error) {
      safeLog(logger, event, orderId, error);
      return { sent: false, failed: true };
    } finally {
      inFlight.delete(key);
    }
  }
  return { notifyOrderEvent };
}

async function notifySafely(notifier, event, orderId, logger = console) {
  if (!notifier) return;
  try { await notifier.notifyOrderEvent(event, orderId); }
  catch (error) { safeLog(logger, event, orderId, error); }
}

module.exports = { createLineOrderNotifier, notifySafely, supportedEvents };
