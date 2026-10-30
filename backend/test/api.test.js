process.env.BOOKING_LATENCY_MS = '300';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:9'; // unreachable => deterministic-only path
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setRepo, repo } from '../src/repo/index.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { createApp } from '../src/app.js';

let server, base;
before(async () => {
  setRepo(createMemoryRepo());
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
async function chat(id, message, clientMessageId) { return (await post('/api/chat', { conversationId: id, message, clientMessageId })).body; }
const bookingsFor = async (cid) => (await repo.listBookings()).filter((b) => b.conversationId === cid);

test('GET /api/catalog returns the exact contract', async () => {
  const c = await (await fetch(base + '/api/catalog')).json();
  assert.deepEqual(c.SKU_MESH_WIFI6, { name: 'AeroMesh Wi-Fi 6E Home Pack', max_capacity_per_unit: 2, plans: { STD: 399, PRO: 499 } });
});

test('Scenario 1: 5 rooms PRO -> GET then POST with quantity 3, exact payload logged', async () => {
  const a = await chat(undefined, 'I need arrow mesh wifi on the PRO plan for a 5-room house');
  assert.equal(a.apiCalls[0].method, 'GET');
  assert.match(a.reply, /5 rooms ÷ 2 per unit = 3 units/);
  assert.equal(a.stage, 'AWAITING_CONFIRMATION');
  assert.equal((await bookingsFor(a.conversationId)).length, 0);
  const b = await chat(a.conversationId, 'yes please book it');
  const post = b.apiCalls.find((c) => c.method === 'POST');
  assert.equal(post.request.sku_id, 'SKU_MESH_WIFI6');
  assert.equal(post.request.quantity, 3);
  assert.equal(post.request.promo_code, null);
  assert.equal(post.request.final_price, 1497);
  assert.equal(b.intent, 'BOOKED');
});

test('Scenario 1: unknown product -> no GET-matched booking', async () => {
  const a = await chat(undefined, 'Do you have the Netgear Orbi router?');
  assert.equal(a.intent, 'NOT_IN_CATALOG');
  const b = await chat(a.conversationId, 'yes book it');
  assert.equal(b.apiCalls.filter((c) => c.method === 'POST').length, 0);
});

test('Scenario 4: two concurrent "Yes, book it!" -> exactly one booking', async () => {
  const a = await chat(undefined, 'SyncHub PRO for 7 people');
  const [r1, r2, r3] = await Promise.all([chat(a.conversationId, 'Yes, book it!'), chat(a.conversationId, 'Yes, book it!'), chat(a.conversationId, 'yes book it')]);
  assert.equal((await bookingsFor(a.conversationId)).length, 1);
  const intents = [r1, r2, r3].map((r) => r.intent).sort();
  assert.deepEqual(intents, ['ALREADY_BOOKED', 'ALREADY_BOOKED', 'BOOKED']);
  const posts = [r1, r2, r3].flatMap((r) => r.apiCalls).filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1);
});

test('Scenario 4: same clientMessageId replays, no second booking; aborted client does not corrupt state', async () => {
  const a = await chat(undefined, 'AirPods STD for 2 people');
  const ctrl = new AbortController();
  const p = fetch(base + '/api/chat', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: a.conversationId, message: 'yes', clientMessageId: 'm-1' }) }).catch(() => 'aborted');
  setTimeout(() => ctrl.abort(), 50); // user interrupts mid-booking
  assert.equal(await p, 'aborted');
  const again = await chat(a.conversationId, 'yes', 'm-1'); // client retries same message id
  assert.equal(again.replayed || again.intent === 'ALREADY_BOOKED', true);
  assert.equal((await bookingsFor(a.conversationId)).length, 1);
  const conv = await (await fetch(`${base}/api/chat/${a.conversationId}`)).json();
  assert.equal(conv.state.stage, 'BOOKED');
  assert.ok(conv.messages.length % 2 === 0);
});

test('Scenario 3 via HTTP: changed requirement is never booked with stale numbers', async () => {
  const a = await chat(undefined, 'AeroMesh STD for 4 rooms');
  const b = await chat(a.conversationId, 'change it to 7 rooms and PRO. ok book it');
  assert.equal(b.apiCalls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(b.quote.quantity, 4);
  assert.equal(b.quote.total, 1996);
  const c = await chat(a.conversationId, 'yes');
  const p = c.apiCalls.find((x) => x.method === 'POST');
  assert.deepEqual([p.request.plan_code, p.request.quantity, p.request.final_price], ['PRO', 4, 1996]);
});

test('Direct POST /api/bookings rejects wrong price/discount/sku and is idempotent', async () => {
  const ok = { sku_id: 'SKU_MESH_WIFI6', plan_code: 'STD', quantity: 2, promo_code: 'SAVE10', final_price: 718.2 };
  assert.equal((await post('/api/bookings', { ...ok, promo_code: 'SAVE50', final_price: 399 })).status, 422);
  assert.equal((await post('/api/bookings', { ...ok, final_price: 700 })).status, 422);
  assert.equal((await post('/api/bookings', { ...ok, sku_id: 'SKU_NOPE' })).status, 422);
  assert.equal((await post('/api/bookings', { ...ok, quantity: 0 })).status, 422);
  const h = { 'Idempotency-Key': 'k-1' };
  const [x, y] = await Promise.all([post('/api/bookings', ok, h), post('/api/bookings', ok, h)]);
  assert.equal(x.body.bookingRef, y.body.bookingRef);
  assert.equal((await repo.listBookings()).filter((b) => b.idempotencyKey === 'k-1').length, 1);
});

test('price change between quote and confirm => no booking, re-quote', async () => {
  const a = await chat(undefined, 'AeroMesh STD for 2 rooms');
  await repo.updateProductPrice('SKU_MESH_WIFI6', 'STD', 429);
  const b = await chat(a.conversationId, 'yes');
  assert.equal(b.intent, 'QUOTE'); // fresh GET at turn start sees new price -> re-quote, never books the stale total
  assert.match(b.reply, /updated details/i);
  assert.equal(b.apiCalls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(b.quote.total, 429);
  await repo.updateProductPrice('SKU_MESH_WIFI6', 'STD', 399);
});
