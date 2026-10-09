const { HttpError } = require('./http.cjs');
const { satang } = require('./payment-money.cjs');

function integer(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new HttpError(422, 'invalid_finance_amount', 'จำนวนเงินไม่ถูกต้อง');
  if (!/^(0|[1-9]\d{0,17})$/.test(String(value))) throw new HttpError(422, 'invalid_finance_amount', 'จำนวนเงินไม่ถูกต้อง');
  return BigInt(value);
}
function cents(value) {
  const result = satang(value);
  if (result === null) throw new HttpError(422, 'invalid_finance_amount');
  return BigInt(result);
}
const halfUp = (n, d) => (n * 2n + d) / (d * 2n);
function allocation(order) {
  const food = cents(order.subtotal_amount), delivery = cents(order.delivery_fee), discount = cents(order.discount_amount);
  const offer = order.promotion_snapshot || order.coupon_snapshot;
  if (discount && !['MERCHANT', 'PLATFORM'].includes(offer?.funding_source)) throw new HttpError(422, 'finance_funding_required', 'โปรโมชันยังไม่ได้ระบุผู้รับผิดชอบส่วนลด');
  const deliveryDiscount = offer?.promotion_type === 'FREE_DELIVERY' ? discount : 0n;
  const foodDiscount = discount - deliveryDiscount;
  const mf = offer?.funding_source === 'MERCHANT' ? foodDiscount : 0n;
  const md = offer?.funding_source === 'MERCHANT' ? deliveryDiscount : 0n;
  const pf = foodDiscount - mf, pd = deliveryDiscount - md;
  if (foodDiscount > food || deliveryDiscount > delivery) throw new HttpError(422, 'invalid_finance_discount');
  const base = food - mf, commission = halfUp(base * 500n, 10000n);
  const result = { food_subtotal_satang: food, delivery_fee_satang: delivery,
    merchant_food_discount_satang: mf, merchant_delivery_discount_satang: md,
    platform_food_discount_satang: pf, platform_delivery_discount_satang: pd,
    commission_base_satang: base, commission_satang: commission, platform_subsidy_satang: pf + pd,
    merchant_entitlement_satang: food - mf + delivery - md - commission,
    customer_paid_satang: food + delivery - discount };
  if (result.customer_paid_satang !== cents(order.total_amount)) throw new HttpError(422, 'finance_snapshot_mismatch');
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, String(value)]));
}
function refundAllocation(snapshot, previous, food, delivery) {
  food = integer(food); delivery = integer(delivery);
  const originalFood = BigInt(snapshot.food_subtotal_satang), originalDelivery = BigInt(snapshot.delivery_fee_satang);
  const priorFood = BigInt(previous.food_satang || 0), priorDelivery = BigInt(previous.delivery_satang || 0);
  if (food + delivery === 0n || food + priorFood > originalFood || delivery + priorDelivery > originalDelivery) throw new HttpError(409, 'refund_exceeds_snapshot', 'ยอดคืนเกินยอดคงเหลือของออเดอร์');
  // Cumulative rounding assigns each last satang once, independent of request splitting.
  const share = (component, cumulative, total, old) => total ? halfUp(BigInt(snapshot[component]) * cumulative, total) - BigInt(previous[old] || 0) : 0n;
  const mf = share('merchant_food_discount_satang', food + priorFood, originalFood, 'merchant_food_discount_satang');
  const pf = share('platform_food_discount_satang', food + priorFood, originalFood, 'platform_food_discount_satang');
  const md = share('merchant_delivery_discount_satang', delivery + priorDelivery, originalDelivery, 'merchant_delivery_discount_satang');
  const pd = share('platform_delivery_discount_satang', delivery + priorDelivery, originalDelivery, 'platform_delivery_discount_satang');
  const cumulativeBase = priorFood + food - BigInt(previous.merchant_food_discount_satang || 0) - mf;
  const commission = halfUp(cumulativeBase * 500n, 10000n) - BigInt(previous.commission_satang || 0);
  const values = { food_satang: food, delivery_satang: delivery,
    merchant_food_discount_satang: mf, merchant_delivery_discount_satang: md,
    platform_food_discount_satang: pf, platform_delivery_discount_satang: pd,
    commission_satang: commission, subsidy_satang: pf + pd,
    merchant_recovery_satang: food + delivery - mf - md - commission,
    customer_refund_satang: food + delivery - mf - md - pf - pd };
  if (Object.values(values).some(v => v < 0n)) throw new HttpError(422, 'refund_allocation_invalid');
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
}
function reference(value) {
  if (typeof value !== 'string') throw new HttpError(422, 'transfer_reference_required', 'กรุณาระบุเลขอ้างอิงการโอน');
  const result = value.normalize('NFKC').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_.:/-]{2,159}$/.test(result)) throw new HttpError(422, 'transfer_reference_required', 'กรุณาระบุเลขอ้างอิงการโอนที่ถูกต้อง');
  return result;
}
function served(fee, start, end, at) {
  const elapsed = BigInt(Math.max(0, Math.min(new Date(at) - new Date(start), new Date(end) - new Date(start))));
  const duration = BigInt(new Date(end) - new Date(start));
  if (duration <= 0n) throw new HttpError(422, 'invalid_ad_duration');
  return BigInt(fee) * elapsed / duration;
}
module.exports = { integer, cents, halfUp, allocation, refundAllocation, reference, served };
