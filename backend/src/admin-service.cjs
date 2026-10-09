const bcrypt = require('bcryptjs');
const { HttpError } = require('./http.cjs');
const { normalizeCouponCode } = require('./coupon-service.cjs');

function pagination(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(input.limit || '20', 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
function pageResult(items, total, paging) {
  return { items, pagination: { page: paging.page, limit: paging.limit, total: Number(total) } };
}
function applyDateRange(query, column, filters) {
  for (const key of ['from', 'to']) {
    if (filters[key] && Number.isNaN(new Date(filters[key]).valueOf())) throw new HttpError(400, 'invalid_date_filter', 'ช่วงวันที่ไม่ถูกต้อง');
  }
  if (filters.from) query.where(column, '>=', new Date(filters.from));
  if (filters.to) query.where(column, '<=', new Date(filters.to));
  return query;
}
function mask(value, visible = 4) {
  if (!value) return null;
  const text = String(value);
  return text.length <= visible ? '*'.repeat(text.length) : `${'*'.repeat(Math.min(8, text.length - visible))}${text.slice(-visible)}`;
}
function cleanAdmin(admin) {
  const result = { ...admin };
  delete result.password_hash;
  return result;
}

function createAdminService({ db, audit, config = {} }) {
  async function dashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [orders, merchants, riders, paymentFailures, statusRows, paymentRows, recent] = await Promise.all([
      db('orders').where('created_at', '>=', today).select(
        db.raw('count(*)::int as orders_today'),
        db.raw("count(*) filter (where payment_status = 'PAID')::int as paid_orders"),
        db.raw("coalesce(sum(total_amount) filter (where status = 'COMPLETED' and payment_status = 'PAID'), 0) as revenue"),
        db.raw("count(*) filter (where status = 'PENDING')::int as pending_orders"),
      ).first(),
      db('merchants').where({ is_active: true }).whereNull('deleted_at').count('* as count').first(),
      db('merchant_staffs').where({ role: 'RIDER', is_active: true }).whereNull('deleted_at').count('* as count').first(),
      db('payments').where('created_at', '>=', today).where((builder) => builder.where({ status: 'FAILED' })
        .orWhereIn('verification_status', ['REJECTED', 'ERROR'])).count('* as count').first(),
      db('orders').where('created_at', '>=', today).select('status').count('* as count').groupBy('status'),
      db('payments').where('created_at', '>=', today).select('status').count('* as count').groupBy('status'),
      db('orders as o').join('merchants as m', 'm.id', 'o.merchant_id').join('customers as c', 'c.id', 'o.customer_id')
        .select('o.id', 'o.order_code', 'o.status', 'o.payment_status', 'o.total_amount', 'o.created_at',
          'm.store_name', 'c.display_name as customer_name').orderBy('o.created_at', 'desc').limit(10),
    ]);
    return {
      metrics: { ...orders, active_merchants: Number(merchants.count), active_riders: Number(riders.count), failed_payments: Number(paymentFailures.count) },
      order_status: { PENDING: 0, ACCEPTED: 0, PREPARING: 0, READY: 0, DELIVERING: 0, COMPLETED: 0, ...Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)])) },
      payment_status: { PAID: 0, PENDING: 0, FAILED: 0, ...Object.fromEntries(paymentRows.map((row) => [row.status, Number(row.count)])) },
      recent_orders: recent,
    };
  }

  function merchantFilters(query, filters) {
    query.whereNull('m.deleted_at');
    if (filters.q) query.whereILike('m.store_name', `%${filters.q}%`);
    if (filters.status === 'open') query.where({ 'm.is_open': true, 'm.is_active': true });
    if (filters.status === 'closed') query.where({ 'm.is_open': false, 'm.is_active': true });
    if (filters.status === 'active') query.where({ 'm.is_active': true });
    if (filters.status === 'suspended') query.where({ 'm.is_active': false });
    return query;
  }
  async function listMerchants(filters) {
    const paging = pagination(filters);
    const base = () => merchantFilters(db('merchants as m'), filters);
    const [{ count }, items] = await Promise.all([
      base().count('* as count').first(),
      base().select('m.id', 'm.store_name', 'm.phone', 'm.location_text', 'm.promptpay_id', 'm.is_open', 'm.is_active', 'm.suspended_at', 'm.created_at')
        .select(db.raw('(select count(*)::int from merchant_staffs s where s.merchant_id = m.id and s.deleted_at is null) as staff_count'))
        .select(db.raw('(select count(*)::int from menu_items i where i.merchant_id = m.id and i.deleted_at is null) as menu_count'))
        .select(db.raw("(select count(*)::int from orders o where o.merchant_id = m.id and o.created_at >= date_trunc('day', now())) as orders_today"))
        .orderBy(filters.sort === 'name' ? 'm.store_name' : 'm.created_at', filters.sort === 'oldest' ? 'asc' : 'desc')
        .limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items.map((item) => ({ ...item, promptpay_configured: Boolean(item.promptpay_id), promptpay_id: undefined })), count, paging);
  }
  async function merchantDetail(id) {
    const merchant = await db('merchants').where({ id }).whereNull('deleted_at').first();
    if (!merchant) throw new HttpError(404, 'merchant_not_found', 'ไม่พบร้านค้า');
    const [gallery, fees, staff, orders, payment] = await Promise.all([
      db('merchant_images').where({ merchant_id: id }).orderBy('sort_order'),
      db('delivery_fees as f').join('sois as s', 's.id', 'f.soi_id').where({ 'f.merchant_id': id }).select('f.id', 'f.fee', 's.id as soi_id', 's.name as soi_name'),
      db('merchant_staffs').where({ merchant_id: id }).whereNull('deleted_at').select('id', 'username', 'full_name', 'phone', 'role', 'is_active'),
      db('orders').where({ merchant_id: id }).count('* as order_count').sum('total_amount as order_total').first(),
      db('orders').where({ merchant_id: id, payment_status: 'PAID' }).sum('total_amount as paid_total').first(),
    ]);
    return { ...merchant, promptpay_id: mask(merchant.promptpay_id), gallery, delivery_fees: fees, staff, summary: { ...orders, ...payment } };
  }
  async function setMerchantActive(actor, id, active, reason, context) {
    const merchant = await db('merchants').where({ id }).whereNull('deleted_at').first();
    if (!merchant) throw new HttpError(404, 'merchant_not_found', 'ไม่พบร้านค้า');
    await db.transaction(async (trx) => {
      await trx('merchants').where({ id }).update({
        is_active: active,
        suspended_at: active ? null : trx.fn.now(),
        suspension_reason: active ? null : reason,
        suspended_by_admin_id: active ? null : actor.id,
        updated_at: trx.fn.now(),
      });
      await audit.append({ actorId: actor.id, action: active ? 'MERCHANT_ACTIVATED' : 'MERCHANT_SUSPENDED', entityType: 'MERCHANT', entityId: id, ip: context.ip, metadata: { reason } }, trx);
    });
    return merchantDetail(id);
  }

  function customerFilters(query, filters) {
    if (filters.q) query.where((builder) => builder.whereILike('c.display_name', `%${filters.q}%`).orWhereILike('c.phone', `%${filters.q}%`));
    if (filters.lineUserId) query.where({ 'c.line_user_id': filters.lineUserId });
    if (filters.status === 'active') query.where({ 'c.is_active': true });
    if (filters.status === 'inactive') query.where({ 'c.is_active': false });
    return query;
  }
  async function listCustomers(filters, { includeLineUserId = false } = {}) {
    const paging = pagination(filters);
    const base = () => customerFilters(db('customers as c'), filters);
    const [{ count }, items] = await Promise.all([
      base().count('* as count').first(),
      base().select('c.id', 'c.display_name', 'c.phone', 'c.line_user_id', 'c.is_active', 'c.created_at')
        .select(db.raw('(select count(*)::int from customer_addresses a where a.customer_id = c.id) as address_count'))
        .select(db.raw('(select count(*)::int from orders o where o.customer_id = c.id) as order_count'))
        .select(db.raw('(select max(o.created_at) from orders o where o.customer_id = c.id) as last_order_at'))
        .orderBy('c.created_at', 'desc').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items.map((item) => {
      const result = { ...item, line_linked: Boolean(item.line_user_id) };
      if (!includeLineUserId) delete result.line_user_id;
      return result;
    }), count, paging);
  }
  async function customerDetail(id, { includeLineUserId = false } = {}) {
    const customer = await db('customers').where({ id }).first();
    if (!customer) throw new HttpError(404, 'customer_not_found', 'ไม่พบลูกค้า');
    const [addresses, orders, paid] = await Promise.all([
      db('customer_addresses as a').join('dormitories as d', 'd.id', 'a.dormitory_id').join('sois as s', 's.id', 'd.soi_id')
        .where({ 'a.customer_id': id }).select('a.*', 'd.name as dormitory_name', 's.name as soi_name').orderBy('a.is_default', 'desc'),
      db('orders as o').join('merchants as m', 'm.id', 'o.merchant_id').where({ 'o.customer_id': id })
        .select('o.id', 'o.order_code', 'o.status', 'o.payment_status', 'o.total_amount', 'o.created_at', 'm.store_name').orderBy('o.created_at', 'desc').limit(50),
      db('orders').where({ customer_id: id, payment_status: 'PAID' }).count('* as paid_orders').sum('total_amount as paid_total').first(),
    ]);
    const result = { ...customer, addresses, orders, payment_summary: paid, line_linked: Boolean(customer.line_user_id) };
    if (!includeLineUserId) delete result.line_user_id;
    return result;
  }
  async function setCustomerActive(actor, id, active, context) {
    await db.transaction(async (trx) => {
      const count = await trx('customers').where({ id }).update({ is_active: active, updated_at: trx.fn.now() });
      if (!count) throw new HttpError(404, 'customer_not_found', 'ไม่พบลูกค้า');
      await audit.append({ actorId: actor.id, action: active ? 'CUSTOMER_ACTIVATED' : 'CUSTOMER_DEACTIVATED', entityType: 'CUSTOMER', entityId: id, ip: context.ip }, trx);
    });
    return customerDetail(id);
  }

  function orderFilters(query, filters) {
    if (filters.q) query.where('o.order_code', 'ilike', `%${filters.q}%`);
    if (filters.merchantId) query.where({ 'o.merchant_id': filters.merchantId });
    if (filters.customerId) query.where({ 'o.customer_id': filters.customerId });
    if (filters.status) query.where({ 'o.status': filters.status });
    if (filters.paymentStatus) query.where({ 'o.payment_status': filters.paymentStatus });
    return applyDateRange(query, 'o.created_at', filters);
  }
  async function listOrders(filters) {
    const paging = pagination(filters);
    const base = () => orderFilters(db('orders as o'), filters);
    const [{ count }, items] = await Promise.all([
      base().count('* as count').first(),
      base().join('merchants as m', 'm.id', 'o.merchant_id').join('customers as c', 'c.id', 'o.customer_id')
        .select('o.id', 'o.order_code', 'o.status', 'o.payment_status', 'o.total_amount', 'o.created_at', 'm.store_name', 'c.display_name as customer_name')
        .orderBy('o.created_at', 'desc').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items, count, paging);
  }
  async function orderDetail(id) {
    const order = await db('orders as o').join('merchants as m', 'm.id', 'o.merchant_id').join('customers as c', 'c.id', 'o.customer_id')
      .leftJoin('merchant_staffs as r', 'r.id', 'o.assigned_rider_id')
      .select('o.*', 'm.store_name', 'c.display_name as customer_name', 'r.full_name as rider_name').where({ 'o.id': id }).first();
    if (!order) throw new HttpError(404, 'order_not_found', 'ไม่พบออเดอร์');
    const items = await db('order_items').where({ order_id: id }).orderBy('id');
    const ids = items.map((item) => item.id);
    const choices = ids.length ? await db('order_item_choices').whereIn('order_item_id', ids).orderBy('id') : [];
    const payments = await db('payments').where({ order_id: id })
      .select('id', 'method', 'status', 'verification_status', 'expected_amount', 'amount_transferred', 'provider', 'transaction_reference', 'verified_at', 'paid_at', 'created_at')
      .orderBy('created_at', 'desc');
    return { ...order, items: items.map((item) => ({ ...item, choices: choices.filter((choice) => choice.order_item_id === item.id) })), payments: payments.map((payment) => ({ ...payment, transaction_reference: mask(payment.transaction_reference) })) };
  }

  function paymentFilters(query, filters) {
    if (filters.q) query.whereILike('o.order_code', `%${filters.q}%`);
    if (filters.status) query.where((builder) => builder.where({ 'p.status': filters.status }).orWhere({ 'p.verification_status': filters.status }));
    if (filters.merchantId) query.where({ 'o.merchant_id': filters.merchantId });
    return applyDateRange(query, 'p.created_at', filters);
  }
  async function listPayments(filters) {
    const paging = pagination(filters);
    const base = () => paymentFilters(db('payments as p').join('orders as o', 'o.id', 'p.order_id'), filters);
    const [{ count }, items] = await Promise.all([
      base().count('* as count').first(),
      base().join('merchants as m', 'm.id', 'o.merchant_id').join('customers as c', 'c.id', 'o.customer_id')
        .select('p.id', 'p.status', 'p.verification_status', 'p.expected_amount', 'p.amount_transferred', 'p.provider', 'p.transaction_reference', 'p.verified_at', 'p.created_at', 'o.order_code', 'm.store_name', 'c.display_name as customer_name')
        .orderBy('p.created_at', 'desc').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items.map((item) => ({ ...item, transaction_reference: mask(item.transaction_reference) })), count, paging);
  }
  async function paymentDetail(id) {
    const payment = await db('payments as p').join('orders as o', 'o.id', 'p.order_id').join('merchants as m', 'm.id', 'o.merchant_id')
      .join('customers as c', 'c.id', 'o.customer_id').select('p.*', 'o.order_code', 'm.store_name', 'c.display_name as customer_name').where({ 'p.id': id }).first();
    if (!payment) throw new HttpError(404, 'payment_not_found', 'ไม่พบรายการชำระเงิน');
    const [slip, verifications] = await Promise.all([
      db('payment_slips').where({ payment_id: id }).select('id', 'object_key', 'file_hash', 'uploaded_at', 'purge_after', 'deleted_at').first(),
      db('payment_verifications').where({ payment_id: id })
        .select('id', 'provider', 'provider_request_id', 'status', 'failure_code', 'reported_amount', 'amount_matches', 'recipient_matches', 'provider_response', 'verified_at', 'created_at').orderBy('created_at', 'desc'),
    ]);
    return { ...payment, transaction_reference: mask(payment.transaction_reference), slip, verifications };
  }

  async function listDeliveryAreas(filters = {}) {
    const paging = pagination(filters);
    const [{ count }, items] = await Promise.all([
      db('sois').modify((query) => { if (filters.q) query.whereILike('name', `%${filters.q}%`); }).count('* as count').first(),
      db('sois as s').select('s.*')
        .select(db.raw('(select count(*)::int from dormitories d where d.soi_id = s.id and d.is_active = true) as dormitory_count'))
        .select(db.raw('(select count(*)::int from delivery_fees f where f.soi_id = s.id) as merchant_coverage'))
        .modify((query) => { if (filters.q) query.whereILike('s.name', `%${filters.q}%`); })
        .orderBy('s.name').limit(paging.limit).offset(paging.offset),
    ]);
    const ids = items.map((item) => item.id);
    const dormitories = ids.length ? await db('dormitories').whereIn('soi_id', ids).orderBy('name') : [];
    return pageResult(items.map((item) => ({ ...item, dormitories: dormitories.filter((dorm) => dorm.soi_id === item.id) })), count, paging);
  }
  async function saveSoi(actor, id, data, context) {
    let soiId = id;
    await db.transaction(async (trx) => {
      if (id) {
        if (!await trx('sois').where({ id }).update({ ...data, updated_at: trx.fn.now() })) throw new HttpError(404, 'soi_not_found');
      } else [{ id: soiId }] = await trx('sois').insert(data).returning('id');
      await audit.append({ actorId: actor.id, action: id ? 'SOI_UPDATED' : 'SOI_CREATED', entityType: 'SOI', entityId: soiId, ip: context.ip }, trx);
    });
    return db('sois').where({ id: soiId }).first();
  }
  async function saveDormitory(actor, id, data, context) {
    let dormitoryId = id;
    await db.transaction(async (trx) => {
      if (id) {
        if (!await trx('dormitories').where({ id }).update({ ...data, updated_at: trx.fn.now() })) throw new HttpError(404, 'dormitory_not_found');
      } else [{ id: dormitoryId }] = await trx('dormitories').insert(data).returning('id');
      await audit.append({ actorId: actor.id, action: id ? 'DORMITORY_UPDATED' : 'DORMITORY_CREATED', entityType: 'DORMITORY', entityId: dormitoryId, ip: context.ip }, trx);
    });
    return db('dormitories').where({ id: dormitoryId }).first();
  }

  async function listBanners(filters = {}, { publicOnly = false } = {}) {
    const paging = pagination(filters);
    const build = () => db('banners as b').leftJoin('merchants as m', 'm.id', 'b.merchant_id').whereNull('b.deleted_at')
      .modify((query) => {
        if (publicOnly) query.where('b.status', 'PUBLISHED').where((q) => q.whereNull('b.starts_at').orWhere('b.starts_at', '<=', db.fn.now()))
          .where((q) => q.whereNull('b.ends_at').orWhere('b.ends_at', '>', db.fn.now()));
        if (filters.q) query.whereILike('b.title', `%${filters.q}%`);
        if (filters.status) query.where({ 'b.status': filters.status });
      });
    const [{ count }, items] = await Promise.all([
      build().count('* as count').first(),
      build().select('b.*', 'm.store_name').orderBy('b.sort_order').orderBy('b.id').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items.map((item) => publicOnly ? {
      id: item.id, title: item.title, target_type: item.target_type, target_value: item.target_value,
      image_url: `/api/banners/${item.id}/image`,
    } : ({ ...item, image_url: `/api/banners/${item.id}/image` })), count, paging);
  }
  async function bannerImage(id) {
    const banner = await db('banners').where({ id, status: 'PUBLISHED' }).whereNull('deleted_at')
      .where((query) => query.whereNull('starts_at').orWhere('starts_at', '<=', db.fn.now()))
      .where((query) => query.whereNull('ends_at').orWhere('ends_at', '>', db.fn.now())).first('image_object_key');
    if (!banner) throw new HttpError(404, 'banner_not_found', 'ไม่พบแบนเนอร์');
    return banner.image_object_key;
  }
  async function bannerObjectKey(id) {
    const banner = await db('banners').where({ id }).whereNull('deleted_at').first('image_object_key');
    if (!banner) throw new HttpError(404, 'banner_not_found', 'ไม่พบแบนเนอร์');
    return banner.image_object_key;
  }
  async function saveBanner(actor, id, data, context) {
    let bannerId = id;
    await db.transaction(async (trx) => {
      const current = id ? await trx('banners').where({ id }).whereNull('deleted_at').first() : null;
      if (id && !current) throw new HttpError(404, 'banner_not_found');
      const final = { ...current, ...data };
      if ((final.scope === 'GLOBAL' && final.merchant_id !== null) || (final.scope === 'MERCHANT' && !final.merchant_id)) {
        throw new HttpError(400, 'invalid_banner_scope', 'scope และ merchant ไม่สอดคล้องกัน');
      }
      if (final.target_type === 'NONE' && final.target_value) {
        throw new HttpError(400, 'invalid_banner_target', 'NONE target ต้องไม่มี target value');
      }
      if (final.target_type !== 'NONE' && !final.target_value) {
        throw new HttpError(400, 'invalid_banner_target', 'target type นี้ต้องมี target value');
      }
      if (['STORE', 'MENU', 'PROMOTION'].includes(final.target_type) && !/^\d+$/.test(String(final.target_value))) {
        throw new HttpError(400, 'invalid_banner_target', 'target value ต้องเป็น ID');
      }
      if (final.target_type === 'URL' && !(final.target_value.startsWith('/') && !final.target_value.startsWith('//') && !final.target_value.includes('\\') || /^https:\/\//i.test(final.target_value))) {
        throw new HttpError(400, 'invalid_banner_target', 'URL target ต้องเป็น relative path หรือ HTTPS');
      }
      if (final.starts_at && final.ends_at && new Date(final.ends_at) <= new Date(final.starts_at)) {
        throw new HttpError(400, 'invalid_banner_dates', 'endsAt ต้องอยู่หลัง startsAt');
      }
      if (final.status === 'SCHEDULED' && !final.starts_at) throw new HttpError(400, 'banner_schedule_required', 'กรุณาระบุเวลาเริ่ม');
      if (id) {
        await trx('banners').where({ id }).update({ ...data, updated_at: trx.fn.now() });
      } else [{ id: bannerId }] = await trx('banners').insert({ ...data, created_by_admin_id: actor.id }).returning('id');
      const action = !id ? 'BANNER_CREATED' : data.status === 'PUBLISHED' ? 'BANNER_PUBLISHED' : data.status === 'ARCHIVED' ? 'BANNER_ARCHIVED' : 'BANNER_UPDATED';
      await audit.append({ actorId: actor.id, action, entityType: 'BANNER', entityId: bannerId, ip: context.ip, metadata: { status: data.status } }, trx);
    });
    return db('banners').where({ id: bannerId }).first();
  }

  async function listPromotions(filters = {}) {
    const paging = pagination(filters);
    const nowDate = new Date();
    const build = () => db('promotions as p').leftJoin('merchants as m', 'm.id', 'p.merchant_id').whereNull('p.deleted_at')
      .modify((query) => {
        if (filters.q) query.whereILike('p.name', `%${filters.q}%`);
        if (filters.status === 'active') query.where({ 'p.is_active': true }).where('p.starts_at', '<=', nowDate).where('p.ends_at', '>', nowDate);
        if (filters.status === 'upcoming') query.where({ 'p.is_active': true }).where('p.starts_at', '>', nowDate);
        if (filters.status === 'expired') query.where('p.ends_at', '<=', nowDate);
        if (filters.status === 'disabled') query.where({ 'p.is_active': false });
      });
    const [{ count }, items] = await Promise.all([
      build().count('* as count').first(),
      build().select('p.*', 'm.store_name').orderBy('p.created_at', 'desc').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items.map((item) => ({ ...item, visibility: !item.is_active ? 'DISABLED' : new Date(item.ends_at) <= nowDate ? 'EXPIRED' : new Date(item.starts_at) > nowDate ? 'UPCOMING' : 'ACTIVE' })), count, paging);
  }
  async function savePromotion(actor, id, data, context) {
    let promotionId = id;
    await db.transaction(async (trx) => {
      const current = id ? await trx('promotions').where({ id }).whereNull('deleted_at').forUpdate().first() : null;
      if (id && !current) throw new HttpError(404, 'promotion_not_found');
      const final = { ...current, ...data };
      if ((!id || final.is_active) && !['MERCHANT','PLATFORM'].includes(final.funding_source)) throw new HttpError(422, 'funding_source_required');
      if (final.promotion_type === 'PERCENTAGE' && Number(final.value) > 100) {
        throw new HttpError(400, 'invalid_promotion_value', 'Percentage ต้องไม่เกิน 100');
      }
      if (final.usage_limit !== null && final.usage_limit < (current?.usage_count || 0)) {
        throw new HttpError(409, 'promotion_limit_below_usage', 'ไม่สามารถลดสิทธิ์ต่ำกว่าจำนวนที่ใช้แล้ว');
      }
      if (new Date(final.ends_at) <= new Date(final.starts_at)) {
        throw new HttpError(400, 'invalid_promotion_dates', 'endsAt ต้องอยู่หลัง startsAt');
      }
      if (id) {
        await trx('promotions').where({ id }).update({ ...data, updated_at: trx.fn.now() });
      } else [{ id: promotionId }] = await trx('promotions').insert({ ...data, created_by_admin_id: actor.id }).returning('id');
      await audit.append({ actorId: actor.id, action: id ? 'PROMOTION_UPDATED' : 'PROMOTION_CREATED', entityType: 'PROMOTION', entityId: promotionId, ip: context.ip, metadata: { is_active: data.is_active } }, trx);
    });
    return db('promotions').where({ id: promotionId }).first();
  }

  async function listReviews(filters = {}) {
    const paging = pagination(filters);
    const build = () => db('reviews as r')
      .join('customers as c', 'c.id', 'r.customer_id')
      .join('merchants as m', 'm.id', 'r.merchant_id')
      .join('orders as o', 'o.id', 'r.order_id')
      .modify((query) => {
        if (filters.q) query.where((nested) => nested.whereILike('m.store_name', `%${filters.q}%`).orWhereILike('c.display_name', `%${filters.q}%`).orWhereILike('o.order_code', `%${filters.q}%`));
        if (filters.status) query.where({ 'r.status': String(filters.status).toUpperCase() });
      });
    const [{ count }, items] = await Promise.all([
      build().count('* as count').first(),
      build().select('r.*', 'c.display_name', 'm.store_name', 'o.order_code')
        .orderBy('r.created_at', 'desc').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items, count, paging);
  }

  async function setReviewStatus(actor, id, status, context) {
    if (!['PUBLISHED', 'HIDDEN'].includes(status)) throw new HttpError(400, 'invalid_review_status');
    let review;
    await db.transaction(async (trx) => {
      review = await trx('reviews').where({ id }).forUpdate().first();
      if (!review) throw new HttpError(404, 'review_not_found');
      await trx('reviews').where({ id }).update({ status, updated_at: trx.fn.now() });
      await audit.append({
        actorId: actor.id,
        action: status === 'HIDDEN' ? 'REVIEW_HIDDEN' : 'REVIEW_PUBLISHED',
        entityType: 'REVIEW', entityId: id, ip: context.ip,
        metadata: { merchant_id: review.merchant_id, status },
      }, trx);
    });
    return db('reviews').where({ id }).first();
  }

  async function listCoupons(filters = {}) {
    const paging = pagination(filters);
    const nowDate = new Date();
    const build = () => db('coupons as c').leftJoin('merchants as m', 'm.id', 'c.merchant_id').whereNull('c.deleted_at')
      .modify((query) => {
        if (filters.q) query.where((nested) => nested.whereILike('c.code', `%${filters.q}%`).orWhereILike('c.name', `%${filters.q}%`));
        if (filters.status === 'active') query.where({ 'c.is_active': true }).where('c.starts_at', '<=', nowDate).where('c.ends_at', '>', nowDate);
        if (filters.status === 'upcoming') query.where({ 'c.is_active': true }).where('c.starts_at', '>', nowDate);
        if (filters.status === 'expired') query.where('c.ends_at', '<=', nowDate);
        if (filters.status === 'disabled') query.where({ 'c.is_active': false });
      });
    const [{ count }, items] = await Promise.all([
      build().count('* as count').first(),
      build().select('c.*', 'm.store_name').orderBy('c.created_at', 'desc').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items.map((item) => ({
      ...item,
      visibility: !item.is_active ? 'DISABLED' : new Date(item.ends_at) <= nowDate ? 'EXPIRED' : new Date(item.starts_at) > nowDate ? 'UPCOMING' : 'ACTIVE',
    })), count, paging);
  }

  async function saveCoupon(actor, id, data, context) {
    let couponId = id;
    await db.transaction(async (trx) => {
      const current = id ? await trx('coupons').where({ id }).whereNull('deleted_at').forUpdate().first() : null;
      if (id && !current) throw new HttpError(404, 'coupon_not_found');
      const normalized = { ...data };
      if (normalized.code !== undefined) normalized.code = normalizeCouponCode(normalized.code);
      const final = { ...current, ...normalized };
      if ((!id || final.is_active) && !['MERCHANT','PLATFORM'].includes(final.funding_source)) throw new HttpError(422, 'funding_source_required');
      if (final.promotion_type === 'PERCENTAGE' && Number(final.value) > 100) throw new HttpError(400, 'invalid_coupon_value');
      if (new Date(final.ends_at) <= new Date(final.starts_at)) throw new HttpError(400, 'invalid_coupon_dates');
      for (const key of ['usage_limit', 'per_customer_limit']) {
        if (final[key] !== null && (!Number.isInteger(Number(final[key])) || Number(final[key]) < 1)) throw new HttpError(400, 'invalid_coupon_limit');
      }
      if (final.usage_limit !== null && Number(final.usage_limit) < Number(current?.usage_count || 0)) throw new HttpError(409, 'coupon_limit_below_usage');
      if (id) await trx('coupons').where({ id }).update({ ...normalized, updated_at: trx.fn.now() });
      else [{ id: couponId }] = await trx('coupons').insert({ ...normalized, created_by_admin_id: actor.id }).returning('id');
      await audit.append({
        actorId: actor.id,
        action: id ? normalized.is_active === false ? 'COUPON_DISABLED' : 'COUPON_UPDATED' : 'COUPON_CREATED',
        entityType: 'COUPON', entityId: couponId, ip: context.ip,
        metadata: { merchant_id: final.merchant_id, is_active: final.is_active },
      }, trx);
    });
    return db('coupons').where({ id: couponId }).first();
  }

  async function listAdmins(filters = {}) {
    const paging = pagination(filters);
    const build = () => db('platform_admins').whereNull('deleted_at').modify((query) => { if (filters.q) query.whereILike('username', `%${filters.q}%`); });
    const [{ count }, items] = await Promise.all([
      build().count('* as count').first(),
      build().select('id', 'username', 'full_name', 'email', 'role', 'is_active', 'last_login_at', 'created_at').orderBy('created_at').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items.map(cleanAdmin), count, paging);
  }
  async function saveAdmin(actor, id, data, context) {
    let adminId = id;
    await db.transaction(async (trx) => {
      await trx.raw("select pg_advisory_xact_lock(hashtext('platform_admin_management'))");
      const current = id ? await trx('platform_admins').where({ id }).whereNull('deleted_at').first() : null;
      if (id && !current) throw new HttpError(404, 'admin_not_found');
      if (current?.role === 'SUPER_ADMIN' && (data.role && data.role !== 'SUPER_ADMIN' || data.is_active === false)) {
        const [{ count }] = await trx('platform_admins').where({ role: 'SUPER_ADMIN', is_active: true }).whereNull('deleted_at').count('* as count');
        if (Number(count) <= 1) throw new HttpError(409, 'last_super_admin_required', 'ไม่สามารถลดสิทธิ์ผู้ดูแลสูงสุดคนสุดท้าย');
      }
      const changes = { ...data };
      if (changes.password) {
        if (Buffer.byteLength(changes.password, 'utf8') > 72) throw new HttpError(400, 'password_too_long', 'Password ต้องไม่เกิน 72 bytes');
        changes.password_hash = await bcrypt.hash(changes.password, 12);
        delete changes.password;
      }
      if (id) await trx('platform_admins').where({ id }).update({ ...changes, updated_at: trx.fn.now() });
      else {
        [{ id: adminId }] = await trx('platform_admins').insert(changes).returning('id');
      }
      if (id && (data.password || data.role || data.is_active === false)) {
        await trx('platform_admin_sessions').where({ admin_id: id }).whereNull('revoked_at').update({ revoked_at: trx.fn.now() });
      }
      await audit.append({ actorId: actor.id, action: id ? 'ADMIN_UPDATED' : 'ADMIN_CREATED', entityType: 'PLATFORM_ADMIN', entityId: adminId, ip: context.ip, metadata: { role: data.role, is_active: data.is_active } }, trx);
    });
    return cleanAdmin(await db('platform_admins').where({ id: adminId }).first());
  }

  async function listAudit(filters = {}) {
    const paging = pagination(filters);
    const build = () => db('audit_logs as l').leftJoin('platform_admins as a', function joinAdmin() {
      this.on('a.id', '=', 'l.actor_id').andOnVal('l.actor_type', '=', 'ADMIN');
    }).modify((query) => {
      if (filters.q) query.whereILike('l.action', `%${filters.q}%`);
      if (filters.action) query.where({ 'l.action': filters.action });
      if (filters.entity) query.where({ 'l.entity_type': filters.entity });
      if (filters.actorId) query.where({ 'l.actor_id': filters.actorId });
      applyDateRange(query, 'l.created_at', filters);
    });
    const [{ count }, items] = await Promise.all([
      build().count('* as count').first(),
      build().select('l.*', 'a.full_name as actor_name').orderBy('l.created_at', 'desc').limit(paging.limit).offset(paging.offset),
    ]);
    return pageResult(items, count, paging);
  }

  const allowedSettings = new Set(['platform_display_name', 'support_contact', 'default_banner_fallback', 'maintenance_message', 'safe_feature_flags']);
  async function settings() { return db('system_settings').select('*').orderBy('setting_key'); }
  async function saveSetting(actor, key, value, isPublic, context) {
    if (!allowedSettings.has(key)) throw new HttpError(400, 'setting_not_allowed', 'ค่านี้ไม่อนุญาตให้แก้ผ่าน UI');
    if (key === 'safe_feature_flags') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 30
        || Object.entries(value).some(([name, flag]) => !/^[a-z][a-z0-9_]{0,49}$/i.test(name) || /secret|password|token|key|credential/i.test(name) || typeof flag !== 'boolean')) {
        throw new HttpError(400, 'invalid_setting_value', 'Feature flags ต้องเป็นชื่อกับค่า boolean เท่านั้น');
      }
    } else if (typeof value !== 'string' || value.length > 2000) throw new HttpError(400, 'invalid_setting_value', 'ค่าต้องเป็นข้อความไม่เกิน 2000 ตัวอักษร');
    await db.transaction(async (trx) => {
      await trx('system_settings').insert({ setting_key: key, setting_value: JSON.stringify(value), is_public: isPublic, updated_by_admin_id: actor.id })
        .onConflict('setting_key').merge({ setting_value: JSON.stringify(value), is_public: isPublic, updated_by_admin_id: actor.id, updated_at: trx.fn.now() });
      await audit.append({ actorId: actor.id, action: 'SETTINGS_UPDATED', entityType: 'SYSTEM_SETTING', entityId: key, ip: context.ip }, trx);
    });
    return db('system_settings').where({ setting_key: key }).first();
  }

  async function systemStatus(checkDatabase) {
    const currentConfig = typeof config === 'function' ? await config() : config;
    const [database, migration, outbox, verification, retention] = await Promise.all([
      checkDatabase(),
      db('knex_migrations').select('name', 'batch').orderBy('id', 'desc').first(),
      db('notification_outbox').select(db.raw("count(*) filter (where status = 'PENDING')::int as pending"), db.raw("count(*) filter (where status = 'RETRY')::int as retry"), db.raw("count(*) filter (where status = 'PROCESSING' and updated_at < now() - interval '10 minutes')::int as stuck")).first(),
      db('payment_verifications').whereIn('status', ['REJECTED', 'ERROR']).where('created_at', '>=', db.raw("now() - interval '24 hours'")).count('* as recent_failures').first(),
      db('payment_slips').whereNull('deleted_at').where('purge_after', '<=', db.fn.now()).count('* as pending').first(),
    ]);
    return {
      database: { ...database, latest_migration: migration?.name || null },
      line: { configured: Boolean(currentConfig.lineChannelId), messaging_mode: currentConfig.lineMessagingMode || 'disabled', webhook_configured: Boolean(currentConfig.lineWebhookConfigured), outbox },
      checkslip: { configured: Boolean(currentConfig.checkslipConfigured), mode: currentConfig.paymentMode || 'mock', recent_failures: Number(verification.recent_failures) },
      object_storage: { configured: currentConfig.storageMode === 'object', mode: currentConfig.storageMode || 'local', retention_pending: Number(retention.pending) },
      notification_worker: outbox,
      application: { environment: process.env.NODE_ENV || 'development', version: process.env.APP_VERSION || 'local', uptime_seconds: Math.floor(process.uptime()) },
    };
  }

  async function reports() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [summary, topMerchants, topItems] = await Promise.all([
      db('orders').where('created_at', '>=', today).select(
        db.raw('count(*)::int as orders'), db.raw("coalesce(sum(total_amount) filter (where status='COMPLETED' and payment_status='PAID'),0) as gross"),
        db.raw("coalesce(avg(total_amount) filter (where status='COMPLETED' and payment_status='PAID'),0) as average_order_value"),
        db.raw("coalesce(100.0 * count(*) filter (where status='COMPLETED') / nullif(count(*),0),0) as completed_percent"),
        db.raw("coalesce(100.0 * count(*) filter (where status in ('CANCELLED','REJECTED')) / nullif(count(*),0),0) as cancel_reject_percent"),
        db.raw("coalesce(100.0 * count(*) filter (where payment_status='PAID') / nullif(count(*),0),0) as payment_success_percent"),
      ).first(),
      db('orders as o').join('merchants as m', 'm.id', 'o.merchant_id').where('o.created_at', '>=', today)
        .groupBy('m.id', 'm.store_name').select('m.id', 'm.store_name').count('o.id as orders').select(db.raw("coalesce(sum(o.total_amount) filter (where o.status='COMPLETED' and o.payment_status='PAID'),0) as revenue")).orderBy('revenue', 'desc').limit(10),
      db('order_items as i').join('orders as o', 'o.id', 'i.order_id').where('o.created_at', '>=', today)
        .where({ 'o.status': 'COMPLETED', 'o.payment_status': 'PAID' })
        .groupBy('i.item_name').select('i.item_name').sum('i.quantity as quantity').orderBy('quantity', 'desc').limit(10),
    ]);
    return {
      summary,
      top_merchants: topMerchants,
      top_items: topItems,
      definition: 'Today in server timezone; revenue/AOV and top items require COMPLETED + PAID and use net order total after discount, including delivery',
    };
  }

  return {
    dashboard, listMerchants, merchantDetail, setMerchantActive,
    listCustomers, customerDetail, setCustomerActive,
    listOrders, orderDetail, listPayments, paymentDetail,
    listDeliveryAreas, saveSoi, saveDormitory,
    listBanners, bannerImage, bannerObjectKey, saveBanner, listPromotions, savePromotion,
    listReviews, setReviewStatus, listCoupons, saveCoupon,
    listAdmins, saveAdmin, listAudit, settings, saveSetting,
    systemStatus, reports,
  };
}

module.exports = { createAdminService, mask, pagination };
