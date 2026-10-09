const { HttpError } = require('./http.cjs');
const { notifySafely } = require('./line-order-notifier.cjs');
const { enqueueNotification } = require('./notification-outbox.cjs');
const { createFinanceService } = require('./finance-service.cjs');

const permissions = {
  MANAGER: new Set(['VIEW', 'ACCEPT', 'REJECT', 'PREPARE', 'READY', 'KDS', 'ASSIGN_RIDER']),
  CASHIER: new Set(['VIEW', 'ACCEPT', 'REJECT', 'PREPARE']),
  KITCHEN: new Set(['VIEW', 'READY', 'KDS']),
  RIDER: new Set(),
};

const moneyNumber = (value) => value === null || value === undefined ? null : Number(value);

function requirePermission(staff, permission) {
  if (!permissions[staff.role]?.has(permission)) {
    throw new HttpError(403, 'staff_permission_denied', 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการนี้');
  }
}

function createMerchantOrderService(db, { notifier } = {}) {
  async function orderRow(query, staff, orderId, { lock = false } = {}) {
    let builder = query('orders as o')
      .join('customers as c', 'c.id', 'o.customer_id')
      .leftJoin('merchant_staffs as r', 'r.id', 'o.assigned_rider_id')
      .select(
        'o.id', 'o.order_code', 'o.merchant_order_number', 'o.merchant_id', 'o.delivery_type',
        'o.status', 'o.payment_method', 'o.payment_status', 'o.subtotal_amount', 'o.delivery_fee',
        'o.total_amount', 'o.delivery_address_label', 'o.delivery_soi_name', 'o.delivery_dormitory_name',
        'o.discount_amount', 'o.promotion_snapshot', 'o.coupon_snapshot',
        'o.delivery_location_text', 'o.delivery_room_number', 'o.delivery_contact_phone', 'o.delivery_note',
        'o.accepted_at', 'o.delivering_at', 'o.completed_at', 'o.created_at', 'o.updated_at',
        'c.display_name as customer_display_name', 'c.phone as customer_phone',
        'r.id as assigned_rider_id', 'r.full_name as assigned_rider_name', 'r.phone as assigned_rider_phone',
      )
      .where({ 'o.id': orderId, 'o.merchant_id': staff.merchant_id });
    if (lock) builder = builder.forUpdate('o');
    const order = await builder.first();
    if (!order) throw new HttpError(404, 'merchant_order_not_found');
    return order;
  }

  async function itemsFor(query, orderIds) {
    if (!orderIds.length) return [];
    const items = await query('order_items')
      .select('id', 'order_id', 'menu_item_id', 'item_name', 'quantity', 'unit_price', 'note', 'is_completed')
      .whereIn('order_id', orderIds).orderBy('id');
    const choices = items.length ? await query('order_item_choices')
      .select('id', 'order_item_id', 'menu_option_choice_id', 'choice_name', 'extra_price')
      .whereIn('order_item_id', items.map((item) => item.id)).orderBy('id') : [];
    // Optional local-only provenance for the shared seed label presenter. Receipt values
    // always come from snapshots; missing/edited master rows leave snapshot text intact.
    const demoMenus = process.env.NODE_ENV === 'development' && items.length ? await query('menu_items as m')
      .join('merchants as s', 's.id', 'm.merchant_id').whereIn('m.id', items.map((item) => item.menu_item_id).filter(Boolean))
      .where('m.image_url', 'like', '/demo/%').select('m.id', 'm.name', 'm.image_url', 's.store_name') : [];
    const demoChoices = demoMenus.length ? await query('menu_option_choices as c')
      .join('menu_option_groups as g', 'g.id', 'c.option_group_id').whereIn('g.menu_item_id', demoMenus.map((menu) => menu.id))
      .select('c.id', 'c.name', 'g.name as group_name', 'g.menu_item_id') : [];
    return items.map(({ menu_item_id, ...item }) => ({
      ...item,
      ...(demoMenus.some((menu) => menu.id === menu_item_id && menu.name === item.item_name)
        ? { local_demo_menu: demoMenus.find((menu) => menu.id === menu_item_id && menu.name === item.item_name) } : {}),
      unit_price: moneyNumber(item.unit_price),
      choices: choices.filter((choice) => choice.order_item_id === item.id)
        .map(({ menu_option_choice_id, ...choice }) => ({ ...choice, extra_price: moneyNumber(choice.extra_price),
          ...(demoChoices.some((row) => row.id === menu_option_choice_id && row.menu_item_id === menu_item_id && row.name === choice.choice_name)
            ? { local_demo_group: demoChoices.find((row) => row.id === menu_option_choice_id).group_name } : {}),
        })),
    }));
  }

  function present(order, items, role) {
    const kitchen = role === 'KITCHEN';
    return {
      id: order.id,
      order_code: order.order_code,
      merchant_order_number: order.merchant_order_number,
      delivery_type: order.delivery_type,
      status: order.status,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      created_at: order.created_at,
      updated_at: order.updated_at,
      items: items.filter((item) => item.order_id === order.id),
      ...(kitchen ? {} : {
        delivery_note: order.delivery_note,
        customer: { display_name: order.customer_display_name, phone: order.customer_phone },
        subtotal_amount: moneyNumber(order.subtotal_amount),
        discount_amount: moneyNumber(order.discount_amount),
        promotion_snapshot: order.promotion_snapshot,
        coupon_snapshot: order.coupon_snapshot,
        delivery_fee: moneyNumber(order.delivery_fee),
        total_amount: moneyNumber(order.total_amount),
        delivery: order.delivery_type === 'DELIVERY' ? {
          label: order.delivery_address_label,
          soi_name: order.delivery_soi_name,
          dormitory_name: order.delivery_dormitory_name,
          location_text: order.delivery_location_text,
          room_number: order.delivery_room_number,
          contact_phone: order.delivery_contact_phone,
        } : null,
        accepted_at: order.accepted_at,
        delivering_at: order.delivering_at,
        completed_at: order.completed_at,
        assigned_rider: order.assigned_rider_id ? {
          id: order.assigned_rider_id,
          full_name: order.assigned_rider_name,
          phone: order.assigned_rider_phone,
        } : null,
        refund_required: order.status === 'REJECTED' && order.payment_status === 'PAID',
      }),
    };
  }

  async function listOrders(staff) {
    requirePermission(staff, 'VIEW');
    const orders = await db('orders as o')
      .join('customers as c', 'c.id', 'o.customer_id')
      .leftJoin('merchant_staffs as r', 'r.id', 'o.assigned_rider_id')
      .select(
        'o.id', 'o.order_code', 'o.merchant_order_number', 'o.delivery_type', 'o.status',
        'o.payment_method', 'o.payment_status', 'o.subtotal_amount', 'o.delivery_fee', 'o.total_amount',
        'o.delivery_address_label', 'o.delivery_soi_name', 'o.delivery_dormitory_name',
        'o.delivery_location_text', 'o.delivery_room_number', 'o.delivery_contact_phone', 'o.delivery_note',
        'o.accepted_at', 'o.delivering_at', 'o.completed_at', 'o.created_at', 'o.updated_at',
        'c.display_name as customer_display_name', 'c.phone as customer_phone',
        'r.id as assigned_rider_id', 'r.full_name as assigned_rider_name', 'r.phone as assigned_rider_phone',
      )
      .where({ 'o.merchant_id': staff.merchant_id }).orderBy('o.created_at', 'desc').limit(200);
    const items = await itemsFor(db, orders.map((order) => order.id));
    return orders.map((order) => present(order, items, staff.role));
  }

  async function getOrder(staff, orderId) {
    requirePermission(staff, 'VIEW');
    const order = await orderRow(db, staff, orderId);
    return present(order, await itemsFor(db, [orderId]), staff.role);
  }

  async function transition(staff, orderId, { permission, from, to }) {
    requirePermission(staff, permission);
    let refundRequired = false;
    let queued = false;
    const event = { ACCEPTED: 'ORDER_ACCEPTED', PREPARING: 'PREPARING', READY: 'READY', REJECTED: 'REJECTED' }[to];
    await db.transaction(async (trx) => {
      await createFinanceService(db).lockMerchant(trx, staff.merchant_id);
      const order = await orderRow(trx, staff, orderId, { lock: true });
      if (order.status !== from) {
        throw new HttpError(409, 'invalid_order_transition', `Cannot transition ${order.status} to ${to}`, { current_status: order.status, required_status: from });
      }
      if (to === 'ACCEPTED' && order.payment_method === 'PROMPTPAY' && order.payment_status !== 'PAID') {
        throw new HttpError(409, 'payment_required', 'PromptPay order must be paid before acceptance');
      }
      if (to === 'READY') {
        const incomplete = Number((await trx('order_items').where({ order_id: order.id, is_completed: false }).count('* as count').first()).count);
        if (incomplete > 0) throw new HttpError(409, 'items_incomplete', 'All order items must be completed before READY');
      }
      const changes = { status: to, updated_at: trx.fn.now() };
      if (to === 'ACCEPTED') changes.accepted_at = trx.fn.now();
      await trx('orders').where({ id: order.id }).update(changes);
      refundRequired = to === 'REJECTED' && order.payment_status === 'PAID';
      if (refundRequired) await createFinanceService(db).orderEvent(trx, order.id, 'REJECTED');
      if (event) queued = await enqueueNotification(notifier, trx, event, order.id);
    });
    const order = await getOrder(staff, orderId);
    if (event && !queued) await notifySafely(notifier, event, orderId);
    return { order, refund_required: refundRequired };
  }

  async function markItem(staff, orderId, itemId, completed) {
    requirePermission(staff, 'KDS');
    if (typeof completed !== 'boolean') throw new HttpError(400, 'completed_must_be_boolean');
    await db.transaction(async (trx) => {
      const order = await orderRow(trx, staff, orderId, { lock: true });
      if (order.status !== 'PREPARING') {
        throw new HttpError(409, 'kds_order_not_preparing', 'KDS updates require PREPARING status');
      }
      const item = await trx('order_items').where({ id: itemId, order_id: order.id }).forUpdate().first('id');
      if (!item) throw new HttpError(404, 'order_item_not_found');
      await trx('order_items').where({ id: item.id }).update({ is_completed: completed });
    });
    return getOrder(staff, orderId);
  }

  async function completeAllItems(staff, orderId) {
    requirePermission(staff, 'KDS');
    await db.transaction(async (trx) => {
      const order = await orderRow(trx, staff, orderId, { lock: true });
      if (order.status !== 'PREPARING') throw new HttpError(409, 'kds_order_not_preparing');
      await trx('order_items').where({ order_id: order.id }).update({ is_completed: true });
    });
    return getOrder(staff, orderId);
  }

  async function listRiders(staff) {
    requirePermission(staff, 'ASSIGN_RIDER');
    const riders = await db('merchant_staffs')
      .select('id', 'full_name', 'phone', 'username')
      .where({ merchant_id: staff.merchant_id, role: 'RIDER', is_active: true })
      .whereNull('deleted_at').orderBy('full_name');
    const jobs = await db('orders').where({ merchant_id: staff.merchant_id })
      .whereIn('status', ['READY', 'DELIVERING']).whereIn('assigned_rider_id', riders.map((rider) => rider.id))
      .select('assigned_rider_id').count('* as count').groupBy('assigned_rider_id');
    return riders.map((rider) => ({ ...rider, active_jobs: Number(jobs.find((row) => row.assigned_rider_id === rider.id)?.count || 0) }));
  }

  async function assignRider(staff, orderId, riderId) {
    requirePermission(staff, 'ASSIGN_RIDER');
    await db.transaction(async (trx) => {
      const order = await orderRow(trx, staff, orderId, { lock: true });
      if (order.delivery_type !== 'DELIVERY') throw new HttpError(409, 'rider_not_required_for_pickup');
      if (order.status !== 'READY') {
        throw new HttpError(409, 'rider_assignment_not_allowed', 'Rider assignment requires READY status');
      }
      const rider = await trx('merchant_staffs')
        .where({ id: riderId, merchant_id: order.merchant_id, role: 'RIDER', is_active: true })
        .whereNull('deleted_at').forUpdate().first('id');
      if (!rider) throw new HttpError(404, 'rider_not_found');
      if (order.assigned_rider_id && order.assigned_rider_id !== rider.id) {
        throw new HttpError(409, 'rider_assignment_conflict', 'Unassign the current rider before assigning another rider');
      }
      if (!order.assigned_rider_id) {
        await trx('orders').where({ id: order.id }).update({ assigned_rider_id: rider.id, updated_at: trx.fn.now() });
      }
    });
    return getOrder(staff, orderId);
  }

  async function unassignRider(staff, orderId) {
    requirePermission(staff, 'ASSIGN_RIDER');
    await db.transaction(async (trx) => {
      const order = await orderRow(trx, staff, orderId, { lock: true });
      if (order.status !== 'READY') {
        throw new HttpError(409, 'rider_unassignment_not_allowed', 'Rider can only be unassigned before delivery starts');
      }
      if (order.assigned_rider_id) {
        await trx('orders').where({ id: order.id }).update({ assigned_rider_id: null, updated_at: trx.fn.now() });
      }
    });
    return getOrder(staff, orderId);
  }

  return {
    listOrders,
    getOrder,
    accept: (staff, id) => transition(staff, id, { permission: 'ACCEPT', from: 'PENDING', to: 'ACCEPTED' }),
    reject: (staff, id) => transition(staff, id, { permission: 'REJECT', from: 'PENDING', to: 'REJECTED' }),
    startPreparing: (staff, id) => transition(staff, id, { permission: 'PREPARE', from: 'ACCEPTED', to: 'PREPARING' }),
    ready: (staff, id) => transition(staff, id, { permission: 'READY', from: 'PREPARING', to: 'READY' }),
    markItem,
    completeAllItems,
    listRiders,
    assignRider,
    unassignRider,
  };
}

module.exports = { createMerchantOrderService, permissions, requirePermission };
