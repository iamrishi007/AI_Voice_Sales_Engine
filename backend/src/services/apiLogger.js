import { repo } from '../repo/index.js';

/** Runs `fn`, records the exact request/response in the API execution log and in the per-turn `calls` array. */
export async function logged({ method, path, request, conversationId, calls, note }, fn) {
  const t0 = Date.now();
  let status = 200, response;
  try {
    response = await fn();
    return response;
  } catch (e) {
    status = e.status || 500;
    response = { error: e.message, details: e.details };
    throw e;
  } finally {
    const entry = { conversationId: conversationId || null, method, path, request: request ?? null, response, status, durationMs: Date.now() - t0, note: note || null };
    try {
      const saved = await repo.insertLog(entry);
      calls?.push({ ...entry, id: saved.id, createdAt: saved.createdAt });
    } catch { calls?.push(entry); }
  }
}
