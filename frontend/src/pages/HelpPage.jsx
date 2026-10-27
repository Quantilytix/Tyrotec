import { useEffect, useRef, useState } from 'react';
import { askHelp } from '../api/help';
import Card from '../components/ui/Card';

const STORAGE_KEY = 'tyrotec_help_chat';
const MAX_CHARS = 1000;
const WELCOME = {
  role: 'assistant',
  text: "Hi! I can answer questions about Tyrotec and about using this portal: what Tyrotec does, how to quote and order, paying, deliveries and more. What would you like to know?",
};
const SUGGESTIONS = [
  'What does Tyrotec do?',
  'Where are you based and how do I contact you?',
  'How do I order a product that is out of stock?',
  'How do I pay for an order?',
];

function loadConversation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    return Array.isArray(saved) && saved.length ? saved : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

// **bold** inside a line of an answer, as React elements (never raw HTML).
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

// An answer's paragraphs and bullet lists.
function Formatted({ text }) {
  const blocks = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = /^([-*•]|\d+[.)])\s+/.exec(line);
    if (bullet) {
      if (!list) {
        list = [];
        blocks.push({ list });
      }
      list.push(line.slice(bullet[0].length));
    } else {
      list = null;
      if (line) blocks.push({ p: line.replace(/^#+\s*/, '') });
    }
  }
  return blocks.map((block, i) =>
    block.list ? (
      <ul key={i} className="my-1 list-disc space-y-0.5 pl-5">
        {block.list.map((item, j) => (
          <li key={j}>{inline(item)}</li>
        ))}
      </ul>
    ) : (
      <p key={i} className="my-1">
        {inline(block.p)}
      </p>
    )
  );
}

// Customers ask anything about Tyrotec or the portal; the AI answers from
// Tyrotec's website and the portal guide (backend helpChatService.js). The
// conversation stays in this browser tab only.
export default function HelpPage() {
  const [messages, setMessages] = useState(loadConversation);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Storage unavailable: the chat still works, it just won't survive a refresh.
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const ask = async (question) => {
    const text = question.trim();
    if (!text || sending) return;
    setError('');
    const next = [...messages, { role: 'user', text }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const { data } = await askHelp(next.filter((m) => m !== WELCOME));
      setMessages((prev) => [...prev, { role: 'assistant', text: data.answer }]);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
      // Let them try again without retyping.
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const startOver = () => {
    setMessages([WELCOME]);
    setError('');
  };

  const asked = messages.some((m) => m.role === 'user');

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Help</h1>
          <p className="mt-1 text-sm text-slate-500">Ask anything about Tyrotec or about using the portal.</p>
        </div>
        {asked && (
          <button type="button" onClick={startOver} className="text-sm font-medium text-teal-600 hover:underline">
            Start over
          </button>
        )}
      </div>

      <Card className="mt-6 flex flex-col">
        <div className="max-h-[60vh] min-h-[320px] space-y-3 overflow-y-auto p-4" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  m.role === 'user' ? 'rounded-br-md bg-teal-500 text-white' : 'rounded-bl-md bg-slate-100 text-ink'
                }`}
              >
                {m.role === 'user' ? <p className="whitespace-pre-wrap">{m.text}</p> : <Formatted text={m.text} />}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-2 text-sm text-slate-500">Typing…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {!asked && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink transition-colors duration-150 hover:bg-slate-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex items-end gap-2 border-t border-slate-100 p-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={2}
            placeholder="Type your question…"
            aria-label="Your question"
            className="min-w-0 flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-teal-500/50"
          >
            Send
          </button>
        </form>
        {error && <p className="mx-3 mb-3 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}
      </Card>

      <p className="mt-3 text-xs text-slate-400">
        Answers come from Tyrotec&apos;s website and the portal guide, and may not cover everything. For prices and stock,
        see Products; for anything else, contact Tyrotec on 087 804 1426 or sales@tyrotec.co.za.
      </p>
    </div>
  );
}
