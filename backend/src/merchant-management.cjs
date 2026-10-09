const { HttpError } = require('./http.cjs');
const { createAdminAudit } = require('./admin-audit.cjs');

function permit(staff, roles = ['MANAGER']) {
  if (!roles.includes(staff.role)) throw new HttpError(403, 'staff_permission_denied');
}
function paging(q = {}) {
  const page = Math.min(100000, Math.max(1, parseInt(q.page, 10) || 1));
  const limit = Math.min(50, Math.max(1, parseInt(q.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
async function paged(query, q) {
  const p = paging(q);
  const count = await query.clone().clearSelect().clearOrder().count('* as count').first();
  const items = await query.limit(p.limit).offset(p.offset);
  return { items, pagination: { page: p.page, limit: p.limit, total: Number(count.count) } };
}
function createMerchantManagement({ db, storage, staffAuth }) {
  const audit = createAdminAudit(db);
  async function owned(trx, table, id, staff) {
    const row = await trx(table).where({ id, merchant_id: staff.merchant_id }).first();
    if (!row || row.deleted_at) throw new HttpError(404, 'record_not_found');
    return row;
  }
  async function write(staff, action, entity, operation) {
    permit(staff);
    return db.transaction(async (trx) => {
      await trx('merchants').where({ id: staff.merchant_id }).forUpdate().first();
      const current = await trx('merchant_staffs')
        .where({ id: staff.id, merchant_id: staff.merchant_id, role: 'MANAGER', is_active: true })
        .whereNull('deleted_at')
        .first();
      if (!current) throw new HttpError(403, 'staff_permission_denied');
      const result = await operation(trx);
      await audit.append(
        {
          actorType: 'MERCHANT_STAFF',
          actorId: staff.id,
          action,
          entityType: entity,
          entityId: result?.id || staff.merchant_id,
          metadata: { merchant_id: staff.merchant_id },
        },
        trx,
      );
      return result;
    });
  }
  async function dashboard(staff) {
    permit(staff, ['MANAGER', 'CASHIER', 'KITCHEN']);
    const today = db.raw(
      "(date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')",
    );
    const results = [];
    for (const query of [
      db('orders')
        .where({ merchant_id: staff.merchant_id })
        .where('created_at', '>=', today)
        .select(
          db.raw('count(*)::int as orders_today'),
          db.raw("count(*) filter (where status='COMPLETED')::int as completed_orders"),
          db.raw(
            "coalesce(sum(total_amount) filter (where status='COMPLETED' and payment_status='PAID'),0) as revenue_today",
          ),
          db.raw(
            "coalesce(avg(total_amount) filter (where status='COMPLETED' and payment_status='PAID'),0) as average_order_value",
          ),
        )
        .first(),
      db('orders')
        .where({ merchant_id: staff.merchant_id })
        .whereIn('status', ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'])
        .select('status')
        .count('* as count')
        .groupBy('status'),
      db('orders')
        .where({ merchant_id: staff.merchant_id })
        .select('id', 'order_code', 'status', 'payment_status', 'created_at')
        .orderBy('id', 'desc')
        .limit(8),
      db('order_items as i')
        .join('orders as o', 'o.id', 'i.order_id')
        .where({ 'o.merchant_id': staff.merchant_id, 'o.status': 'COMPLETED', 'o.payment_status': 'PAID' })
        .where('o.created_at', '>=', today)
        .select('i.item_name')
        .sum('i.quantity as quantity')
        .groupBy('i.item_name')
        .orderBy('quantity', 'desc')
        .limit(5),
      db('merchant_staffs')
        .where({ merchant_id: staff.merchant_id, role: 'RIDER', is_active: true })
        .whereNull('deleted_at')
        .count('* as count')
        .first(),
    ])
      results.push(await query);
    const [metrics, status, recent, best, riders] = results;
    if (staff.role === 'KITCHEN') {
      delete metrics.revenue_today;
      delete metrics.average_order_value;
    }
    return {
      metrics: { ...metrics, active_riders: Number(riders.count) },
      today_status: await db('orders').where({ merchant_id: staff.merchant_id }).where('created_at', '>=', today)
        .select('status').count('* as count').groupBy('status'),
      status,
      recent,
      best,
      definition:
        'Asia/Bangkok; orders created today; revenue/AOV = COMPLETED + PAID, net of discount; active queues include earlier days',
    };
  }
  const storeApi = require('./merchant-store-management.cjs').storeManagement({
    db,
    storage,
    write,
    owned,
    permit,
  });

  return {
    ...require('./merchant-content-management.cjs').contentManagement({ db, permit, paged, storage }),
    ...require('./merchant-report-management.cjs').reportManagement({ db, permit, paged }),
    ...require('./merchant-staff-management.cjs').staffManagement({
      db,
      write,
      owned,
      permit,
      paged,
      staffAuth,
    }),
    ...require('./merchant-delivery-management.cjs').deliveryManagement({ db, write, permit, paged }),
    ...require('./merchant-catalog-management.cjs').catalogManagement({
      db,
      write,
      owned,
      permit,
      paged,
      imageUrl: storeApi.imageUrl,
    }),
    dashboard,
    ...storeApi,
  };
}
module.exports = { createMerchantManagement, permit, paging, paged };
