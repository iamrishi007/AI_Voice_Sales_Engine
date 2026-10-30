import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { repo } from './repo/index.js';
import { HttpError } from './services/errors.js';
import { getCatalogInfo } from './services/catalogService.js';
import { createBooking } from './services/bookingService.js';
import { processTurn } from './services/chatService.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin.split(','), exposedHeaders: ['Idempotency-Key'] }));
  app.use(express.json({ limit: '100kb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  app.get('/api/health', wrap(async (_req, res) => res.json({ ok: true, db: repo.kind })));

  // GET /api/catalog  — exact contract from the assignment
  app.get('/api/catalog', wrap(async (req, res) => res.json(await getCatalogInfo(req.query.query, { note: 'direct API call' }))));

  // POST /api/chat  { conversationId?, message, clientMessageId? }
  app.post('/api/chat', wrap(async (req, res) => res.json(await processTurn(req.body || {}))));
  // GET /api/chat  (history list) and GET /api/chat/:id (full conversation)
  app.get('/api/chat', wrap(async (_req, res) => {
    const list = await repo.listConversations();
    res.json(list.map((c) => ({ id: c.id, title: c.title, stage: c.state?.stage, messageCount: c.messages.length, bookingId: c.bookingId, updatedAt: c.updatedAt })));
  }));
  app.get('/api/chat/:id', wrap(async (req, res) => {
    const c = await repo.getConversation(req.params.id);
    if (!c) throw new HttpError(404, 'Conversation not found');
    res.json(c);
  }));

  // POST /api/bookings  { sku_id, plan_code, quantity, promo_code, final_price }  (+ optional Idempotency-Key header)
  app.post('/api/bookings', wrap(async (req, res) => {
    const key = req.get('Idempotency-Key') || undefined;
    const b = await createBooking(req.body || {}, { idempotencyKey: key });
    res.status(b.duplicate ? 200 : 201).json(b);
  }));
  app.get('/api/bookings', wrap(async (_req, res) => res.json(await repo.listBookings())));
  app.get('/api/bookings/:id', wrap(async (req, res) => {
    const b = await repo.getBooking(req.params.id);
    if (!b) throw new HttpError(404, 'Booking not found');
    res.json(b);
  }));

  // API execution logs (exact requests/responses of GET catalog & POST bookings)
  app.get('/api/logs', wrap(async (req, res) => res.json(await repo.listLogs({ conversationId: req.query.conversationId, limit: Number(req.query.limit) || 200 }))));

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error', details: err.details });
  });
  return app;
}
