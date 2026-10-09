const {openingStatus}=require('./opening-hours.cjs');
const { HttpError, textField } = require('./http.cjs');
const { createPromotionService } = require('./promotion-service.cjs');
const { createCouponService, normalizeCouponCode } = require('./coupon-service.cjs');
const { createFinanceService } = require('./finance-service.cjs');

const toCents = (value) => Math.round(Number(value) * 100);
const money = (cents) => (cents / 100).toFixed(2);
const moneyNumber = (value) => Number(value);

function positiveInteger(value, name, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new HttpError(400, 'invalid_request', `${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'invalid_request', 'Order body must be an object');
  }
  const deliveryType = payload.deliveryType;
  if (!['DELIVERY', 'PICKUP'].includes(deliveryType)) {
    throw new HttpError(400, 'invalid_delivery_type', 'deliveryType must be DELIVERY or PICKUP');
  }
  const merchantId = positiveInteger(payload.merchantId, 'merchantId');
  let addressId = null;
  if (deliveryType === 'DELIVERY') addressId = positiveInteger(payload.addressId, 'addressId');
  else if (payload.addressId !== undefined && payload.addressId !== null) {
    throw new HttpError(400, 'pickup_address_not_allowed');
  }
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 50) {
    throw new HttpError(400, 'invalid_items', 'items must contain 1-50 entries');
  }
  const items = payload.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, 'invalid_item', `items[${index}] must be an object`);
    }
    const optionChoiceIds = item.optionChoiceIds ?? [];
    if (!Array.isArray(optionChoiceIds) || optionChoiceIds.length > 30) {
      throw new HttpError(400, 'invalid_option_choices', `items[${index}].optionChoiceIds is invalid`);
    }
    const normalizedChoices = optionChoiceIds.map((choiceId) => positiveInteger(choiceId, 'optionChoiceId'));
    if (new Set(normalizedChoices).size !== normalizedChoices.length) {
      throw new HttpError(400, 'duplicate_option_choice', `items[${index}] contains a duplicate option choice`);
    }
    return {
      menuItemId: positiveInteger(item.menuItemId, 'menuItemId'),
      quantity: positiveInteger(item.quantity, 'quantity', { max: 99 }),
      note: textField(item.note, 'note', { max: 500, nullable: true }),
      optionChoiceIds: normalizedChoices,
    };
  });
  const promotionId = payload.promotionId == null ? null : positiveInteger(payload.promotionId, 'promotionId');
  const couponCode = payload.couponCode == null || payload.couponCode === '' ? null : normalizeCouponCode(payload.couponCode);
  if (promotionId && couponCode) throw new HttpError(400, 'discount_stacking_not_allowed', 'เลือกโปรโมชันหรือคูปองได้อย่างใดอย่างหนึ่ง');
  return {
    merchantId,
    promotionId,
    couponCode,
    addressId,
    deliveryType,
    deliveryNote: textField(payload.deliveryNote, 'deliveryNote', { max: 1000, nullable: true }),
    items,
  };
}

function createOrderService(db, { beforeCommit } = {}) {
  const finance = createFinanceService(db);
  const promotions = createPromotionService(db);
  const coupons = createCouponService(db);
  async function getOrder(customerId, orderId, query = db) {
    const order = await query('orders as o')
      .join('merchants as m', 'm.id', 'o.merchant_id')
      .select(
        'o.id', 'o.order_code', 'o.merchant_order_number', 'o.customer_id', 'o.merchant_id',
        'm.store_name', 'o.delivery_type', 'o.status', 'o.payment_method', 'o.payment_status',
        'o.subtotal_amount', 'o.delivery_fee', 'o.total_amount', 'o.delivery_address_label',
        'o.promotion_id', 'o.promotion_snapshot', 'o.coupon_id', 'o.coupon_snapshot', 'o.discount_amount',
        'o.delivery_soi_name', 'o.delivery_dormitory_name', 'o.delivery_location_text',
        'o.delivery_room_number', 'o.delivery_contact_phone', 'o.delivery_note',
        'o.accepted_at', 'o.delivering_at', 'o.completed_at', 'o.cancelled_at', 'o.created_at', 'o.updated_at',
      )
      .where({ 'o.id': orderId, 'o.customer_id': customerId }).first();
    if (!order) throw new HttpError(404, 'order_not_found');
    const items = await query('order_items')
      .select('id', 'menu_item_id', 'item_name', 'quantity', 'unit_price', 'note', 'is_completed')
      .where({ order_id: orderId }).orderBy('id');
    const itemIds = items.map((item) => item.id);
    const choices = itemIds.length ? await query('order_item_choices')
      .select('id', 'order_item_id', 'menu_option_choice_id', 'choice_name', 'extra_price')
      .whereIn('order_item_id', itemIds).orderBy('id') : [];
    return {
      ...order,
      subtotal_amount: moneyNumber(order.subtotal_amount),
      discount_amount: moneyNumber(order.discount_amount),
      delivery_fee: moneyNumber(order.delivery_fee),
      total_amount: moneyNumber(order.total_amount),
      items: items.map((item) => {
        const itemChoices = choices.filter((choice) => choice.order_item_id === item.id)
          .map((choice) => ({ ...choice, extra_price: moneyNumber(choice.extra_price) }));
        const unitPrice = moneyNumber(item.unit_price);
        const lineTotal = (unitPrice + itemChoices.reduce((sum, choice) => sum + choice.extra_price, 0)) * item.quantity;
        return { ...item, unit_price: unitPrice, choices: itemChoices, line_total: lineTotal };
      }),
    };
  }

  async function listOrders(customerId) {
    const rows = await db('orders as o')
      .join('merchants as m', 'm.id', 'o.merchant_id')
      .select(
        'o.id', 'o.order_code', 'o.merchant_id', 'm.store_name', 'o.delivery_type',
        'o.status', 'o.payment_status', 'o.total_amount', 'o.created_at',
      )
      .where('o.customer_id', customerId).orderBy('o.created_at', 'desc').limit(100);
    if (!rows.length) return [];
    const itemRows = await db('order_items')
      .select('order_id', 'item_name', 'quantity').whereIn('order_id', rows.map((row) => row.id)).orderBy('id');
    return rows.map((row) => {
      const orderItems = itemRows.filter((item) => item.order_id === row.id);
      return {
        ...row,
        total_amount: moneyNumber(row.total_amount),
        item_count: orderItems.reduce((sum, item) => sum + item.quantity, 0),
        item_names: orderItems.map((item) => item.item_name),
      };
    });
  }

  async function createOrder(customerId, rawPayload, { transaction, quoteOnly = false } = {}) {
    const payload = normalizePayload(rawPayload);
    const createWithin = async (trx) => {
      await finance.runtime(trx, true);
      const merchant = await trx('merchants')
        .select('id', 'store_name', 'prefix', 'last_order_number', 'is_open', 'is_active')
        .where({ id: payload.merchantId }).whereNull('deleted_at').forUpdate().first();
      if (!merchant) throw new HttpError(404, 'merchant_not_found');
      if (!merchant.is_active) throw new HttpError(409, 'merchant_suspended', 'This merchant is temporarily unavailable');
      if (openingStatus(merchant,await trx('merchant_opening_hours').where({merchant_id:merchant.id})) !== 'OPEN') throw new HttpError(409, 'merchant_closed', 'This merchant is currently closed');

      let address = null;
      let deliveryFeeCents = 0;
      if (payload.deliveryType === 'DELIVERY') {
        address = await trx('customer_addresses as a')
          .join('dormitories as d', 'd.id', 'a.dormitory_id')
          .join('sois as s', 's.id', 'd.soi_id')
          .select(
            'a.id', 'a.label', 'a.room_number', 'a.contact_phone', 'a.address_detail',
            'd.location_text', 'd.name as dormitory_name', 's.id as soi_id', 's.name as soi_name',
          )
          .where({ 'a.id': payload.addressId, 'a.customer_id': customerId }).first();
        if (!address) throw new HttpError(404, 'address_not_found');
        const fee = await trx('delivery_fees')
          .select('fee').where({ merchant_id: merchant.id, soi_id: address.soi_id }).first();
        if (!fee) {
          throw new HttpError(422, 'unsupported_delivery_location', 'This merchant does not deliver to the selected address');
        }
        deliveryFeeCents = toCents(fee.fee);
      }

      const menuItemIds = [...new Set(payload.items.map((item) => item.menuItemId))];
      const menuRows = await trx('menu_items')
        .select('id', 'merchant_id', 'category_id', 'name', 'price', 'is_available', 'stock_quantity')
        .whereIn('id', menuItemIds).whereNull('deleted_at').forUpdate();
      const menuById = new Map(menuRows.map((item) => [item.id, item]));
      const activeCategoryIds = new Set((await trx('menu_categories')
        .select('id').whereIn('id', menuRows.map((item) => item.category_id))
        .where({ is_active: true }).whereNull('deleted_at')).map((category) => category.id));
      const requestedQuantity = new Map();
      for (const item of payload.items) {
        requestedQuantity.set(item.menuItemId, (requestedQuantity.get(item.menuItemId) || 0) + item.quantity);
      }
      for (const menuItemId of menuItemIds) {
        const item = menuById.get(menuItemId);
        if (!item || !activeCategoryIds.has(item.category_id)) {
          throw new HttpError(400, 'invalid_menu_item', `Menu item ${menuItemId} is unavailable`);
        }
        if (item.merchant_id !== merchant.id) throw new HttpError(400, 'cross_merchant_item', 'All items must belong to the selected merchant');
        if (!item.is_available || (item.stock_quantity !== null && item.stock_quantity < requestedQuantity.get(item.id))) {
          throw new HttpError(409, 'menu_item_unavailable', `${item.name} is unavailable in the requested quantity`);
        }
      }

      const groups = await trx('menu_option_groups')
        .select('id', 'menu_item_id', 'name', 'is_required', 'min_choices', 'max_choices')
        .whereIn('menu_item_id', menuItemIds).orderBy('sort_order');
      const groupIds = groups.map((group) => group.id);
      const choices = groupIds.length ? await trx('menu_option_choices')
        .select('id', 'option_group_id', 'name', 'extra_price', 'is_available')
        .whereIn('option_group_id', groupIds) : [];
      const choiceById = new Map(choices.map((choice) => [choice.id, choice]));
      const groupById = new Map(groups.map((group) => [group.id, group]));

      let subtotalCents = 0;
      const resolvedItems = payload.items.map((requested, itemIndex) => {
        const menuItem = menuById.get(requested.menuItemId);
        const selectedChoices = requested.optionChoiceIds.map((choiceId) => {
          const choice = choiceById.get(choiceId);
          const group = choice ? groupById.get(choice.option_group_id) : null;
          if (!choice || !group || group.menu_item_id !== menuItem.id) {
            throw new HttpError(400, 'invalid_option_choice', `An option does not belong to ${menuItem.name}`, { itemIndex, choiceId });
          }
          if (!choice.is_available) throw new HttpError(409, 'option_unavailable', `${choice.name} is unavailable`, { itemIndex, choiceId });
          return { ...choice, group };
        });
        for (const group of groups.filter((candidate) => candidate.menu_item_id === menuItem.id)) {
          const count = selectedChoices.filter((choice) => choice.option_group_id === group.id).length;
          if (count < group.min_choices) {
            throw new HttpError(422, 'option_min_choices', `${group.name} requires at least ${group.min_choices} choice(s)`, { itemIndex, groupId: group.id });
          }
          if (count > group.max_choices) {
            throw new HttpError(422, 'option_max_choices', `${group.name} allows at most ${group.max_choices} choice(s)`, { itemIndex, groupId: group.id });
          }
        }
        const baseCents = toCents(menuItem.price);
        const optionCents = selectedChoices.reduce((sum, choice) => sum + toCents(choice.extra_price), 0);
        subtotalCents += (baseCents + optionCents) * requested.quantity;
        return { requested, menuItem, selectedChoices, baseCents };
      });

      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 999999999999) throw new HttpError(422, 'order_amount_too_large');
      const promotion = await promotions.resolve(trx, payload.promotionId, {
        merchantId: merchant.id, subtotal: subtotalCents, deliveryFee: deliveryFeeCents, deliveryType: payload.deliveryType,
      });
      const coupon = await coupons.resolve(trx, payload.couponCode, {
        customerId, merchantId: merchant.id, subtotal: subtotalCents,
        deliveryFee: deliveryFeeCents, deliveryType: payload.deliveryType,
      });
      const discount = promotion.discount + coupon.discount;
      const totalCents = subtotalCents + deliveryFeeCents - discount;
      const financeRoute = await finance.route(trx, { subtotal_amount: money(subtotalCents), delivery_fee: money(deliveryFeeCents),
        discount_amount: money(discount), total_amount: money(totalCents), promotion_snapshot: promotion.snapshot, coupon_snapshot: coupon.snapshot });
      if (!Number.isSafeInteger(totalCents) || totalCents > 999999999999) throw new HttpError(422, 'order_amount_too_large');
      if (quoteOnly) return {
        subtotal_amount: Number(money(subtotalCents)), delivery_fee: Number(money(deliveryFeeCents)),
        discount_amount: Number(money(discount)), total_amount: Number(money(totalCents)),
        promotion_snapshot: promotion.snapshot,
        coupon_snapshot: coupon.snapshot,
      };
      const merchantOrderNumber = merchant.last_order_number + 1;
      await trx('merchants').where({ id: merchant.id }).update({
        last_order_number: merchantOrderNumber,
        updated_at: trx.fn.now(),
      });
      const orderCode = `${merchant.prefix}-${String(merchantOrderNumber).padStart(6, '0')}`;
      const [order] = await trx('orders').insert({
        ...financeRoute,
        order_code: orderCode,
        merchant_order_number: merchantOrderNumber,
        customer_id: customerId,
        merchant_id: merchant.id,
        customer_address_id: address?.id ?? null,
        assigned_rider_id: null,
        delivery_type: payload.deliveryType,
        status: 'PENDING',
        payment_method: 'PROMPTPAY',
        payment_status: 'UNPAID',
        subtotal_amount: money(subtotalCents),
        delivery_fee: money(deliveryFeeCents),
        total_amount: money(totalCents),
        promotion_id: payload.promotionId,
        promotion_snapshot: promotion.snapshot ? JSON.stringify(promotion.snapshot) : null,
        coupon_id: coupon.coupon?.id ?? null,
        coupon_snapshot: coupon.snapshot ? JSON.stringify(coupon.snapshot) : null,
        discount_amount: money(discount),
        delivery_address_label: address?.label ?? null,
        delivery_soi_name: address?.soi_name ?? null,
        delivery_dormitory_name: address?.dormitory_name ?? null,
        delivery_location_text: address
          ? [address.location_text, address.address_detail].filter(Boolean).join('\n')
          : null,
        delivery_room_number: address?.room_number ?? null,
        delivery_contact_phone: address?.contact_phone ?? null,
        delivery_note: payload.deliveryNote,
      }).returning('id');

      for (const resolved of resolvedItems) {
        const [orderItem] = await trx('order_items').insert({
          order_id: order.id,
          merchant_id: merchant.id,
          menu_item_id: resolved.menuItem.id,
          item_name: resolved.menuItem.name,
          quantity: resolved.requested.quantity,
          unit_price: money(resolved.baseCents),
          note: resolved.requested.note,
          is_completed: false,
        }).returning('id');
        if (resolved.selectedChoices.length) {
          await trx('order_item_choices').insert(resolved.selectedChoices.map((choice) => ({
            order_item_id: orderItem.id,
            menu_option_choice_id: choice.id,
            choice_name: choice.name,
            extra_price: money(toCents(choice.extra_price)),
          })));
        }
      }
      await promotions.redeem(trx, { promotionId: payload.promotionId, orderId: order.id, customerId, discount: promotion.discount });
      await coupons.redeem(trx, { coupon: coupon.coupon, orderId: order.id, customerId, discount: coupon.discount });
      if (beforeCommit) await beforeCommit({ trx, orderId: order.id, merchantId: merchant.id });
      return getOrder(customerId, order.id, trx);
    };
    return transaction ? createWithin(transaction) : db.transaction(createWithin);
  }

  return { createOrder, quoteOrder: (customerId, payload) => createOrder(customerId, payload, { quoteOnly: true }), listOrders, getOrder, promotions, coupons };
}

module.exports = { createOrderService, normalizePayload };
