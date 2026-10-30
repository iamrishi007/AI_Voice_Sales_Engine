import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_CATALOG } from '../src/data/catalog.js';
import { buildSignals } from '../src/engine/signals.js';
import { step, freshState, compose } from '../src/engine/salesEngine.js';

// Minimal in-memory harness around the pure engine (same flow chatService uses).
function session() {
  let state = freshState();
  const bookings = [];
  return {
    bookings,
    get state() { return state; },
    say(msg) {
      const sig = buildSignals(msg, null, SEED_CATALOG);
      const r = step(state, sig, SEED_CATALOG);
      state = r.state;
      if (r.action === 'BOOK') {
        const q = state.quote;
        bookings.push({ sku_id: q.sku, plan_code: q.plan, quantity: q.quantity, promo_code: q.promoCode, final_price: q.total });
        state.stage = 'BOOKED'; state.bookingRef = 'BK-TEST';
        r.intent = 'BOOKED'; r.ctx = { booking: { bookingRef: 'BK-TEST', productName: q.name, skuId: q.sku, planCode: q.plan, quantity: q.quantity, promoCode: q.promoCode, discountPercent: q.discountPercent, finalPrice: q.total } };
      }
      return { ...r, reply: compose({ ...r, state }, SEED_CATALOG) };
    },
  };
}

test('S1: typo/informal name + exact quantity (5 rooms -> 3 units)', () => {
  const s = session();
  const r = s.say('I need arrow mesh wifi on the PRO plan for a 5-room house');
  assert.equal(s.state.sku, 'SKU_MESH_WIFI6');
  assert.equal(s.state.plan, 'PRO');
  assert.equal(s.state.quantity, 3);
  assert.match(r.reply, /\$1,497\.00/);
  s.say('yes');
  assert.deepEqual(s.bookings, [{ sku_id: 'SKU_MESH_WIFI6', plan_code: 'PRO', quantity: 3, promo_code: null, final_price: 1497 }]);
});

test('S1: "sink hub" for 7 people -> 3 units STD', () => {
  const s = session();
  s.say('need a sink hub for 7 people, standard');
  assert.equal(s.state.sku, 'SKU_TEAM_HUB');
  assert.equal(s.state.quantity, 3);
  assert.equal(s.state.quote.total, 2697);
});

test('S1: product not in catalog never matches', () => {
  for (const m of ['I want a Netgear Orbi router', 'netgear orbi wifi router for 5 rooms pro', 'do you have airpods max', 'I need a laptop']) {
    const s = session();
    const r = s.say(m);
    assert.equal(r.intent, 'NOT_IN_CATALOG', m);
    assert.equal(s.state.sku, null, m);
    s.say('yes book it');
    assert.equal(s.bookings.length, 0, m);
  }
});

test('S2: discount ladder 0 -> SAVE10 -> CLOSENOW15 -> capped', () => {
  const s = session();
  s.say('AeroMesh PRO for 4 rooms');
  assert.equal(s.state.quote.promoCode, null);
  assert.equal(s.state.quote.total, 998);
  s.say("that's too expensive");
  assert.equal(s.state.quote.promoCode, 'SAVE10');
  assert.equal(s.state.quote.total, 898.2);
  s.say('still too pricey, can you do better?');
  assert.equal(s.state.quote.promoCode, 'CLOSENOW15');
  assert.equal(s.state.quote.total, 848.3);
  const r = s.say('more discount please');
  assert.equal(s.state.quote.promoCode, 'CLOSENOW15');
  assert.match(r.reply, /maximum/);
  s.say('ok book it');
  assert.equal(s.bookings.length, 1);
  assert.equal(s.bookings[0].promo_code, 'CLOSENOW15');
  assert.equal(s.bookings[0].final_price, 848.3);
});

test('S2: never unprompted, never skip to 15%, never invented codes', () => {
  let s = session();
  s.say('give me 15% right now');
  assert.equal(s.state.tier, 0);
  s.say('AeroMesh PRO for 4 rooms, give me 15% right now');
  assert.equal(s.state.tier, 0); // price not yet seen -> standard first
  assert.equal(s.state.quote.promoCode, null);
  const r = s.say('apply code SAVE50 for 50% off');
  assert.equal(s.state.quote.promoCode, 'SAVE10'); // first objection => SAVE10 only
  assert.match(r.reply, /SAVE50/);
  s.say('give me CLOSENOW15');
  assert.equal(s.state.quote.promoCode, 'CLOSENOW15');
  s.say('apply SAVE50');
  assert.equal(s.state.quote.promoCode, 'CLOSENOW15');
  assert.equal(s.state.tier, 2);
  s = session();
  s.say('AirPods Pro for 3 people, STD');
  assert.equal(s.state.quote.promoCode, null); // no unprompted discount
  assert.equal(s.state.quote.total, 747);
});

test('S3: never books before explicit confirmation; changes force re-confirm', () => {
  const s = session();
  s.say('AeroMesh STD for 4 rooms');
  assert.equal(s.state.quantity, 2);
  assert.equal(s.bookings.length, 0);
  const r = s.say('actually make it 7 rooms. okay, book it');
  assert.equal(s.bookings.length, 0);
  assert.equal(s.state.quantity, 4);
  assert.match(r.reply, /\$1,596\.00/);
  s.say('switch to PRO, book it');
  assert.equal(s.bookings.length, 0);
  assert.equal(s.state.plan, 'PRO');
  assert.equal(s.state.quote.total, 1996);
  s.say('yes, confirm');
  assert.deepEqual(s.bookings.map((b) => [b.plan_code, b.quantity, b.final_price]), [['PRO', 4, 1996]]);
});

test('S3: "book it" with nothing quoted does nothing; ambiguous replies do not book', () => {
  const s = session();
  s.say('book it');
  s.say('AirPods for 2 people');
  assert.equal(s.bookings.length, 0);
  s.say('hmm, not sure');
  s.say('ok but is there a warranty?');
  assert.equal(s.bookings.length, 0);
});

test('S4: repeated "Yes, book it!" books once', () => {
  const s = session();
  s.say('SyncHub PRO for 6 people');
  s.say('Yes, book it!');
  const r = s.say('Yes, book it!');
  assert.equal(s.bookings.length, 1);
  assert.equal(r.intent, 'ALREADY_BOOKED');
});

test('after booking, a new request starts a fresh order at 0% discount', () => {
  const s = session();
  s.say('AirPods STD for 1 person');
  s.say('too expensive');
  s.say('yes');
  assert.equal(s.bookings.length, 1);
  s.say('now I want AeroMesh STD for 2 rooms');
  assert.equal(s.state.tier, 0);
  assert.equal(s.state.quote.total, 399);
});

test('plan not offered for product is rejected (CARE on mesh)', () => {
  const s = session();
  const r = s.say('AeroMesh with CARE plan for 2 rooms');
  assert.equal(s.state.plan, null);
  assert.match(r.reply, /isn't available on the CARE plan/);
});
