import { randomBytes } from 'node:crypto';
import { repo } from '../repo/index.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import { logged } from './apiLogger.js';
import { readCatalog } from './catalogService.js';
import { ALLOWED_CODES, DISCOUNT_TIERS, computeQuote } from '../engine/pricing.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Independent server-side validation: even a buggy caller (or LLM) cannot book a wrong sku/plan/qty/discount/price.
 */
export async function validateBookingPayload(p, catalog) {
  const { sku_id, plan_code, quantity, promo_code, final_price } = p || {};
  const item = catalog[sku_id];
  if (!item) throw new HttpError(422, `Unknown sku_id "${sku_id}"`);
  if (!item.plans[plan_code]) throw new HttpError(422, `Plan "${plan_code}" is not available for ${sku_id}`);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new HttpError(422, 'quantity must be an integer between 1 and 1000');
  if (promo_code != null && !ALLOWED_CODES.has(promo_code)) throw new HttpError(422, `Promo code "${promo_code}" is not valid (allowed: ${[...ALLOWED_CODES.keys()].join(', ')})`);
  const tier = promo_code == null ? 0 : DISCOUNT_TIERS.find((t) => t.code === promo_code).tier;
  const q = computeQuote({ catalog, sku: sku_id, plan: plan_code, quantity, tier });
  if (typeof final_price !== 'number' || Math.abs(final_price - q.total) > 0.005)
    throw new HttpError(422, `final_price ${final_price} does not match computed total ${q.total}`);
  return { item, quote: q };
}

// create_booking(sku_id, plan_code, quantity, promo_code, final_price)
export async function createBooking(payload, { idempotencyKey, conversationId, calls } = {}) {
  const key = idempotencyKey || `manual:${randomBytes(8).toString('hex')}`;
  return logged({ method: 'POST', path: '/api/bookings', request: { ...payload, idempotency_key: key }, conversationId, calls }, async () => {
    const catalog = await readCatalog();
    const { item, quote } = await validateBookingPayload(payload, catalog);

    const existing = await repo.findBookingByKey(key);
    if (existing) return { ...existing, duplicate: true };

    await sleep(config.bookingLatencyMs); // simulate the ~1–2s downstream booking call

    try {
      const doc = await repo.insertBooking({
        bookingRef: `BK-${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString('hex').toUpperCase()}`,
        idempotencyKey: key,
        conversationId: conversationId || null,
        skuId: payload.sku_id,
        productName: item.name,
        planCode: payload.plan_code,
        quantity: payload.quantity,
        unitPrice: quote.unitPrice,
        promoCode: payload.promo_code ?? null,
        discountPercent: quote.discountPercent,
        finalPrice: payload.final_price,
        status: 'CONFIRMED',
      });
      return { ...doc, duplicate: false };
    } catch (e) {
      if (e.code === 'DUPLICATE') return { ...(await repo.findBookingByKey(key)), duplicate: true }; // lost a race: return the winner
      throw e;
    }
  });
}
