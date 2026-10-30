import { useEffect, useState } from 'react';
import { api, money } from '../api.js';

export default function Catalog({ onAsk }) {
  const [catalog, setCatalog] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.catalog().then(setCatalog).catch((e) => setErr(e.message)); }, []);
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Product catalog</h1>
        <button onClick={onAsk} className="px-3 py-1.5 rounded-md bg-sea text-white text-sm">Ask the agent</button>
      </div>
      {err && <p role="alert" className="text-brick">{err}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {catalog && Object.entries(catalog).map(([sku, p]) => (
          <article key={sku} className="bg-white border border-rule rounded-lg p-4">
            <h2 className="font-semibold">{p.name}</h2>
            <p className="font-mono text-xs text-ink/50 mb-3">{sku}</p>
            <p className="text-sm mb-3">Each unit covers up to <b>{p.max_capacity_per_unit}</b></p>
            <ul className="text-sm divide-y divide-rule border-y border-rule">
              {Object.entries(p.plans).map(([plan, price]) => <li key={plan} className="flex justify-between py-1.5"><span>{plan}</span><span className="font-medium">{money(price)}</span></li>)}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
