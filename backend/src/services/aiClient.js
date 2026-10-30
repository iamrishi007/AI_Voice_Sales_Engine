import { config } from '../config.js';

async function post(path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.aiTimeoutMs);
  try {
    const res = await fetch(`${config.aiServiceUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } // AI service down => deterministic engine still works
  finally { clearTimeout(t); }
}

const NUM_RE = /\d+(?:,\d{3})*(?:\.\d+)?/g;
const CODE_RE = /\b[A-Z]{4,}\d+\b/g;
const sig = (t) => [...(t.match(NUM_RE) || []).map((n) => n.replace(/,/g, '')), ...(t.match(CODE_RE) || [])].sort().join('|');

export async function analyze({ message, state, history, catalog }) {
  const r = await post('/nlu', { message, state, history, catalog });
  return r?.available ? r.result : null;
}

/** The LLM may only re-word. Any change in numbers or codes => discard its text and use the deterministic text. */
export async function polish({ text, userMessage, history }) {
  const r = await post('/polish', { text, user_message: userMessage, history });
  const out = r?.available && typeof r.text === 'string' ? r.text.trim() : null;
  if (!out || sig(out) !== sig(text) || out.length > text.length * 2 + 200) return { text, polished: false };
  return { text: out, polished: true };
}
