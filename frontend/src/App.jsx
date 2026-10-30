import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Chat from './components/Chat.jsx';
import PriceBreakdown from './components/PriceBreakdown.jsx';
import ApiLedger from './components/ApiLedger.jsx';
import Catalog from './components/Catalog.jsx';
import Bookings from './components/Bookings.jsx';
import History from './components/History.jsx';

const TABS = [
  { id: 'chat', label: 'Agent chat' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'history', label: 'Conversations' },
  { id: 'logs', label: 'API log' },
];

export default function App() {
  const [tab, setTab] = useState('chat');
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [stage, setStage] = useState('DISCOVERY');
  const [quote, setQuote] = useState(null);
  const [booking, setBooking] = useState(null);
  const [logs, setLogs] = useState([]);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  const refreshLogs = useCallback(async (id) => setLogs(id ? await api.logs(id).catch(() => []) : []), []);

  // Load (or re-sync) a conversation from the server — also used after the user interrupts a request.
  const loadConversation = useCallback(async (id) => {
    const c = await api.conversation(id);
    setConversationId(c.id);
    setMessages(c.messages.map((m) => ({ ...m, key: `${c.id}-${m.ts}-${m.role}-${Math.random()}` })));
    setStage(c.state?.stage ?? 'DISCOVERY');
    setQuote(c.state?.quote ?? null);
    setBooking(c.bookingId ? await api.booking(c.bookingId).catch(() => null) : null);
    await refreshLogs(c.id);
  }, [refreshLogs]);

  const newConversation = () => { setConversationId(null); setMessages([]); setStage('DISCOVERY'); setQuote(null); setBooking(null); setLogs([]); setTab('chat'); };

  const onTurn = useCallback(async (res) => {
    setConversationId(res.conversationId);
    setStage(res.stage);
    setQuote(res.quote);
    if (res.booking) setBooking(res.booking);
    else if (res.stage !== 'BOOKED') setBooking(null);
    await refreshLogs(res.conversationId);
  }, [refreshLogs]);

  return (
    <div className="min-h-screen md:flex">
      <nav className="md:w-56 shrink-0 bg-ink text-white md:min-h-screen flex md:flex-col gap-1 p-3 overflow-x-auto" aria-label="Sections">
        <div className="hidden md:block px-3 pt-2 pb-6">
          <div className="text-lg font-semibold tracking-tight">Sales Agent Console</div>
          <div className="text-xs text-white/60 mt-1">Catalog → quote → booking</div>
        </div>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
            className={`text-left whitespace-nowrap px-3 py-2 rounded-md text-sm transition-colors ${tab === t.id ? 'bg-white text-ink font-semibold' : 'text-white/75 hover:bg-white/10'}`}>
            {t.label}
          </button>
        ))}
        <div className="hidden md:block mt-auto px-3 py-2 text-xs text-white/60">
          API: {health ? (health.ok ? `online (${health.db})` : 'offline') : '…'}
        </div>
      </nav>

      <main className="flex-1 min-w-0 p-4 md:p-6">
        {tab === 'chat' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] h-[calc(100vh-3rem)] min-h-[560px]">
            <Chat conversationId={conversationId} messages={messages} setMessages={setMessages} onTurn={onTurn} resync={loadConversation} onNew={newConversation} />
            <div className="hidden xl:flex flex-col gap-4 min-h-0">
              <PriceBreakdown quote={quote} stage={stage} booking={booking} />
              <ApiLedger logs={logs} compact />
            </div>
          </div>
        )}
        {tab === 'chat' && (
          <div className="xl:hidden mt-4 grid gap-4">
            <PriceBreakdown quote={quote} stage={stage} booking={booking} />
            <ApiLedger logs={logs} compact />
          </div>
        )}
        {tab === 'catalog' && <Catalog onAsk={() => setTab('chat')} />}
        {tab === 'bookings' && <Bookings />}
        {tab === 'history' && <History onOpen={(id) => { loadConversation(id); setTab('chat'); }} />}
        {tab === 'logs' && <ApiLedger logs={logs} title="API execution log (current conversation)" onRefresh={() => refreshLogs(conversationId)} />}
      </main>
    </div>
  );
}
