import { SKU_META } from '../data/catalog.js';
import { computeQuote, quoteKey, quantityFor, fmt, DISCOUNT_TIERS, MAX_TIER } from './pricing.js';

export const freshState = () => ({
  stage: 'DISCOVERY', // DISCOVERY | AWAITING_CONFIRMATION | BOOKING | BOOKED
  sku: null,
  plan: null,
  count: null, // { value, kind: 'capacity' | 'units' }
  quantity: null,
  tier: 0,
  priceQuoted: false,
  quote: null,
  bookingRef: null,
  bookingStartedAt: null,
});

const MAX_COUNT = 1000;

/**
 * Pure, deterministic state transition. The LLM never reaches this function's decisions:
 * it only contributes (validated) extraction hints inside `sig`.
 * Returns { state, intent, ctx, action } where action === 'BOOK' is the ONLY way a booking can be requested.
 */
export function step(prev, sig, catalog) {
  let s = structuredClone(prev);
  const ctx = {};

  if (s.stage === 'BOOKING') return { state: s, intent: 'BOOKING_IN_PROGRESS', ctx, action: null };

  if (s.stage === 'BOOKED') {
    const startsNewOrder = sig.product.status !== 'ABSENT' || (sig.count && !sig.count.bare) || sig.plan;
    if (!startsNewOrder) {
      ctx.bookingRef = s.bookingRef;
      return { state: s, intent: sig.confirm ? 'ALREADY_BOOKED' : 'BOOKED_FOLLOWUP', ctx, action: null };
    }
    s = freshState();
  }

  if (sig.cancel) return { state: freshState(), intent: 'CANCELLED', ctx, action: null };

  // ---------- product ----------
  const p = sig.product;
  if (p.status === 'NONE') {
    ctx.mention = p.mention;
    s.quote = null; // nothing previously quoted may be booked with a bare "yes" afterwards
    s.stage = 'DISCOVERY';
    return { state: s, intent: 'NOT_IN_CATALOG', ctx, action: null };
  }
  if (p.status === 'AMBIGUOUS') {
    ctx.skus = p.skus;
    s.quote = null;
    s.stage = 'DISCOVERY';
    return { state: s, intent: 'AMBIGUOUS_PRODUCT', ctx, action: null };
  }

  let changed = false;
  if (p.status === 'MATCH' && p.sku !== s.sku) {
    s.sku = p.sku;
    changed = true;
    if (s.plan && !catalog[s.sku].plans[s.plan]) {
      ctx.droppedPlan = s.plan;
      s.plan = null;
    }
  }

  // ---------- plan ----------
  if (sig.plan) {
    if (s.sku && !catalog[s.sku].plans[sig.plan]) ctx.invalidPlan = sig.plan;
    else if (sig.plan !== s.plan) {
      s.plan = sig.plan;
      if (s.sku) changed = true;
    }
  }

  // ---------- requirement / quantity ----------
  if (sig.count?.invalid || (sig.count && sig.count.value > MAX_COUNT)) {
    ctx.invalidCount = true;
  } else if (sig.count && !(sig.count.bare && !s.sku)) {
    if (!s.count || s.count.value !== sig.count.value || s.count.kind !== sig.count.kind) {
      s.count = { value: sig.count.value, kind: sig.count.kind };
      if (s.sku) changed = true;
    }
  }
  if (s.sku && s.count) {
    const cap = catalog[s.sku].max_capacity_per_unit;
    s.quantity = s.count.kind === 'units' ? s.count.value : quantityFor(s.count.value, cap);
  } else s.quantity = null;

  // ---------- discount rules ----------
  if (sig.objection) {
    if (!s.priceQuoted) ctx.discountBeforeQuote = true; // always quote standard price first
    else if (s.tier < MAX_TIER) {
      s.tier += 1;
      ctx.discountGranted = DISCOUNT_TIERS[s.tier];
    } else ctx.discountMaxed = true;
    const granted = DISCOUNT_TIERS[s.tier];
    const asked = sig.discountRequest;
    if (asked) {
      const rejected = asked.codes.filter((c) => c !== granted.code || ctx.discountBeforeQuote);
      if (rejected.length) ctx.rejectedCodes = rejected;
      if (asked.percent != null && (asked.percent !== granted.percent || ctx.discountBeforeQuote)) ctx.rejectedPercent = asked.percent;
    }
  }

  // ---------- generic questions ----------
  const nothingNew = p.status === 'ABSENT' && !sig.plan && !sig.count && !sig.objection;
  if (nothingNew && !sig.confirm && (sig.asksCatalog || (!s.sku && !s.quote))) {
    ctx.greeting = sig.asksHelp && !sig.asksCatalog;
    return { state: s, intent: s.sku ? 'CATALOG' : 'GREETING', ctx, action: null };
  }

  // ---------- missing details ----------
  if (!s.sku) return { state: s, intent: 'ASK_PRODUCT', ctx, action: null };
  if (!s.plan) return { state: { ...s, quote: null, stage: 'DISCOVERY' }, intent: 'ASK_PLAN', ctx, action: null };
  if (!s.quantity) return { state: { ...s, quote: null, stage: 'DISCOVERY' }, intent: 'ASK_COUNT', ctx, action: null };

  // ---------- quote / confirmation gate ----------
  const q = computeQuote({ catalog, sku: s.sku, plan: s.plan, quantity: s.quantity, tier: s.tier });
  q.key = quoteKey(q);
  q.requirement = s.count.kind === 'capacity' ? s.count.value : null;
  q.coverage = q.quantity * catalog[s.sku].max_capacity_per_unit;
  q.name = catalog[s.sku].name;

  const sameQuote = !!s.quote && s.quote.key === q.key;
  const canBook = sig.confirm && s.stage === 'AWAITING_CONFIRMATION' && sameQuote && !changed && !sig.objection;
  if (canBook) return { state: s, intent: 'BOOKING', ctx: { quote: s.quote }, action: 'BOOK' };

  ctx.quoteReason = !s.quote ? 'initial' : sameQuote && !changed ? 'repeat' : 'updated';
  ctx.confirmBlocked = sig.confirm && ctx.quoteReason !== 'repeat';
  ctx.confirmVetoed = sig.confirmVetoed;
  s.quote = q;
  s.priceQuoted = true;
  s.stage = 'AWAITING_CONFIRMATION';
  return { state: s, intent: 'QUOTE', ctx, action: null };
}

