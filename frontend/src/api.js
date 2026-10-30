async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  catalog: () => req('/catalog'),
  chat: (body, signal) => req('/chat', { method: 'POST', body: JSON.stringify(body), signal }),
  conversations: () => req('/chat'),
  conversation: (id) => req(`/chat/${id}`),
  bookings: () => req('/bookings'),
  booking: (id) => req(`/bookings/${id}`),
  logs: (conversationId) => req(`/logs${conversationId ? `?conversationId=${conversationId}` : ''}`),
};

export const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
