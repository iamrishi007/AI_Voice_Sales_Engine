import { config } from './config.js';
import { setRepo } from './repo/index.js';
import { createMemoryRepo } from './repo/memoryRepo.js';
import { createApp } from './app.js';

async function start() {
  try {
    const { connectDb, getPool } = await import('./db.js');
    const { createPostgresRepo } = await import('./repo/postgresRepo.js');
    await connectDb();
    setRepo(createPostgresRepo(getPool()));
    console.log(`[db] PostgreSQL connected`);
  } catch (e) {
    if (process.env.REQUIRE_POSTGRES === 'true') {
      console.error('[db] PostgreSQL unavailable:', e.message);
      process.exit(1);
    }
    console.warn(
      `[db] PostgreSQL unavailable (${e.message}). Using IN-MEMORY store — data is lost on restart. Set REQUIRE_POSTGRES=true to disable this fallback.`
    );
    setRepo(createMemoryRepo());
  }
  createApp().listen(config.port, () =>
    console.log(`[api] listening on http://localhost:${config.port}`)
  );
}

start();
