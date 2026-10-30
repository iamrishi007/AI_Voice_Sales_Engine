import { useEffect, useState } from 'react';
import { api, money } from '../api.js';

export default function Bookings() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.bookings().then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Bookings</h1>
        <button onClick={load} className="px-3 py-1.5 rounded-md border border-rule text-sm hover:bg-white">Refresh</button>
      </div>
      {err && <p role="alert" className="text-brick">{err}</p>}
      <div className="bg-white border border-rule rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink/60 border-b border-rule"><tr>{['Reference', 'Package', 'Plan', 'Qty', 'Discount', 'Total', 'Created'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-rule">
            {rows?.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-ink/60">No bookings yet. Confirm a quote in the chat to create one.</td></tr>}
            {rows?.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-2 font-mono">{b.bookingRef}</td>
                <td className="px-4 py-2">{b.productName}</td>
                <td className="px-4 py-2">{b.planCode}</td>
                <td className="px-4 py-2">{b.quantity}</td>
                <td className="px-4 py-2">{b.promoCode ? `${b.discountPercent}% · ${b.promoCode}` : '—'}</td>
                <td className="px-4 py-2 font-medium">{money(b.finalPrice)}</td>
                <td className="px-4 py-2 text-ink/60">{new Date(b.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
