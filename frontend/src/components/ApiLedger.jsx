import { useState } from 'react';

const METHOD = { GET: 'bg-sea-soft text-sea', POST: 'bg-amber-soft text-amber' };

export default function ApiLedger({ logs, compact, title = 'API execution log', onRefresh }) {
  const [open, setOpen] = useState({});
  const ordered = [...logs].reverse().slice(compact ? -12 : 0);
  return (
    <section className={`bg-white border border-rule rounded-lg flex flex-col min-h-0 ${compact ? 'flex-1' : ''}`} aria-label="API execution log">
      <header className="flex items-center justify-between px-4 py-3 border-b border-rule">
        <h2 className="font-semibold">{title}</h2>
        {onRefresh && <button onClick={onRefresh} className="text-sm px-2 py-1 rounded-md border border-rule hover:bg-paper">Refresh</button>}
      </header>
      <ol className="overflow-y-auto divide-y divide-rule font-mono text-xs">
        {ordered.length === 0 && <li className="p-4 text-ink/60 font-sans text-sm">Every GET /api/catalog and POST /api/bookings the agent makes shows up here with its exact payload.</li>}
        {ordered.map((l, i) => {
          const k = l.id || i;
          const isOpen = open[k] ?? (l.method === 'POST' && !compact ? true : false);
          return (
            <li key={k} className="p-3">
              <button className="w-full flex items-center gap-2 text-left" onClick={() => setOpen((o) => ({ ...o, [k]: !isOpen }))} aria-expanded={isOpen}>
                <span className={`px-1.5 py-0.5 rounded ${METHOD[l.method] || 'bg-paper'}`}>{l.method}</span>
                <span className="truncate flex-1">{l.path}</span>
                <span className={l.status >= 400 ? 'text-brick' : 'text-ink/60'}>{l.status} · {l.durationMs}ms</span>
              </button>
              {l.note && <div className="mt-1 text-ink/50 font-sans">{l.note}</div>}
              {isOpen && (
                <div className="mt-2 space-y-2">
                  {l.request != null && <Block label="Request" data={l.request} />}
                  <Block label="Response" data={l.response} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const Block = ({ label, data }) => (
  <div>
    <div className="text-ink/50 font-sans mb-0.5">{label}</div>
    <pre className="bg-paper rounded p-2 overflow-x-auto max-h-56">{JSON.stringify(data, null, 2)}</pre>
  </div>
);
