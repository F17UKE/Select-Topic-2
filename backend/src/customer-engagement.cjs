const { HttpError } = require('./http.cjs');

const money = (value) => Number(value);

function createCustomerEngagement(db) {
  async function getOrderReview(customerId, orderId) {
    const order = await db('orders').where({ id: orderId, customer_id: customerId }).first('id', 'status');
    if (!order) throw new HttpError(404, 'order_not_found');
    const review = await db('reviews').where({ order_id: orderId, customer_id: customerId }).first();
    return { review: review || null, eligible: order.status === 'COMPLETED' && !review };
  }

  async function createReview(customerId, orderId, { rating, comment }) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'invalid_rating', 'คะแนนต้องเป็นจำนวนเต็ม 1–5');
    if (comment !== null && comment !== undefined && typeof comment !== 'string') throw new HttpError(400, 'invalid_review_comment');
    const normalizedComment = String(comment || '').trim();
    if (normalizedComment.length > 1000) throw new HttpError(400, 'review_comment_too_long');
    try {
      return await db.transaction(async (trx) => {
        const order = await trx('orders').where({ id: orderId }).forUpdate().first('id', 'customer_id', 'merchant_id', 'status');
        if (!order || Number(order.customer_id) !== Number(customerId)) throw new HttpError(404, 'order_not_found');
        if (order.status !== 'COMPLETED') throw new HttpError(409, 'review_order_not_completed');
        const [review] = await trx('reviews').insert({
          order_id: order.id,
          customer_id: customerId,
          merchant_id: order.merchant_id,
          rating,
          comment: normalizedComment || null,
          status: 'PUBLISHED',
        }).returning('*');
        return review;
      });
    } catch (error) {
      if (error.code === '23505') throw new HttpError(409, 'review_already_exists');
      throw error;
    }
  }

  async function listMerchantReviews(merchantId, { limit = 30 } = {}) {
    const merchant = await db('merchants').where({ id: merchantId }).whereNull('deleted_at').first('id');
    if (!merchant) throw new HttpError(404, 'merchant_not_found');
    const rows = await db('reviews as r').join('customers as c', 'c.id', 'r.customer_id')
      .select('r.id', 'r.rating', 'r.comment', 'r.created_at', 'c.display_name')
      .where({ 'r.merchant_id': merchantId, 'r.status': 'PUBLISHED' })
      .orderBy('r.created_at', 'desc').limit(Math.min(50, Math.max(1, Number(limit) || 30)));
    const aggregate = await db('reviews').where({ merchant_id: merchantId, status: 'PUBLISHED' })
      .select(db.raw('coalesce(round(avg(rating)::numeric,1),0) as average_rating'), db.raw('count(*)::int as review_count')).first();
    return { reviews: rows, average_rating: money(aggregate.average_rating), review_count: aggregate.review_count };
  }

  async function addFavorite(customerId, merchantId) {
    const merchant = await db('merchants').where({ id: merchantId }).whereNull('deleted_at').first('id');
    if (!merchant) throw new HttpError(404, 'merchant_not_found');
    await db('customer_favorite_merchants').insert({ customer_id: customerId, merchant_id: merchantId })
      .onConflict(['customer_id', 'merchant_id']).ignore();
    return { merchant_id: merchantId, is_favorite: true };
  }

  async function removeFavorite(customerId, merchantId) {
    await db('customer_favorite_merchants').where({ customer_id: customerId, merchant_id: merchantId }).delete();
    return { merchant_id: merchantId, is_favorite: false };
  }

  async function favoriteIds(customerId) {
    return (await db('customer_favorite_merchants').where({ customer_id: customerId }).orderBy('created_at', 'desc').select('merchant_id'))
      .map((row) => row.merchant_id);
  }

  async function reorderPreview(customerId, orderId) {
    const order = await db('orders as o').join('merchants as m', 'm.id', 'o.merchant_id')
      .select('o.id', 'o.customer_id', 'o.merchant_id', 'o.status', 'm.store_name', 'm.is_active', 'm.deleted_at')
      .where({ 'o.id': orderId, 'o.customer_id': customerId }).first();
    if (!order) throw new HttpError(404, 'order_not_found');
    if (order.status !== 'COMPLETED') throw new HttpError(409, 'reorder_order_not_completed');
    if (!order.is_active || order.deleted_at) throw new HttpError(409, 'merchant_suspended');
    const oldItems = await db('order_items').where({ order_id: orderId }).orderBy('id');
    const oldChoices = oldItems.length ? await db('order_item_choices').whereIn('order_item_id', oldItems.map((item) => item.id)).orderBy('id') : [];
    const menuRows = await db('menu_items as mi').join('menu_categories as c', 'c.id', 'mi.category_id')
      .select('mi.*', 'c.is_active as category_active', 'c.deleted_at as category_deleted_at')
      .whereIn('mi.id', oldItems.map((item) => item.menu_item_id).filter(Boolean));
    const menuById = new Map(menuRows.map((row) => [row.id, row]));
    const choiceIds = oldChoices.map((choice) => choice.menu_option_choice_id).filter(Boolean);
    const currentChoices = choiceIds.length ? await db('menu_option_choices as c')
      .join('menu_option_groups as g', 'g.id', 'c.option_group_id')
      .select('c.id', 'c.name', 'c.extra_price', 'c.is_available', 'c.option_group_id', 'g.menu_item_id')
      .whereIn('c.id', choiceIds) : [];
    const choiceById = new Map(currentChoices.map((row) => [row.id, row]));
    const available_items = [];
    const unavailable_items = [];
    const changed_prices = [];
    for (const oldItem of oldItems) {
      const menu = menuById.get(oldItem.menu_item_id);
      const itemChoices = oldChoices.filter((choice) => choice.order_item_id === oldItem.id);
      const missing = itemChoices.filter((choice) => {
        const current = choiceById.get(choice.menu_option_choice_id);
        return !current || !current.is_available || current.menu_item_id !== oldItem.menu_item_id;
      });
      let reason = null;
      if (!menu || menu.deleted_at || !menu.category_active || menu.category_deleted_at) reason = 'MENU_REMOVED';
      else if (!menu.is_available || (menu.stock_quantity !== null && menu.stock_quantity < oldItem.quantity)) reason = 'MENU_UNAVAILABLE';
      else if (missing.length) reason = 'OPTION_MISSING';
      if (reason) {
        unavailable_items.push({ order_item_id: oldItem.id, item_name: oldItem.item_name, reason, missing_options: missing.map((item) => item.choice_name) });
        continue;
      }
      const choices = itemChoices.map((oldChoice) => {
        const current = choiceById.get(oldChoice.menu_option_choice_id);
        return { id: current.id, name: current.name, extraPrice: money(current.extra_price) };
      });
      const currentUnit = money(menu.price);
      const priceChanged = currentUnit !== money(oldItem.unit_price) || choices.some((choice, index) => choice.extraPrice !== money(itemChoices[index].extra_price));
      if (priceChanged) changed_prices.push({ order_item_id: oldItem.id, item_name: oldItem.item_name });
      available_items.push({
        id: `reorder-${oldItem.id}`,
        merchantId: order.merchant_id,
        merchantName: order.store_name,
        menuItemId: menu.id,
        name: menu.name,
        unitPriceEstimate: currentUnit,
        quantity: oldItem.quantity,
        note: oldItem.note || '',
        choices,
        optionChoiceIds: choices.map((choice) => choice.id),
        price_changed: priceChanged,
      });
    }
    return { merchant_id: order.merchant_id, merchant_name: order.store_name, available_items, unavailable_items, changed_prices };
  }

  async function listNotifications(customerId) {
    const items = await db('customer_notifications').where({ customer_id: customerId }).orderBy('created_at', 'desc').limit(100);
    const { count } = await db('customer_notifications').where({ customer_id: customerId, is_read: false }).count('* as count').first();
    return { items, unread_count: Number(count) };
  }

  async function markNotificationRead(customerId, notificationId) {
    const updated = await db('customer_notifications').where({ id: notificationId, customer_id: customerId }).update({ is_read: true });
    if (!updated) throw new HttpError(404, 'notification_not_found');
  }

  async function markAllNotificationsRead(customerId) {
    const updated = await db('customer_notifications').where({ customer_id: customerId, is_read: false }).update({ is_read: true });
    return { updated };
  }

  return {
    getOrderReview, createReview, listMerchantReviews,
    addFavorite, removeFavorite, favoriteIds,
    reorderPreview, listNotifications, markNotificationRead, markAllNotificationsRead,
  };
}

module.exports = { createCustomerEngagement };
