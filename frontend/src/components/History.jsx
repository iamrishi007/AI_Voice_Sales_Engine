import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function History({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.conversations().then(setRows).catch((e) => setErr(e.message)); }, []);
  return (
    <section>
      <h1 className="text-xl font-semibold mb-4">Conversation history</h1>
      {err && <p role="alert" className="text-brick">{err}</p>}
      <ul className="bg-white border border-rule rounded-lg divide-y divide-rule">
        {rows?.length === 0 && <li className="p-4 text-ink/60 text-sm">No conversations yet.</li>}
        {rows?.map((c) => (
          <li key={c.id}>
            <button onClick={() => onOpen(c.id)} className="w-full text-left px-4 py-3 hover:bg-paper flex items-center justify-between gap-4">
              <span className="min-w-0"><span className="block truncate font-medium">{c.title}</span><span className="text-xs text-ink/60">{c.messageCount} messages · {new Date(c.updatedAt).toLocaleString()}</span></span>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${c.stage === 'BOOKED' ? 'bg-sea-soft text-sea' : 'bg-paper text-ink/70'}`}>{c.stage === 'BOOKED' ? 'Booked' : 'Open'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
