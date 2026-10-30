import { useEffect, useRef, useState } from 'react';
import { api, uid } from '../api.js';

const SUGGESTIONS = [
  'I need arrow mesh wifi on the PRO plan for a 5-room house',
  'Sink hub for 7 people, standard plan',
  'Do you have the Netgear Orbi router?',
];

export default function Chat({ conversationId, messages, setMessages, onTurn, resync, onNew }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]); // [{ id, ctrl }]
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const endRef = useRef(null);
  const convRef = useRef(conversationId);
  convRef.current = conversationId;
  const recogRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pending.length]);

  const say = (t) => {
    if (!speak || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(t.replace(/[•✅$]/g, '')));
  };

  async function send(raw) {
    const message = (raw ?? text).trim();
    if (!message) return;
    setText('');
    setError('');
    const clientMessageId = uid();
    const ctrl = new AbortController();
    setMessages((m) => [...m, { key: clientMessageId, role: 'user', content: message, local: true }]);
    setPending((p) => [...p, { id: clientMessageId, ctrl }]);
    try {
      const res = await api.chat({ conversationId: convRef.current, message, clientMessageId }, ctrl.signal);
      convRef.current = res.conversationId;
      setMessages((m) => [...m, { key: `${clientMessageId}-a`, role: 'assistant', content: res.reply, intent: res.intent }]);
      say(res.reply);
      await onTurn(res);
    } catch (e) {
      if (e.name === 'AbortError') {
        // The server still finishes the turn safely; re-sync from the stored conversation.
        setError('Stopped waiting. The server completes each turn safely — conversation re-synced.');
        if (convRef.current) await resync(convRef.current).catch(() => {});
      } else setError(e.message);
    } finally {
      setPending((p) => p.filter((x) => x.id !== clientMessageId));
    }
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return setError('Voice input is not supported in this browser.');
    if (listening) return recogRef.current?.stop();
    const r = new SR();
    r.lang = 'en-US';
    r.onresult = (e) => { const t = e.results[0][0].transcript; setText(t); send(t); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    setListening(true);
    r.start();
  }

  return (
    <section className="flex flex-col min-h-0 bg-white border border-rule rounded-lg" aria-label="Agent chat">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-rule">
        <div>
          <h1 className="font-semibold">Agent chat</h1>
          <p className="text-xs text-ink/60">{conversationId ? `Conversation ${conversationId.slice(0, 8)}` : 'New conversation'}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-ink/70 cursor-pointer"><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Read replies aloud</label>
          <button onClick={onNew} className="px-3 py-1.5 rounded-md border border-rule hover:bg-paper">New chat</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="max-w-md">
            <p className="text-sm text-ink/70 mb-3">Tell the agent what you need — typos and nicknames are fine. Try:</p>
            <div className="flex flex-col gap-2 items-start">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="text-left text-sm px-3 py-2 rounded-md border border-rule hover:bg-sea-soft">{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.key} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap text-sm leading-relaxed px-3.5 py-2.5 rounded-lg ${m.role === 'user' ? 'bg-ink text-white' : 'bg-paper border border-rule'}`}>{m.content}</div>
          </div>
        ))}
        {pending.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="px-3.5 py-3 rounded-lg bg-paper border border-rule flex gap-1" aria-label="Agent is working"><span className="dot w-1.5 h-1.5 rounded-full bg-ink" /><span className="dot w-1.5 h-1.5 rounded-full bg-ink" /><span className="dot w-1.5 h-1.5 rounded-full bg-ink" /></div>
            <button onClick={() => pending.forEach((p) => p.ctrl.abort())} className="text-xs underline text-ink/60 hover:text-ink">Stop waiting</button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <div role="alert" className="mx-4 mb-2 text-sm text-brick">{error}</div>}
      <form className="flex gap-2 p-3 border-t border-rule" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <button type="button" onClick={toggleMic} aria-pressed={listening} className={`px-3 rounded-md border border-rule text-sm ${listening ? 'bg-brick text-white' : 'hover:bg-paper'}`}>{listening ? 'Listening…' : 'Voice'}</button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" aria-label="Message" maxLength={1000} className="flex-1 min-w-0 px-3 py-2 rounded-md border border-rule bg-white" />
        <button className="px-4 py-2 rounded-md bg-sea text-white font-medium disabled:opacity-50" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}
