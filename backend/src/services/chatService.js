import { repo } from '../repo/index.js';
import { withLock } from './mutex.js';
import { HttpError } from './errors.js';
import { getCatalogInfo } from './catalogService.js';
import { createBooking } from './bookingService.js';
import * as ai from './aiClient.js';
import { buildSignals } from '../engine/signals.js';
import { step, compose, freshState } from '../engine/salesEngine.js';
import { computeQuote, quoteKey } from '../engine/pricing.js';

const STALE_BOOKING_MS = 30_000;

const view = (conv, { reply, intent, calls = [], booking = null, replayed = false, polished = false }) => ({
  conversationId: conv.id,
  reply,
  intent,
  stage: conv.state?.stage ?? 'DISCOVERY',
  quote: conv.state?.quote ?? null,
  booking,
  apiCalls: calls,
  replayed,
  polished,
});

export async function processTurn({ conversationId, message, clientMessageId }) {
  if (typeof message !== 'string' || !message.trim()) throw new HttpError(400, 'message is required');
  if (message.length > 1000) throw new HttpError(400, 'message is too long (max 1000 characters)');
  let id = conversationId;
  if (!id) id = (await repo.createConversation()).id;
  else if (!(await repo.getConversation(id))) throw new HttpError(404, 'Conversation not found');
  // All turns of one conversation are serialized => no interleaved state corruption, no double booking.
  return withLock(id, () => runTurn(id, message.trim(), clientMessageId));
}

async function runTurn(id, message, clientMessageId) {
  const conv = await repo.getConversation(id);
  if (!conv.state || !conv.state.stage) conv.state = freshState();
  const calls = [];

  // Idempotent replay: the same client message id (retry / double-click) returns the stored answer.
  if (clientMessageId) {
    const i = conv.messages.findIndex((m) => m.role === 'user' && m.clientMessageId === clientMessageId);
    if (i >= 0 && conv.messages[i + 1]?.role === 'assistant') {
      return view(conv, { reply: conv.messages[i + 1].content, intent: conv.messages[i + 1].intent, replayed: true });
    }
  }

  await recoverStuckBooking(conv);

  // GET API: fetch catalog/packages/capacity/prices for this turn.
  const catalog = await getCatalogInfo(message, { conversationId: id, calls });

  const history = conv.messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
  const nlu = await ai.analyze({ message, state: summarize(conv.state), history, catalog });
  const sig = buildSignals(message, nlu, catalog);

  let result = step(conv.state, sig, catalog);
  let booking = null;

  if (result.action === 'BOOK') {
    const out = await executeBooking(conv, result, catalog, calls);
    result = out.result;
    booking = out.booking;
  }

  let reply = compose({ ...result, state: result.state }, catalog);
  let polished = false;
  if (!['BOOKED', 'BOOKING_FAILED'].includes(result.intent)) {
    const p = await ai.polish({ text: reply, userMessage: message, history });
    reply = p.text;
    polished = p.polished;
  }

  conv.state = result.state;
  if (booking) conv.bookingId = booking.id;
  if (conv.messages.length === 0) conv.title = message.slice(0, 60);
  const now = new Date().toISOString();
  conv.messages.push({ role: 'user', content: message, clientMessageId: clientMessageId || undefined, ts: now });
  conv.messages.push({ role: 'assistant', content: reply, intent: result.intent, ts: now });
  await repo.saveConversation(conv); // single write per turn: a dropped/aborted client can't leave half a turn

  return view(conv, { reply, intent: result.intent, calls, booking, polished });
}

const summarize = (s) => ({ stage: s.stage, sku: s.sku, plan: s.plan, count: s.count, quantity: s.quantity, tier: s.tier, quote: s.quote && { total: s.quote.total, promoCode: s.quote.promoCode } });

async function executeBooking(conv, result, catalog, calls) {
  const quote = result.ctx.quote;

  // 1) Re-fetch the catalog and make sure the price the user confirmed is still the real price.
  const fresh = await getCatalogInfo('verify-before-booking', { conversationId: conv.id, calls, note: 'pre-booking price verification' });
  const item = fresh[quote.sku];
  const stillValid = item && item.plans[quote.plan] != null;
  const recomputed = stillValid && computeQuote({ catalog: fresh, sku: quote.sku, plan: quote.plan, quantity: quote.quantity, tier: quote.tier });
  if (!stillValid || recomputed.total !== quote.total) {
    const state = structuredClone(result.state);
    if (!stillValid) {
      state.quote = null; state.sku = null; state.plan = null; state.stage = 'DISCOVERY';
      return { result: { state, intent: 'NOT_IN_CATALOG', ctx: { mention: quote.name }, action: null }, booking: null };
    }
    const nq = { ...state.quote, ...recomputed, name: item.name };
    nq.key = quoteKey(nq);
    state.quote = nq; state.stage = 'AWAITING_CONFIRMATION';
    return { result: { state, intent: 'PRICE_CHANGED', ctx: {}, action: null }, booking: null };
  }

  // 2) Atomic claim: AWAITING_CONFIRMATION -> BOOKING for exactly this quote (compare-and-set).
  const claimed = await repo.claimBooking(conv.id, quote.key);
  if (!claimed) return { result: { state: { ...result.state, stage: 'BOOKING' }, intent: 'BOOKING_IN_PROGRESS', ctx: {}, action: null }, booking: null };

  // 3) POST API with exactly the confirmed values + idempotency key (DB-level unique).
  const payload = { sku_id: quote.sku, plan_code: quote.plan, quantity: quote.quantity, promo_code: quote.promoCode, final_price: quote.total };
  try {
    const b = await createBooking(payload, { idempotencyKey: `${conv.id}:${quote.key}`, conversationId: conv.id, calls });
    const state = { ...result.state, stage: 'BOOKED', bookingRef: b.bookingRef, bookingStartedAt: null };
    return { result: { state, intent: 'BOOKED', ctx: { booking: b }, action: null }, booking: b };
  } catch (e) {
    const state = { ...result.state, stage: 'AWAITING_CONFIRMATION', bookingStartedAt: null };
    return { result: { state, intent: 'BOOKING_FAILED', ctx: { error: e.message }, action: null }, booking: null };
  }
}

// If a process died mid-booking, resolve the stuck BOOKING stage without ever double-booking.
async function recoverStuckBooking(conv) {
  const s = conv.state;
  if (s.stage !== 'BOOKING' || !s.quote) return;
  const existing = await repo.findBookingByKey(`${conv.id}:${s.quote.key}`);
  if (existing) { s.stage = 'BOOKED'; s.bookingRef = existing.bookingRef; conv.bookingId = existing.id; return; }
  if (Date.now() - new Date(s.bookingStartedAt || 0).getTime() > STALE_BOOKING_MS) s.stage = 'AWAITING_CONFIRMATION';
}
