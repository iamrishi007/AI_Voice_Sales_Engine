const toIso = (v) => (v instanceof Date ? v.toISOString() : v);

function mapConversation(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    title: row.title,
    messages: row.messages || [],
    state: row.state || {},
    bookingId: row.booking_id ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapBooking(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    bookingRef: row.booking_ref,
    idempotencyKey: row.idempotency_key,
    conversationId: row.conversation_id,
    skuId: row.sku_id,
    productName: row.product_name,
    planCode: row.plan_code,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    promoCode: row.promo_code,
    discountPercent: row.discount_percent,
    finalPrice: Number(row.final_price),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapLog(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    conversationId: row.conversation_id,
    method: row.method,
    path: row.path,
    request: row.request,
    response: row.response,
    status: row.status,
    durationMs: row.duration_ms,
    note: row.note,
    createdAt: toIso(row.created_at),
  };
}

export function createPostgresRepo(pool) {
  return {
    kind: 'postgres',

    async listProducts() {
      const { rows } = await pool.query(
        'SELECT sku, name, max_capacity_per_unit, plans FROM products ORDER BY sku'
      );
      return rows.map((p) => ({
        sku: p.sku,
        name: p.name,
        maxCapacityPerUnit: p.max_capacity_per_unit,
        plans: p.plans || {},
      }));
    },

    async createConversation() {
      const { rows } = await pool.query(
        `INSERT INTO conversations (title, messages, state)
         VALUES ('New conversation', '[]'::jsonb, '{}'::jsonb)
         RETURNING *`
      );
      return mapConversation(rows[0]);
    },

    async getConversation(id) {
      try {
        const { rows } = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
        return mapConversation(rows[0]);
      } catch {
        return null;
      }
    },

    async listConversations() {
      const { rows } = await pool.query(
        'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100'
      );
      return rows.map(mapConversation);
    },

    async saveConversation(c) {
      await pool.query(
        `UPDATE conversations
         SET title = $2,
             messages = $3::jsonb,
             state = $4::jsonb,
             booking_id = $5,
             updated_at = NOW()
         WHERE id = $1`,
        [
          c.id,
          c.title,
          JSON.stringify(c.messages || []),
          JSON.stringify(c.state || {}),
          c.bookingId ?? null,
        ]
      );
    },

    // Atomic compare-and-set: only ONE caller can move AWAITING_CONFIRMATION -> BOOKING for a given quote.
    async claimBooking(id, key) {
      const startedAt = new Date().toISOString();
      const { rows } = await pool.query(
        `UPDATE conversations
         SET state = jsonb_set(
               jsonb_set(state, '{stage}', '"BOOKING"'::jsonb),
               '{bookingStartedAt}', to_jsonb($3::text)
             ),
             updated_at = NOW()
         WHERE id = $1
           AND state->>'stage' = 'AWAITING_CONFIRMATION'
           AND state->'quote'->>'key' = $2
         RETURNING id`,
        [id, key, startedAt]
      );
      return rows.length > 0;
    },

    async insertBooking(doc) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO bookings (
             booking_ref, idempotency_key, conversation_id, sku_id, product_name,
             plan_code, quantity, unit_price, promo_code, discount_percent, final_price, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            doc.bookingRef,
            doc.idempotencyKey,
            doc.conversationId ?? null,
            doc.skuId,
            doc.productName ?? null,
            doc.planCode,
            doc.quantity,
            doc.unitPrice ?? null,
            doc.promoCode ?? null,
            doc.discountPercent ?? 0,
            doc.finalPrice,
            doc.status || 'CONFIRMED',
          ]
        );
        return mapBooking(rows[0]);
      } catch (e) {
        if (e?.code === '23505') {
          const d = new Error('duplicate');
          d.code = 'DUPLICATE';
          throw d;
        }
        throw e;
      }
    },

    async findBookingByKey(key) {
      const { rows } = await pool.query(
        'SELECT * FROM bookings WHERE idempotency_key = $1',
        [key]
      );
      return mapBooking(rows[0]);
    },

    async listBookings() {
      const { rows } = await pool.query(
        'SELECT * FROM bookings ORDER BY created_at DESC LIMIT 200'
      );
      return rows.map(mapBooking);
    },

    async getBooking(idOrRef) {
      const { rows } = await pool.query(
        'SELECT * FROM bookings WHERE booking_ref = $1 OR id::text = $1 LIMIT 1',
        [idOrRef]
      );
      return mapBooking(rows[0]);
    },

    async insertLog(l) {
      const { rows } = await pool.query(
        `INSERT INTO api_logs (
           conversation_id, method, path, request, response, status, duration_ms, note
         ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)
         RETURNING *`,
        [
          l.conversationId ?? null,
          l.method ?? null,
          l.path ?? null,
          l.request == null ? null : JSON.stringify(l.request),
          l.response == null ? null : JSON.stringify(l.response),
          l.status ?? null,
          l.durationMs ?? null,
          l.note ?? null,
        ]
      );
      return mapLog(rows[0]);
    },

    async listLogs({ conversationId, limit = 200 } = {}) {
      const { rows } = conversationId
        ? await pool.query(
            `SELECT * FROM api_logs WHERE conversation_id = $1
             ORDER BY created_at DESC LIMIT $2`,
            [conversationId, limit]
          )
        : await pool.query(
            `SELECT * FROM api_logs ORDER BY created_at DESC LIMIT $1`,
            [limit]
          );
      return rows.map(mapLog);
    },
  };
}
