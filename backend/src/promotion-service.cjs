const { HttpError } = require('./http.cjs');

function satang(value) {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new HttpError(422, 'invalid_money');
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}
function calculateDiscount(promotion, { subtotal, deliveryFee, deliveryType }) {
  if (subtotal < satang(promotion.minimum_order_amount)) throw new HttpError(422, 'promotion_minimum_not_met', 'ยอดอาหารไม่ถึงขั้นต่ำของโปรโมชัน');
  let discount;
  if (promotion.promotion_type === 'PERCENTAGE') {
    // Integer basis points; half-satang rounds up, without float multiplication.
    discount = Number((BigInt(subtotal) * BigInt(satang(promotion.value)) + 5000n) / 10000n);
  } else if (promotion.promotion_type === 'FIXED_AMOUNT') discount = satang(promotion.value);
  else if (promotion.promotion_type === 'FREE_DELIVERY') {
    if (deliveryType !== 'DELIVERY') throw new HttpError(422, 'promotion_delivery_only');
    discount = deliveryFee;
  } else throw new HttpError(422, 'invalid_promotion_type');
  discount = Math.min(discount, promotion.promotion_type === 'FREE_DELIVERY' ? deliveryFee : subtotal);
  if (promotion.maximum_discount_amount !== null) discount = Math.min(discount, satang(promotion.maximum_discount_amount));
  // The existing flow requires a positive PromptPay amount; zero-pay fulfillment is not implemented.
  if (subtotal + deliveryFee - discount <= 0) throw new HttpError(422, 'promotion_zero_total_unsupported', 'โปรโมชันนี้ทำให้ยอดชำระเป็นศูนย์ ซึ่งยังไม่รองรับ กรุณาเลือกโปรโมชันอื่น');
  return discount;
}

const publicColumns = ['id', 'name', 'description', 'merchant_id', 'promotion_type', 'value', 'minimum_order_amount', 'maximum_discount_amount', 'starts_at', 'ends_at'];
function createPromotionService(db) {
  function eligible(query) {
    return query.where({ is_active: true }).whereNull('deleted_at')
      .where('starts_at', '<=', db.fn.now()).where('ends_at', '>', db.fn.now())
      .where((q) => q.whereNull('usage_limit').orWhereColumn('usage_count', '<', 'usage_limit'));
  }
  async function list(merchantId = null) {
    const query = eligible(db('promotions'));
    if (merchantId !== null) query.where((q) => q.whereNull('merchant_id').orWhere('merchant_id', merchantId));
    return query.select(publicColumns).orderBy('ends_at').orderBy('id').limit(50);
  }
  async function detail(id) {
    const promotion = await eligible(db('promotions')).where({ id }).select(publicColumns).first();
    if (!promotion) throw new HttpError(404, 'promotion_unavailable');
    return promotion;
  }
  async function resolve(trx, id, { merchantId, subtotal, deliveryFee, deliveryType }) {
    if (!id) return { discount: 0, snapshot: null };
    const promotion = await trx('promotions').where({ id }).forUpdate().first();
    const [{ now }] = (await trx.raw('SELECT clock_timestamp() AS now')).rows;
    if (!promotion || !promotion.is_active || promotion.deleted_at
      || new Date(promotion.starts_at) > now || new Date(promotion.ends_at) <= now) {
      throw new HttpError(422, 'promotion_unavailable', 'โปรโมชันยังไม่เริ่ม หมดอายุ หรือไม่พร้อมใช้งาน');
    }
    if (promotion.merchant_id !== null && promotion.merchant_id !== merchantId) throw new HttpError(422, 'promotion_wrong_merchant');
    if (promotion.usage_limit !== null && promotion.usage_count >= promotion.usage_limit) throw new HttpError(409, 'promotion_usage_limit', 'สิทธิ์โปรโมชันถูกใช้ครบแล้ว');
    const discount = calculateDiscount(promotion, { subtotal, deliveryFee, deliveryType });
    const snapshot = Object.fromEntries(publicColumns.map((key) => [key, promotion[key]]));
    return { discount, snapshot: { ...snapshot, funding_source: promotion.funding_source, calculation_version: 1, discount_satang: discount, quota_policy: 'ORDER_CREATED_NO_AUTO_RELEASE' } };
  }
  async function redeem(trx, { promotionId, orderId, customerId, discount }) {
    if (!promotionId) return;
    // resolve() holds the promotion row lock through order creation and redemption commit.
    await trx('promotion_redemptions').insert({ promotion_id: promotionId, order_id: orderId, customer_id: customerId, discount_amount: (discount / 100).toFixed(2) });
    await trx('promotions').where({ id: promotionId }).increment('usage_count', 1).update({ updated_at: trx.fn.now() });
  }
  return { list, detail, resolve, redeem };
}
module.exports = { createPromotionService, calculateDiscount, satang };
