// In-memory repository. Used for tests and as a dev fallback when PostgreSQL is unreachable.
import { randomUUID } from 'node:crypto';
import { SEED_CATALOG } from '../data/catalog.js';

export function createMemoryRepo() {
  const products = Object.entries(SEED_CATALOG).map(([sku, p]) => ({ sku, name: p.name, maxCapacityPerUnit: p.max_capacity_per_unit, plans: { ...p.plans } }));
  const convs = new Map();
  const bookings = [];
  const logs = [];
  const clone = (x) => structuredClone(x);

  return {
    kind: 'memory',
    async listProducts() { return clone(products); },
    async updateProductPrice(sku, plan, price) { products.find((p) => p.sku === sku).plans[plan] = price; },
    async createConversation() {
      const now = new Date().toISOString();
      const c = { id: randomUUID(), title: 'New conversation', messages: [], state: {}, bookingId: null, createdAt: now, updatedAt: now };
      convs.set(c.id, c);
      return clone(c);
    },
    async getConversation(id) { return convs.has(id) ? clone(convs.get(id)) : null; },
    async listConversations() { return [...convs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone); },
    async saveConversation(c) { convs.set(c.id, { ...clone(c), updatedAt: new Date().toISOString() }); },
    async claimBooking(id, key) {
      const c = convs.get(id);
      if (!c || c.state?.stage !== 'AWAITING_CONFIRMATION' || c.state?.quote?.key !== key) return false;
      c.state.stage = 'BOOKING';
      c.state.bookingStartedAt = new Date().toISOString();
      return true;
    },
    async insertBooking(doc) {
      if (bookings.some((b) => b.idempotencyKey === doc.idempotencyKey)) { const e = new Error('duplicate'); e.code = 'DUPLICATE'; throw e; }
      const b = { id: randomUUID(), ...clone(doc), createdAt: new Date().toISOString() };
      bookings.push(b);
      return clone(b);
    },
    async findBookingByKey(key) { const b = bookings.find((x) => x.idempotencyKey === key); return b ? clone(b) : null; },
    async listBookings() { return clone([...bookings].reverse()); },
    async getBooking(idOrRef) { const b = bookings.find((x) => x.id === idOrRef || x.bookingRef === idOrRef); return b ? clone(b) : null; },
    async insertLog(l) { const e = { id: randomUUID(), ...clone(l), createdAt: new Date().toISOString() }; logs.push(e); return e; },
    async listLogs({ conversationId, limit = 200 } = {}) { return clone(logs.filter((l) => !conversationId || l.conversationId === conversationId).slice(-limit).reverse()); },
  };
}
