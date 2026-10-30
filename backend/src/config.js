import 'dotenv/config';

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Optional discrete vars if you prefer not to use a single URL
  const host = process.env.PGHOST || '127.0.0.1';
  const port = process.env.PGPORT || '5432';
  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || 'postgres';
  const database = process.env.PGDATABASE || 'ai_sales_agent';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export const config = {
  port: Number(process.env.PORT || 5000),
  databaseUrl: buildDatabaseUrl(),
  databaseSsl: String(process.env.DATABASE_SSL || '').toLowerCase() === 'true',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 8000),
  bookingLatencyMs: Number(process.env.BOOKING_LATENCY_MS ?? 1500),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};