// ------------------------------------------------------------------ wording (deterministic, authoritative)
const catalogLines = (catalog) =>
  Object.values(catalog)
    .map((i) => `• ${i.name} — covers up to ${i.max_capacity_per_unit} per unit; ${Object.entries(i.plans).map(([k, v]) => `${k} $${fmt(v)}`).join(', ')}`)
    .join('\n');

function quoteBlock(q, catalog, state) {
  const meta = SKU_META[q.sku];
  const cap = catalog[q.sku].max_capacity_per_unit;
  const lines = [`• Package: ${q.name} (${q.sku})`, `• Plan: ${q.plan} — $${fmt(q.unitPrice)} per unit`];
  if (state.count.kind === 'capacity')
    lines.push(`• Quantity: ${state.count.value} ${state.count.value === 1 ? meta.coverageUnit : meta.coverageUnitPlural} ÷ ${cap} per unit = ${q.quantity} unit${q.quantity > 1 ? 's' : ''} (covers up to ${q.coverage})`);
  else lines.push(`• Quantity: ${q.quantity} unit${q.quantity > 1 ? 's' : ''} (covers up to ${q.coverage})`);
  lines.push(`• Subtotal: $${fmt(q.subtotal)}`);
  if (q.discountPercent) lines.push(`• Discount: ${q.discountPercent}% with code ${q.promoCode} (−$${fmt(q.discountAmount)})`);
  lines.push(`• Total: $${fmt(q.total)}`);
  return lines.join('\n');
}

