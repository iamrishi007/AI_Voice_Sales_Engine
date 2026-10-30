-- AI Sales Agent — PostgreSQL schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS products (
  sku                   TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  max_capacity_per_unit INTEGER NOT NULL CHECK (max_capacity_per_unit >= 1),
  plans                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL DEFAULT 'New conversation',
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  booking_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations (updated_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ref       TEXT NOT NULL UNIQUE,
  idempotency_key   TEXT NOT NULL UNIQUE,
  conversation_id   TEXT,
  sku_id            TEXT NOT NULL,
  product_name      TEXT,
  plan_code         TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price        DOUBLE PRECISION,
  promo_code        TEXT,
  discount_percent  DOUBLE PRECISION NOT NULL DEFAULT 0,
  final_price       DOUBLE PRECISION NOT NULL,
  status            TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_conversation_id ON bookings (conversation_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings (created_at DESC);

CREATE TABLE IF NOT EXISTS api_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  TEXT,
  method           TEXT,
  path             TEXT,
  request          JSONB,
  response         JSONB,
  status           INTEGER,
  duration_ms      INTEGER,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_logs_conversation_id ON api_logs (conversation_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs (created_at DESC);
