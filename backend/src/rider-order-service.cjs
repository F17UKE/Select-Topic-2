const { HttpError } = require('./http.cjs');
const { notifySafely } = require('./line-order-notifier.cjs');
const { enqueueNotification } = require('./notification-outbox.cjs');

function requireRider(staff) {
  if (staff.role !== 'RIDER') throw new HttpError(403, 'rider_role_required');
}

function createRiderOrderService(db, { notifier } = {}) {
  async function assignedOrder(query, staff, orderId, { lock = false } = {}) {
    requireRider(staff);
    let builder = query('orders as o')
      .join('customers as c', 'c.id', 'o.customer_id')
      .select(
        'o.id', 'o.order_code', 'o.merchant_id', 'o.delivery_type', 'o.status',
        'o.delivery_address_label', 'o.delivery_soi_name', 'o.delivery_dormitory_name',
        'o.delivery_location_text', 'o.delivery_room_number', 'o.delivery_contact_phone',
        'o.delivery_note', 'o.created_at', 'o.updated_at', 'o.delivering_at', 'o.completed_at',
        'c.display_name as customer_display_name',
      )
      .where({ 'o.id': orderId, 'o.merchant_id': staff.merchant_id, 'o.assigned_rider_id': staff.id });
    if (lock) builder = builder.forUpdate('o');
    const order = await builder.first();
    if (!order) throw new HttpError(404, 'rider_order_not_found');
    return order;
  }

  async function summaries(query, orderIds) {
    if (!orderIds.length) return [];
    return query('order_items')
      .select('id', 'order_id', 'item_name', 'quantity')
      .whereIn('order_id', orderIds).orderBy('id');
  }

  function present(order, items) {
    return {
      id: order.id,
      order_code: order.order_code,
      delivery_type: order.delivery_type,
      status: order.status,
      customer_name: order.customer_display_name,
      delivery: order.delivery_type === 'DELIVERY' ? {
        label: order.delivery_address_label,
        soi_name: order.delivery_soi_name,
        dormitory_name: order.delivery_dormitory_name,
        location_text: order.delivery_location_text,
        room_number: order.delivery_room_number,
        contact_phone: order.delivery_contact_phone,
      } : null,
      delivery_note: order.delivery_note,
      items: items.filter((item) => item.order_id === order.id)
        .map(({ id, item_name, quantity }) => ({ id, item_name, quantity })),
      created_at: order.created_at,
      updated_at: order.updated_at,
      delivering_at: order.delivering_at,
      completed_at: order.completed_at,
    };
  }

  async function listOrders(staff) {
    requireRider(staff);
    const orders = await db('orders as o')
      .join('customers as c', 'c.id', 'o.customer_id')
      .select(
        'o.id', 'o.order_code', 'o.delivery_type', 'o.status', 'o.delivery_address_label',
        'o.delivery_soi_name', 'o.delivery_dormitory_name', 'o.delivery_location_text',
        'o.delivery_room_number', 'o.delivery_contact_phone', 'o.delivery_note',
        'o.created_at', 'o.updated_at', 'o.delivering_at', 'o.completed_at', 'c.display_name as customer_display_name',
      )
      .where({ 'o.merchant_id': staff.merchant_id, 'o.assigned_rider_id': staff.id })
      .whereIn('o.status', ['READY', 'DELIVERING'])
      .orderBy('o.updated_at', 'asc');
    const items = await summaries(db, orders.map((order) => order.id));
    return orders.map((order) => present(order, items));
  }

  async function getOrder(staff, orderId) {
    const order = await assignedOrder(db, staff, orderId);
    return present(order, await summaries(db, [orderId]));
  }

  async function transition(staff, orderId, from, to) {
    let queued = false;
    await db.transaction(async (trx) => {
      const order = await assignedOrder(trx, staff, orderId, { lock: true });
      if (order.delivery_type !== 'DELIVERY') throw new HttpError(409, 'pickup_delivery_transition_not_supported');
      if (order.status !== from) {
        throw new HttpError(409, 'invalid_delivery_transition', `Cannot transition ${order.status} to ${to}`, {
          current_status: order.status, required_status: from,
        });
      }
      const changes = { status: to, updated_at: trx.fn.now() };
      if (to === 'DELIVERING') changes.delivering_at = trx.fn.now();
      if (to === 'COMPLETED') changes.completed_at = trx.fn.now();
      await trx('orders').where({ id: order.id, assigned_rider_id: staff.id }).update(changes);
      queued = await enqueueNotification(notifier, trx, to, order.id);
    });
    const result = await getOrder(staff, orderId);
    if (!queued) await notifySafely(notifier, to, orderId);
    return result;
  }

  return {
    listOrders,
    getOrder,
    startDelivery: (staff, id) => transition(staff, id, 'READY', 'DELIVERING'),
    complete: (staff, id) => transition(staff, id, 'DELIVERING', 'COMPLETED'),
  };
}

module.exports = { createRiderOrderService, requireRider };