export function compose({ intent, ctx, state }, catalog) {
  const parts = [];
  const planList = (sku) => Object.entries(catalog[sku].plans).map(([k, v]) => `${k} ($${fmt(v)})`).join(' or ');

  if (ctx.invalidPlan && state.sku) parts.push(`${catalog[state.sku].name} isn't available on the ${ctx.invalidPlan} plan. Its plans are ${planList(state.sku)}.`);
  if (ctx.droppedPlan && state.sku) parts.push(`${catalog[state.sku].name} doesn't have a ${ctx.droppedPlan} plan, so please choose ${planList(state.sku)}.`);
  if (ctx.invalidCount) parts.push(`I couldn't use that number — please give me a whole number of rooms/people (or units) between 1 and 1000.`);

  switch (intent) {
    case 'GREETING':
      parts.push(`Hi! I'm your sales assistant. Here's what we offer:\n${catalogLines(catalog)}\n\nTell me what you need and how many rooms or people you need to cover.`);
      break;
    case 'CATALOG':
      parts.push(`Here's our catalog:\n${catalogLines(catalog)}`);
      if (state.quote) parts.push(`Your current quote is still:\n${quoteBlock(state.quote, catalog, state)}\n\nReply "yes" to confirm it.`);
      break;
    case 'NOT_IN_CATALOG':
      parts.push(`Sorry, we don't carry "${ctx.mention}" — I can only book items from our catalog:\n${catalogLines(catalog)}\n\nWould you like one of these instead?`);
      break;
    case 'AMBIGUOUS_PRODUCT':
      parts.push(`That could match more than one product (${ctx.skus.map((k) => catalog[k].name).join(' / ')}). Which one do you mean?`);
      break;
    case 'ASK_PRODUCT':
      if (ctx.discountBeforeQuote) parts.push(`I'll share our standard price first — then we can talk about it.`);
      parts.push(`Which product are you interested in?\n${catalogLines(catalog)}`);
      break;
    case 'ASK_PLAN':
      if (ctx.discountBeforeQuote) parts.push(`I'll share our standard price first — then we can talk about it.`);
      parts.push(`Great choice: ${catalog[state.sku].name} (each unit covers up to ${catalog[state.sku].max_capacity_per_unit}). Which plan would you like — ${planList(state.sku)}?`);
      break;
    case 'ASK_COUNT': {
      const m = SKU_META[state.sku];
      if (ctx.discountBeforeQuote) parts.push(`I'll share our standard price first — then we can talk about it.`);
      parts.push(`${catalog[state.sku].name} on ${state.plan} is $${fmt(catalog[state.sku].plans[state.plan])} per unit, and each unit covers up to ${catalog[state.sku].max_capacity_per_unit} ${m.coverageUnitPlural}. How many ${m.coverageUnitPlural} do you need to cover?`);
      break;
    }
    case 'QUOTE': {
      const q = state.quote;
      if (ctx.discountBeforeQuote) parts.push(`I can only discuss discounts once you've seen the standard price, so here it is first.`);
      if (ctx.discountGranted) {
        const g = ctx.discountGranted;
        parts.push(g.tier === MAX_TIER
          ? `I understand. The best I can do is code ${g.code} for ${g.percent}% off — that's the maximum discount I'm authorised to give.`
          : `Since price is a concern, I can offer code ${g.code} for ${g.percent}% off.`);
      }
      if (ctx.discountMaxed) parts.push(`I've already applied the maximum discount I'm allowed to give (${q.discountPercent}% with ${q.promoCode}), so I can't go lower.`);
      if (ctx.rejectedCodes?.length) parts.push(`I can't apply ${ctx.rejectedCodes.join(', ')} — it isn't a code I can honour.`);
      else if (ctx.rejectedPercent != null) parts.push(`I'm not able to give ${ctx.rejectedPercent}% off.`);
      if (ctx.confirmBlocked && !ctx.discountGranted) parts.push(`Before I book anything, please review the ${ctx.quoteReason === 'initial' ? '' : 'updated '}details:`);
      else if (ctx.quoteReason === 'updated' && !ctx.discountGranted) parts.push(`Here are your updated details:`);
      else if (ctx.quoteReason === 'initial' && !ctx.discountBeforeQuote) parts.push(`Here's your quote at our standard price:`);
      else if (ctx.quoteReason === 'repeat') parts.push(`Here's where we stand:`);
      parts.push(quoteBlock(q, catalog, state));
      if (ctx.confirmVetoed) parts.push(`Just to be sure — please reply "confirm" to book exactly this order.`);
      else parts.push(`Would you like me to book this? Reply "yes" to confirm.`);
      break;
    }
    case 'BOOKING_IN_PROGRESS':
      parts.push(`Your booking is being processed right now — I won't submit it twice. One moment.`);
      break;
    case 'BOOKED': {
      const b = ctx.booking;
      parts.push(`✅ Booked! Reference ${b.bookingRef}.\n• ${b.productName} (${b.skuId}), plan ${b.planCode}\n• Quantity: ${b.quantity}\n• Discount: ${b.promoCode ? `${b.discountPercent}% (${b.promoCode})` : 'none'}\n• Total charged: $${fmt(b.finalPrice)}`);
      break;
    }
    case 'ALREADY_BOOKED':
      parts.push(`This order is already booked (reference ${ctx.bookingRef}). I haven't created a second booking, so you won't be charged twice.`);
      break;
    case 'BOOKED_FOLLOWUP':
      parts.push(`Your order ${ctx.bookingRef} is confirmed. If you'd like to place another order, just tell me what you need.`);
      break;
    case 'CANCELLED':
      parts.push(`No problem — I've cleared the current order. Nothing was booked. Tell me whenever you'd like to start again.`);
      break;
    case 'PRICE_CHANGED':
      parts.push(`Catalog pricing changed since your quote, so I haven't booked anything. Here's the updated quote:\n${quoteBlock(state.quote, catalog, state)}\n\nReply "yes" to confirm the new total.`);
      break;
    case 'BOOKING_FAILED':
      parts.push(`I couldn't complete the booking (${ctx.error}). Nothing was charged — reply "yes" to try again.`);
      break;
    default:
      parts.push(`Could you tell me a bit more about what you need?`);
  }
  return parts.join('\n\n');
}
