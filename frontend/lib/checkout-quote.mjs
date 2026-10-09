// Checkout-only transport lifecycle. No pricing, eligibility or redemption rules.
import { api } from './api';

export async function requestCheckoutQuote(payload, controller, timeoutMs = 15000) {
  let timer;
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(new Error('quote_cancelled'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
    timer = setTimeout(() => { reject(new Error('quote_timeout')); controller.abort(); }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      api('/api/orders/quote', { method: 'POST', body: payload, signal: controller.signal }), cancelled,
    ]);
    const quote = result?.quote;
    if (!quote || !['subtotal_amount', 'delivery_fee', 'discount_amount', 'total_amount'].every((key) =>
      /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(quote[key])) && Number.isFinite(Number(quote[key])))) {
      throw new Error('invalid_quote_response');
    }
    const intent = JSON.parse(payload);
    // Accept only a quote for the requested discount; never infer a successful application.
    if (intent.couponCode
      ? quote.coupon_snapshot?.code !== intent.couponCode || !!quote.promotion_snapshot
      : intent.promotionId
        ? String(quote.promotion_snapshot?.id) !== String(intent.promotionId) || !!quote.coupon_snapshot
        : !!quote.coupon_snapshot || !!quote.promotion_snapshot) throw new Error('invalid_quote_response');
    return quote;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
