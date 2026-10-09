const { HttpError } = require('./http.cjs');
function contentManagement({ db, permit, paged, storage }) {
  const bannerScope = (staff) =>
    db('banners')
      .whereNull('deleted_at')
      .where((q) =>
        q
          .where({ merchant_id: staff.merchant_id })
          .orWhere((q) => q.where({ scope: 'GLOBAL', status: 'PUBLISHED' })),
      );
  async function promotions(staff, q = {}) {
    permit(staff);
    return paged(
      db('promotions')
        .whereNull('deleted_at')
        .where((q) => q.where({ merchant_id: staff.merchant_id }).orWhereNull('merchant_id'))
        .select(
          'id',
          'name',
          'description',
          'merchant_id',
          'promotion_type',
          'value',
          'minimum_order_amount',
          'maximum_discount_amount',
          'starts_at',
          'ends_at',
          'usage_limit',
          'usage_count',
          'is_active',
        )
        .orderBy('id', 'desc'),
      q,
    );
  }
  async function banners(staff, q = {}) {
    permit(staff);
    const result = await paged(
      bannerScope(staff)
        .select(
          'id',
          'title',
          'scope',
          'merchant_id',
          'target_type',
          'target_value',
          'status',
          'starts_at',
          'ends_at',
          'sort_order',
        )
        .orderBy('sort_order')
        .orderBy('id'),
      q,
    );
    return {
      ...result,
      items: result.items.map((row) => ({
        ...row,
        image_url: `/api/merchant/management/banners/${row.id}/image`,
      })),
    };
  }
  async function bannerImage(staff, id) {
    permit(staff);
    const row = await bannerScope(staff).where({ id }).first();
    if (!row) throw new HttpError(404, 'banner_not_found');
    try {
      return await storage.read(row.image_object_key);
    } catch {
      throw new HttpError(404, 'image_not_found');
    }
  }
  async function reviews(staff, q = {}) {
    permit(staff, ['MANAGER', 'CASHIER']);
    const aggregate = await db('reviews').where({ merchant_id: staff.merchant_id, status: 'PUBLISHED' })
      .select(db.raw('coalesce(round(avg(rating)::numeric,1),0) as average_rating'), db.raw('count(*)::int as review_count')).first();
    const result = await paged(
      db('reviews as r').join('customers as c', 'c.id', 'r.customer_id').join('orders as o', 'o.id', 'r.order_id')
        .where({ 'r.merchant_id': staff.merchant_id, 'r.status': 'PUBLISHED' })
        .select('r.id', 'r.rating', 'r.comment', 'r.created_at', 'c.display_name', 'o.order_code')
        .orderBy('r.created_at', 'desc'), q,
    );
    return { ...result, average_rating: Number(aggregate.average_rating), review_count: aggregate.review_count };
  }
  return { promotions, banners, bannerImage, reviews };
}
module.exports = { contentManagement };
