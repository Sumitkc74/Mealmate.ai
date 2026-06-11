import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import ReactMarkdown from 'react-markdown';

import {
  useAiCapabilities,
  useAssistantChat,
  type AppliedAction,
  type ChatMessage,
} from '@/hooks/useAiPlanner';
import { extractErrorMessage } from '@/lib/api';

/**
 * Floating cooking-assistant chat widget. Renders a sparkly FAB in the
 * bottom-right that expands into a chat panel. Backed by the AI service's
 * `/chat` endpoint (Google Gemini when `GEMINI_API_KEY` is configured;
 * graceful fallback otherwise).
 *
 * Conversation state is held in component memory only — refreshing the page
 * starts a fresh chat.
 */

/** A single rendered chat turn — assistant turns may carry applied actions. */
interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  appliedActions?: AppliedAction[];
}

export function AiAssistant() {
  const [tab, setTab] = useState<'assistant' | 'recipe-qa'>('assistant');
  const [qaQuestion, setQaDraft] = useState('');
  const [qaHistory, setQaHistory] = useState<{ question: string; answer: string; recipes: any[] }[]>([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const token = useAuthStore((s) => s.token);

  async function sendQA(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    setQaLoading(true);
    setQaError(null);
    setQaDraft('');
    try {
      const res = await fetch('/api/ai/rag/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ question: trimmed, top_k: 5 }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      setQaHistory((h) => [...h, {
        question: trimmed,
        answer: data.answer,
        recipes: data.recipes ?? [],
      }]);
    } catch (err) {
      setQaError(extractErrorMessage(err, 'Could not answer that question'));
    } finally {
      setQaLoading(false);
    }
  }

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ label: string; prompt: string }[]>([
    { label: 'Suggest a 30-min dinner', prompt: "Suggest a 30-minute dinner from what's in my pantry." },
    { label: 'Substitute an ingredient', prompt: 'What can I substitute for buttermilk?' },
    { label: 'Plan a healthy lunch', prompt: 'Plan a healthy lunch under 600 calories.' },
  ]);

  const chat = useAssistantChat();
  const caps = useAiCapabilities();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, chat.isPending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', content: trimmed }];
    setTurns(nextTurns);
    setDraft('');
    // The AI service is stateless — send the running message log each time.
    const wireMessages: ChatMessage[] = nextTurns.map((t) => ({
      role: t.role,
      content: t.content,
    }));
    try {
      const res = await chat.mutateAsync({ messages: wireMessages });
      setTurns((curr) => [
        ...curr,
        {
          role: 'assistant',
          content: res.reply,
          appliedActions: res.applied_actions ?? [],
        },
      ]);
      if (res.suggestions?.length) setSuggestions(res.suggestions);
    } catch (err) {
      setError(extractErrorMessage(err, 'The assistant is unavailable right now'));
    }
  }

  const llmAvailable = caps.data?.llm?.available ?? false;
  const provider = caps.data?.llm?.provider;

  return (
    <>
      {/* Floating action button */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close cooking assistant' : 'Open cooking assistant'}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-2xl text-white shadow-lg shadow-brand-900/30 ring-2 ring-white"
        whileHover={{ scale: 1.08, rotate: 4 }}
        whileTap={{ scale: 0.95 }}
        animate={{
          boxShadow: [
            '0 10px 25px -5px rgba(0,0,0,0.2)',
            '0 14px 30px -5px rgba(20,90,200,0.35)',
            '0 10px 25px -5px rgba(0,0,0,0.2)',
          ],
        }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span aria-hidden>{open ? '×' : '✨'}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.aside
            key="assistant-panel"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className="fixed bottom-24 right-6 z-40 flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
            role="dialog"
            aria-label="Cooking assistant"
          >

            <header className="bg-gradient-to-r from-brand-600 to-brand-800 px-4 py-3 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">MealMate Assistant</p>
                  <p className="text-[11px] opacity-80">
                    {llmAvailable
                      ? `Powered by ${provider ?? 'Gemini'}`
                      : 'Offline mode'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1 text-lg leading-none hover:bg-white/10"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {/* Tab switcher */}
              <div className="mt-2 flex gap-1 rounded-lg bg-white/10 p-1">
                <button
                  type="button"
                  onClick={() => setTab('assistant')}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                    tab === 'assistant' ? 'bg-white text-brand-700' : 'text-white hover:bg-white/10'
                  }`}
                >
                  ✨ Assistant
                </button>
                <button
                  type="button"
                  onClick={() => setTab('recipe-qa')}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                    tab === 'recipe-qa' ? 'bg-white text-brand-700' : 'text-white hover:bg-white/10'
                  }`}
                >
                  📖 Recipe Q&amp;A
                </button>
              </div>
            </header>

            {tab === 'assistant' ? (
              <>
                <div
                  ref={scrollRef}
                  className="flex max-h-[55vh] min-h-[260px] flex-1 flex-col gap-2 overflow-y-auto bg-gray-50 p-3"
                >
                  {turns.length === 0 && (
                    <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                      Ask anything about cooking, substitutions, scaling recipes, or
                      what to make with what's in your pantry. You can also say
                      "add chicken stir fry to Friday dinner" and I'll update your
                      weekly plan.
                    </div>
                  )}
                  {turns.map((m, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className={`flex max-w-[85%] flex-col gap-1 ${
                        m.role === 'user' ? 'self-end items-end' : 'self-start items-start'
                      }`}
                    >
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          m.role === 'user'
                            ? 'bg-brand-600 text-white'
                            : 'bg-white text-gray-800'
                        }`}
                      >
                        {m.content.split('\n').map((line, j) => (
                          <p key={j} className={j > 0 ? 'mt-1' : undefined}>
                            {line}
                          </p>
                        ))}
                      </div>
                      {m.role === 'assistant' &&
                        m.appliedActions?.map((action, k) => (
                          <AppliedActionCard key={k} action={action} />
                        ))}
                    </motion.div>
                  ))}
                  {chat.isPending && (
                    <div className="self-start rounded-2xl bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">
                      <TypingDots />
                    </div>
                  )}
                </div>


                {error && (
                  <p role="alert" className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {error}
                  </p>
                )}

                {suggestions.length > 0 && turns.length === 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-gray-100 bg-white px-3 py-2">
                    {suggestions.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => send(s.prompt)}
                        className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(draft);
                  }}
                  className="flex items-center gap-2 border-t border-gray-100 bg-white p-2"
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Ask the assistant…"
                    aria-label="Chat message"
                    className="flex-1 rounded-full border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <button
                    type="submit"
                    disabled={chat.isPending || !draft.trim()}
                    className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 enabled:hover:bg-brand-700"
                  >
                    Send
                  </button>
                </form>
              </>
            ) : (
              <>
                {/* Recipe Q&A tab */}
                <div
                  ref={scrollRef}
                  className="flex max-h-[55vh] min-h-[260px] flex-1 flex-col gap-3 overflow-y-auto bg-gray-50 p-3"
                >
                  {qaHistory.length === 0 && (
                    <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                      <p className="font-medium text-gray-800 mb-1">📖 Recipe Database Q&A</p>
                      <p>Ask anything about recipes in our system — ingredients, substitutes, cooking methods. Answers come <span className="font-medium">only</span> from our recipe database.</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {[
                          'What can I substitute for eggs?',
                          'Which recipes use coconut milk?',
                          'What are vegan recipes in the database?',
                        ].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => sendQA(q)}
                            className="rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {qaHistory.map((item, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <div className="self-end rounded-2xl bg-brand-600 px-3 py-2 text-sm text-white shadow-sm max-w-[85%]">
                        {item.question}
                      </div>
                      <div className="self-start rounded-2xl bg-white px-3 py-2 text-sm text-gray-800 shadow-sm max-w-[90%]">
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown>{item.answer}</ReactMarkdown>
                        </div>
                        {item.recipes.length > 0 && (
                          <div className="mt-2 border-t border-gray-100 pt-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                              From our database
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {item.recipes.slice(0, 3).map((r: any, j: number) => (
                                <span
                                  key={j}
                                  className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700 ring-1 ring-violet-200"
                                >
                                  {r.title}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {qaLoading && (
                    <div className="self-start rounded-2xl bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">
                      <TypingDots />
                    </div>
                  )}
                </div>
                {qaError && (
                  <p role="alert" className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {qaError}
                  </p>
                )}
                <form
                  onSubmit={(e) => { e.preventDefault(); sendQA(qaQuestion); }}
                  className="flex items-center gap-2 border-t border-gray-100 bg-white p-2"
                >
                  <input
                    value={qaQuestion}
                    onChange={(e) => setQaDraft(e.target.value)}
                    placeholder="Ask about our recipes…"
                    aria-label="Recipe question"
                    className="flex-1 rounded-full border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <button
                    type="submit"
                    disabled={qaLoading || !qaQuestion.trim()}
                    className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 enabled:hover:bg-brand-700"
                  >
                    Ask
                  </button>
                </form>
              </>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-gray-400"
          animate={{ opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

/**
 * Compact confirmation card rendered under an assistant turn when the
 * server actually applied a plan mutation. Shows the resolved recipe title,
 * the target day/slot, calories, and a collapsible ingredient list.
 */
function AppliedActionCard({ action }: { action: AppliedAction }) {
  const [showIngredients, setShowIngredients] = useState(false);

  if (action.status !== 'applied' || !action.recipe) {
    // Surface failure cases so the user knows nothing was saved.
    const statusLabel =
      action.status === 'recipe_not_found'
        ? 'Recipe not found'
        : action.status === 'invalid'
          ? 'Invalid request'
          : 'Could not add';
    return (
      <div className="w-full max-w-[280px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
        <p className="font-semibold">⚠️ {statusLabel}</p>
        {action.message && <p className="mt-0.5 opacity-90">{action.message}</p>}
      </div>
    );
  }

  const { recipe } = action;
  const dayLabel = action.requested.day;
  const slotLabel = action.requested.slot;
  const weekLabel =
    action.requested.week_offset === 0
      ? 'this week'
      : action.requested.week_offset === 1
        ? 'next week'
        : `in ${action.requested.week_offset} weeks`;

  return (
    <div className="w-full max-w-[300px] overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-900 shadow-sm">
      {recipe.imageUrl && (
        <img
          src={recipe.imageUrl}
          alt={recipe.title}
          className="h-28 w-full object-cover"
          loading="lazy"
          onError={(e) => {
            // Hide gracefully if the URL is broken or blocked — we don't have
            // local state in this card so just remove the element.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="px-3 py-2">
        <p className="flex flex-wrap items-center gap-1 font-semibold">
          <span aria-hidden>✓</span>
          Added <span className="font-bold">{recipe.title}</span>
          {recipe.generated && (
            <span className="ml-1 rounded-full bg-emerald-200/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
              ✨ AI-generated
            </span>
          )}
        </p>
        <p className="mt-0.5 opacity-90">
          {dayLabel} {slotLabel} ({weekLabel})
          {recipe.calories != null && (
            <>
              {' · '}
              <span className="font-semibold">{Math.round(recipe.calories)} kcal</span>
            </>
          )}
        </p>
        {recipe.ingredients.length > 0 && (
          <button
            type="button"
            onClick={() => setShowIngredients((v) => !v)}
            className="mt-1 text-[11px] font-medium text-emerald-700 underline-offset-2 hover:underline"
          >
            {showIngredients ? 'Hide' : `Show ${recipe.ingredients.length} ingredients`}
          </button>
        )}
        {showIngredients && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] opacity-90">
            {recipe.ingredients.map((ing, i) => (
              <li key={i}>
                {ing.quantity != null && ing.quantity > 0 ? `${ing.quantity} ` : ''}
                {ing.unit ? `${ing.unit} ` : ''}
                {ing.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
