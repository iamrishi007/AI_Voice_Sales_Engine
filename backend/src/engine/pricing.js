// Single source of truth for discounts. The LLM can never influence these values.
export const DISCOUNT_TIERS = [
  { tier: 0, code: null, percent: 0 },
  { tier: 1, code: 'SAVE10', percent: 10 },
  { tier: 2, code: 'CLOSENOW15', percent: 15 }, // absolute maximum
];
export const MAX_TIER = DISCOUNT_TIERS.length - 1;
export const ALLOWED_CODES = new Map(DISCOUNT_TIERS.filter((t) => t.code).map((t) => [t.code, t.percent]));

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function quantityFor(requirement, maxCapacityPerUnit) {
  return Math.ceil(requirement / maxCapacityPerUnit);
}

export function computeQuote({ catalog, sku, plan, quantity, tier }) {
  const item = catalog[sku];
  const unitPrice = item.plans[plan];
  const { code, percent } = DISCOUNT_TIERS[tier];
  const subtotal = round2(unitPrice * quantity);
  const discountAmount = round2((subtotal * percent) / 100);
  const total = round2(subtotal - discountAmount);
  return { sku, plan, quantity, tier, promoCode: code, discountPercent: percent, unitPrice, subtotal, discountAmount, total };
}

export const quoteKey = (q) => `${q.sku}|${q.plan}|${q.quantity}|${q.promoCode ?? 'none'}|${q.total.toFixed(2)}`;
