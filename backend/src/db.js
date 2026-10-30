import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';
import { SEED_CATALOG } from './data/catalog.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool = null;

export function getPool() {
  return pool;
}

export async function connectDb() {
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
  // Fail fast if Postgres is down
  await pool.query('SELECT 1');
  await migrate();
  await seedProducts();
  return pool;
}

export async function migrate() {
  const sqlPath = path.join(__dirname, 'db', 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

export async function seedProducts() {
  for (const [sku, p] of Object.entries(SEED_CATALOG)) {
    await pool.query(
      `INSERT INTO products (sku, name, max_capacity_per_unit, plans)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (sku) DO UPDATE SET
         name = EXCLUDED.name,
         max_capacity_per_unit = EXCLUDED.max_capacity_per_unit,
         plans = EXCLUDED.plans,
         updated_at = NOW()`,
      [sku, p.name, p.max_capacity_per_unit, JSON.stringify(p.plans)]
    );
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
