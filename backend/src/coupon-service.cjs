const { HttpError } = require("./http.cjs");
const { calculateDiscount } = require("./promotion-service.cjs");

const publicColumns = [
  "id",
  "code",
  "name",
  "description",
  "merchant_id",
  "promotion_type",
  "value",
  "minimum_order_amount",
  "maximum_discount_amount",
  "starts_at",
  "ends_at",
];

function normalizeCouponCode(value) {
  if (typeof value !== "string")
    throw new HttpError(400, "invalid_coupon_code");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    throw new HttpError(
      400,
      "invalid_coupon_code",
      "โค้ดส่วนลดต้องมี 3–32 ตัวอักษร",
    );
  }
  return code;
}

function couponDiscount(coupon, amounts) {
  try {
    return calculateDiscount(coupon, amounts);
  } catch (error) {
    const mapped = {
      promotion_minimum_not_met: [
        "coupon_minimum_not_met",
        "ยอดอาหารไม่ถึงขั้นต่ำของคูปอง",
      ],
      promotion_delivery_only: [
        "coupon_delivery_only",
        "คูปองนี้ใช้ได้กับการจัดส่งเท่านั้น",
      ],
      promotion_zero_total_unsupported: [
        "coupon_zero_total_unsupported",
        "คูปองนี้ทำให้ยอดชำระเป็นศูนย์ ซึ่งยังไม่รองรับ",
      ],
      invalid_promotion_type: ["invalid_coupon_type", "ประเภทคูปองไม่ถูกต้อง"],
    }[error.code];
    if (!mapped) throw error;
    throw new HttpError(error.status || 422, mapped[0], mapped[1]);
  }
}

function createCouponService(db) {
  async function resolve(trx, rawCode, context) {
    if (rawCode == null || rawCode === "")
      return { coupon: null, discount: 0, snapshot: null };
    const code = normalizeCouponCode(rawCode);
    const coupon = await trx("coupons")
      .whereRaw("lower(code) = lower(?)", [code])
      .whereNull("deleted_at")
      .forUpdate()
      .first();
    const now = new Date();
    if (
      !coupon ||
      !coupon.is_active ||
      new Date(coupon.starts_at) > now ||
      new Date(coupon.ends_at) <= now
    ) {
      throw new HttpError(
        422,
        "coupon_unavailable",
        "คูปองยังไม่เริ่ม หมดอายุ หรือไม่พร้อมใช้งาน",
      );
    }
    if (
      coupon.merchant_id !== null &&
      Number(coupon.merchant_id) !== Number(context.merchantId)
    ) {
      throw new HttpError(
        422,
        "coupon_wrong_merchant",
        "คูปองนี้ใช้กับร้านอื่น",
      );
    }
    if (
      coupon.usage_limit !== null &&
      coupon.usage_count >= coupon.usage_limit
    ) {
      throw new HttpError(
        409,
        "coupon_usage_limit",
        "สิทธิ์คูปองถูกใช้ครบแล้ว",
      );
    }
    if (coupon.per_customer_limit !== null) {
      const { count } = await trx("coupon_redemptions")
        .where({ coupon_id: coupon.id, customer_id: context.customerId })
        .count("* as count")
        .first();
      if (Number(count) >= coupon.per_customer_limit)
        throw new HttpError(
          409,
          "coupon_customer_limit",
          "คุณใช้คูปองนี้ครบจำนวนแล้ว",
        );
    }
    const discount = couponDiscount(coupon, context);
    const snapshot = Object.fromEntries(
      publicColumns.map((key) => [key, coupon[key]]),
    );
    return {
      coupon,
      discount,
      snapshot: {
        funding_source: coupon.funding_source,
        ...snapshot,
        calculation_version: 1,
        discount_satang: discount,
        quota_policy: "ORDER_CREATED_NO_AUTO_RELEASE",
      },
    };
  }

  async function redeem(trx, { coupon, orderId, customerId, discount }) {
    if (!coupon) return;
    await trx("coupon_redemptions").insert({
      coupon_id: coupon.id,
      customer_id: customerId,
      order_id: orderId,
      discount_amount: (discount / 100).toFixed(2),
    });
    await trx("coupons")
      .where({ id: coupon.id })
      .increment("usage_count", 1)
      .update({ updated_at: trx.fn.now() });
  }

  async function validate(rawCode, context) {
    return db.transaction(async (trx) => {
      const result = await resolve(trx, rawCode, context);
      return {
        code: result.snapshot?.code,
        name: result.snapshot?.name,
        discount_amount: result.discount / 100,
      };
    });
  }

  return { resolve, redeem, validate, normalizeCouponCode };
}

module.exports = { createCouponService, normalizeCouponCode, couponDiscount };
