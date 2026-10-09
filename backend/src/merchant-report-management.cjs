const { HttpError } = require('./http.cjs');
const { str } = require('./merchant-validation.cjs');
function reportManagement({ db, permit, paged }) {
  async function history(staff, q = {}) {
    permit(staff, ['MANAGER', 'CASHIER']);
    const query = db('orders as o')
      .join('customers as c', 'c.id', 'o.customer_id')
      .select(
        'o.id',
        'o.order_code',
        'c.display_name as customer_name',
        'o.total_amount',
        'o.status',
        'o.payment_status',
        'o.created_at',
        'o.completed_at',
      )
      .where('o.merchant_id', staff.merchant_id)
      .orderBy('o.id', 'desc');
    if (q.search) query.whereILike('o.order_code', '%' + str(q.search, 64) + '%');
    if (q.status) query.where('o.status', str(q.status, 30));
    if (q.payment_status) query.where('o.payment_status', str(q.payment_status, 30));
    if (q.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date) || Number.isNaN(Date.parse(q.date)))
        throw new HttpError(400, 'invalid_date');
      if (new Date(q.date).toISOString().slice(0, 10) !== q.date) throw new HttpError(400, 'invalid_date');
      query
        .where('o.created_at', '>=', new Date(q.date + 'T00:00:00+07:00'))
        .where('o.created_at', '<', new Date(new Date(q.date + 'T00:00:00+07:00').valueOf() + 86400000));
    }
    return paged(query, q);
  }

  async function reports(staff, q = {}) {
    permit(staff, ['MANAGER', 'CASHIER']);
    const days = Number(q.days || 1);
    if (![1, 7, 30].includes(days)) throw new HttpError(400, 'invalid_report_period');
    const since = db.raw(
      "(date_trunc('day',now() AT TIME ZONE 'Asia/Bangkok') - (? * interval '1 day')) AT TIME ZONE 'Asia/Bangkok'",
      [days - 1],
    );
    const base = () =>
      db('orders as o').where('o.merchant_id', staff.merchant_id).where('o.created_at', '>=', since);
    const aggregate = () => [
      db.raw('count(*)::int as orders'),
      db.raw("count(*) filter(where o.status='COMPLETED')::int as completed"),
      db.raw(
        "coalesce(sum(o.total_amount) filter(where o.status='COMPLETED' AND o.payment_status='PAID'),0) as revenue",
      ),
      db.raw(
        "coalesce(avg(o.total_amount) filter(where o.status='COMPLETED' AND o.payment_status='PAID'),0) as average_order_value",
      ),
    ];
    const summary = await base().select(aggregate()).first();
    const by_day = await base()
      .select(db.raw("to_char(o.created_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') as day"), ...aggregate())
      .groupByRaw("to_char(o.created_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')")
      .orderBy('day');
    const status = await base().select('o.status').count('* as count').groupBy('o.status');
    const best = await base()
      .join('order_items as i', 'i.order_id', 'o.id')
      .where({ 'o.status': 'COMPLETED', 'o.payment_status': 'PAID' })
      .select('i.item_name')
      .sum('i.quantity as quantity')
      .groupBy('i.item_name')
      .orderBy('quantity', 'desc')
      .limit(10);
    const options =
      staff.role === 'MANAGER'
        ? await base()
            .join('order_items as i', 'i.order_id', 'o.id')
            .join('order_item_choices as c', 'c.order_item_id', 'i.id')
            .where({ 'o.status': 'COMPLETED', 'o.payment_status': 'PAID' })
            .select('c.choice_name')
            .sum('i.quantity as quantity')
            .groupBy('c.choice_name')
            .orderBy('quantity', 'desc')
            .limit(10)
        : [];
    return {
      summary,
      by_day,
      status,
      best,
      options,
      days,
      definition:
        'Asia/Bangkok; cohort = orders created in period; revenue/AOV = COMPLETED + PAID net total after discount, including delivery; item/choice rankings use historical snapshots',
    };
  }
  return { history, reports };
}
module.exports = { reportManagement };
