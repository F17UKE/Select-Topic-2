const {openingStatus}=require('./opening-hours.cjs');
const { HttpError } = require('./http.cjs');

const asMoney = (value) => Number(value);

function createStoreRepository(db) {
  async function customerSoi(customerId, addressId) {
    let query = db('customer_addresses as a')
      .join('dormitories as d', 'd.id', 'a.dormitory_id')
      .join('sois as s', 's.id', 'd.soi_id')
      .select('a.id as address_id', 's.id as soi_id', 's.name as soi_name')
      .where('a.customer_id', customerId);
    query = addressId ? query.andWhere('a.id', addressId) : query.andWhere('a.is_default', true);
    const address = await query.first();
    if (addressId && !address) throw new HttpError(404, 'address_not_found');
    return address || null;
  }

  async function enrichMerchants(rows, address) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const hours = await db('merchant_opening_hours').whereIn('merchant_id',ids);
    const images = await db('merchant_images')
      .select('id', 'merchant_id', 'image_url', 'alt_text', 'is_primary', 'sort_order')
      .whereIn('merchant_id', ids)
      .orderBy([{ column: 'is_primary', order: 'desc' }, { column: 'sort_order' }]);
    const fees = address ? await db('delivery_fees')
      .select('merchant_id', 'fee')
      .whereIn('merchant_id', ids).andWhere('soi_id', address.soi_id) : [];
    const feeByMerchant = new Map(fees.map((fee) => [fee.merchant_id, asMoney(fee.fee)]));
    return rows.map((row) => {
      const gallery = images.filter((image) => image.merchant_id === row.id);
      return {
        ...row,
        average_rating: asMoney(row.average_rating),
        review_count: Number(row.review_count || 0),
        opening_status: openingStatus(row,hours.filter(h=>Number(h.merchant_id)===Number(row.id))),
        accepting_orders: row.is_active && openingStatus(row,hours.filter(h=>Number(h.merchant_id)===Number(row.id)))==='OPEN',
        unavailable_reason: !row.is_active ? 'merchant_suspended' : openingStatus(row,hours.filter(h=>Number(h.merchant_id)===Number(row.id)))!=='OPEN' ? 'merchant_closed' : null,
        primary_image: gallery.find((image) => image.is_primary)?.image_url || gallery[0]?.image_url || null,
        delivery: address ? {
          address_id: address.address_id,
          soi_id: address.soi_id,
          soi_name: address.soi_name,
          available: feeByMerchant.has(row.id),
          fee: feeByMerchant.get(row.id) ?? null,
        } : null,
      };
    });
  }

  function engagementColumns(customerId) {
    return [
      db.raw('exists(select 1 from customer_favorite_merchants cf where cf.customer_id = ? and cf.merchant_id = m.id) as is_favorite', [customerId]),
      db.raw("coalesce((select round(avg(r.rating)::numeric,1) from reviews r where r.merchant_id = m.id and r.status = 'PUBLISHED'),0) as average_rating"),
      db.raw("(select count(*)::int from reviews r where r.merchant_id = m.id and r.status = 'PUBLISHED') as review_count"),
    ];
  }

  async function listMerchants({ customerId, addressId, search, favoriteOnly = false }) {
    const address = await customerSoi(customerId, addressId);
    const query = db('merchants as m')
      .distinct('m.id', 'm.store_name', 'm.phone', 'm.location_text', 'm.is_open', 'm.is_active', ...engagementColumns(customerId))
      .leftJoin('menu_items as mi', function joinItems() {
        this.on('mi.merchant_id', '=', 'm.id').andOnNull('mi.deleted_at');
      })
      .whereNull('m.deleted_at');
    if (favoriteOnly) query.whereExists(db('customer_favorite_merchants as favorite')
      .select(db.raw('1')).whereRaw('favorite.merchant_id = m.id').where({ 'favorite.customer_id': customerId }));
    if (search) {
      const pattern = `%${search}%`;
      query.andWhere((builder) => builder.whereILike('m.store_name', pattern).orWhereILike('mi.name', pattern));
    }
    query.orderBy([{ column: 'm.is_open', order: 'desc' }, { column: 'm.store_name' }]).limit(50);
    return enrichMerchants(await query, address);
  }

  async function menuForMerchant(merchantId) {
    const categories = await db('menu_categories')
      .select('id', 'merchant_id', 'name', 'sort_order')
      .where({ merchant_id: merchantId, is_active: true }).whereNull('deleted_at')
      .orderBy('sort_order');
    const categoryIds = categories.map((category) => category.id);
    const items = categoryIds.length ? await db('menu_items')
      .select('id', 'merchant_id', 'category_id', 'name', 'description', 'image_url', 'price', 'is_available', 'stock_quantity', 'sort_order')
      .where({ merchant_id: merchantId }).whereIn('category_id', categoryIds).whereNull('deleted_at')
      .orderBy('sort_order') : [];
    return categories.map((category) => ({
      ...category,
      items: items.filter((item) => item.category_id === category.id).map((item) => ({ ...item, price: asMoney(item.price) })),
    }));
  }

  async function merchantById({ customerId, merchantId, addressId }) {
    const merchant = await db('merchants as m')
      .select('m.id', 'm.store_name', 'm.phone', 'm.location_text', 'm.is_open', 'm.is_active', ...engagementColumns(customerId))
      .where({ 'm.id': merchantId }).whereNull('m.deleted_at').first();
    if (!merchant) throw new HttpError(404, 'merchant_not_found');
    const [enriched] = await enrichMerchants([merchant], await customerSoi(customerId, addressId));
    const gallery = await db('merchant_images')
      .select('id', 'image_url', 'alt_text', 'is_primary', 'sort_order')
      .where({ merchant_id: merchantId })
      .orderBy([{ column: 'is_primary', order: 'desc' }, { column: 'sort_order' }]);
    return { ...enriched, gallery, categories: await menuForMerchant(merchantId) };
  }

  async function menuItemById(itemId) {
    const item = await db('menu_items as mi')
      .join('merchants as m', 'm.id', 'mi.merchant_id')
      .join('menu_categories as c', 'c.id', 'mi.category_id')
      .select(
        'mi.id', 'mi.merchant_id', 'm.store_name', 'mi.category_id', 'c.name as category_name',
        'm.is_active as merchant_is_active', 'm.is_open as merchant_is_open',
        'mi.name', 'mi.description', 'mi.image_url', 'mi.price', 'mi.is_available', 'mi.stock_quantity',
      )
      .where({ 'mi.id': itemId, 'c.is_active': true }).whereNull('mi.deleted_at').whereNull('c.deleted_at').whereNull('m.deleted_at').first();
    if (!item) throw new HttpError(404, 'menu_item_not_found');
    const groups = await db('menu_option_groups')
      .select('id', 'name', 'is_required', 'min_choices', 'max_choices', 'sort_order')
      .where({ menu_item_id: itemId }).orderBy('sort_order');
    const groupIds = groups.map((group) => group.id);
    const choices = groupIds.length ? await db('menu_option_choices')
      .select('id', 'option_group_id', 'name', 'extra_price', 'is_available', 'sort_order')
      .whereIn('option_group_id', groupIds).orderBy('sort_order') : [];
    return {
      ...item,
      accepting_orders: item.merchant_is_active && openingStatus({is_open:item.merchant_is_open},await db('merchant_opening_hours').where({merchant_id:item.merchant_id}))==='OPEN',
      price: asMoney(item.price),
      option_groups: groups.map((group) => ({
        ...group,
        choices: choices.filter((choice) => choice.option_group_id === group.id)
          .map((choice) => ({ ...choice, extra_price: asMoney(choice.extra_price) })),
      })),
    };
  }

  return {
    listMerchants,
    listFavoriteMerchants: ({ customerId, addressId }) => listMerchants({ customerId, addressId, search: null, favoriteOnly: true }),
    merchantById, menuForMerchant, menuItemById,
  };
}

module.exports = { createStoreRepository };
