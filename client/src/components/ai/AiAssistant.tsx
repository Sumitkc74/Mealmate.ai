import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import ReactMarkdown from 'react-markdown';

import {
  useAssistantChat,
  streamAssistantChat,
  type AppliedAction,
  type ChatMessage,
} from '@/hooks/useAiPlanner';
import { useAiStatus } from '@/hooks/useAiStatus';
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
  const [tab, setTab] = useState<'assistant' | 'recipe-qa' | 'substitutes'>('assistant');
  const [qaQuestion, setQaDraft] = useState('');
  const [qaHistory, setQaHistory] = useState<{ question: string; answer: string; recipes: any[] }[]>([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);

  const [subQuery, setSubQuery] = useState('');
  const [subResults, setSubResults] = useState<{ target: string; substitute: string; ratio: string; context: string; notes: string }[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const token = useAuthStore((s) => s.token);

  async function searchSubstitutes(ing: string) {
    const clean = ing.trim();
    if (!clean) return;
    setSubLoading(true);
    setSubError(null);
    try {
      const res = await fetch(`/api/ai/knowledge/substitutes?ingredient=${encodeURIComponent(clean)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      setSubResults(data.substitutions || []);
      if (!data.substitutions || data.substitutions.length === 0) {
        setSubError(`No direct substitutes in Knowledge Graph for "${clean}". Try buttermilk, egg, butter, or soy sauce.`);
      }
    } catch (err) {
      setSubError(extractErrorMessage(err, 'Could not fetch substitutions'));
      setSubResults([]);
    } finally {
      setSubLoading(false);
    }
  }

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

  const queryClient = useQueryClient();
  const chat = useAssistantChat();
  const aiStatus = useAiStatus();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, chat.isPending, isStreaming]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || chat.isPending) return;
    setError(null);
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', content: trimmed }];
    setTurns([...nextTurns, { role: 'assistant', content: '', appliedActions: [] }]);
    setDraft('');

    const wireMessages: ChatMessage[] = nextTurns.map((t) => ({
      role: t.role,
      content: t.content,
    }));

    setIsStreaming(true);

    try {
      await streamAssistantChat(
        { messages: wireMessages },
        {
          onToken: (chunk) => {
            setTurns((curr) => {
              const last = curr[curr.length - 1];
              if (!last || last.role !== 'assistant') return curr;
              return [
                ...curr.slice(0, -1),
                { ...last, content: last.content + chunk },
              ];
            });
          },
          onDone: (data) => {
            setIsStreaming(false);
            setTurns((curr) => {
              const last = curr[curr.length - 1];
              return [
                ...curr.slice(0, -1),
                {
                  role: 'assistant',
                  content: data.reply || last?.content || 'Done.',
                  appliedActions: data.applied_actions ?? [],
                },
              ];
            });
            if (data.suggestions?.length) setSuggestions(data.suggestions);
            if (data.applied_actions?.some((a) => a.status === 'applied')) {
              queryClient.invalidateQueries({ queryKey: ['mealplans'] });
              queryClient.invalidateQueries({ queryKey: ['mealplan'] });
              queryClient.invalidateQueries({ queryKey: ['grocery'] });
              if (data.applied_actions.some((a) => a.recipe?.generated)) {
                queryClient.invalidateQueries({ queryKey: ['recipes'] });
              }
            }
          },
          onError: async () => {
            // Fallback to standard HTTP mutateAsync
            try {
              const res = await chat.mutateAsync({ messages: wireMessages });
              setTurns((curr) => [
                ...curr.slice(0, -1),
                {
                  role: 'assistant',
                  content: res.reply,
                  appliedActions: res.applied_actions ?? [],
                },
              ]);
              if (res.suggestions?.length) setSuggestions(res.suggestions);
            } catch (fallbackErr) {
              setError(extractErrorMessage(fallbackErr, 'The assistant is unavailable right now'));
              setTurns((curr) => curr.slice(0, -1));
            } finally {
              setIsStreaming(false);
            }
          },
        }
      );
    } catch {
      // Fallback if streamAssistantChat itself throws synchronously
      try {
        const res = await chat.mutateAsync({ messages: wireMessages });
        setTurns((curr) => [
          ...curr.slice(0, -1),
          {
            role: 'assistant',
            content: res.reply,
            appliedActions: res.applied_actions ?? [],
          },
        ]);
        if (res.suggestions?.length) setSuggestions(res.suggestions);
      } catch (fallbackErr) {
        setError(extractErrorMessage(fallbackErr, 'The assistant is unavailable right now'));
        setTurns((curr) => curr.slice(0, -1));
      } finally {
        setIsStreaming(false);
      }
    }
  }

  const llmAvailable = aiStatus.llmOnline;
  const provider = null; // provider name not exposed by useAiStatus; only used for display

  return (
    <>
      {/* Floating action button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close cooking assistant' : 'Open cooking assistant'}
        className="fixed bottom-6 right-6 z-40 flex h-12 px-4 items-center justify-center gap-1.5 rounded-full bg-brand-600 text-sm font-semibold text-white border border-brand-700 shadow-sm hover:bg-brand-700 transition"
      >
        <span aria-hidden>{open ? 'Close' : 'Assistant'}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.aside
            key="assistant-panel"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-20 right-6 z-40 flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-lg border border-line bg-card shadow-lg"
            role="dialog"
            aria-label="Cooking assistant"
          >

            <header className="border-b border-line bg-canvas px-4 py-3 text-ink">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">MealMate Assistant</p>
                  <p className="text-[11px] text-ink-soft">
                    {llmAvailable
                      ? `Powered by ${provider ?? 'Gemini'}`
                      : 'Offline mode'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-sm text-ink-soft hover:bg-canvas-soft hover:text-ink"
                  aria-label="Close"
                >
                  Close
                </button>
              </div>
              {/* Tab switcher */}
              <div className="mt-2 flex gap-1 rounded bg-canvas-soft border border-line p-1">
                <button
                  type="button"
                  onClick={() => setTab('assistant')}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
                    tab === 'assistant' ? 'bg-card text-brand-700 border border-line font-semibold' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setTab('recipe-qa')}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
                    tab === 'recipe-qa' ? 'bg-card text-brand-700 border border-line font-semibold' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  Q&amp;A
                </button>
                <button
                  type="button"
                  onClick={() => setTab('substitutes')}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
                    tab === 'substitutes' ? 'bg-card text-brand-700 border border-line font-semibold' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  Swaps
                </button>
              </div>
            </header>

            {!aiStatus.serviceOnline && !aiStatus.loading && (
              <div className="mx-4 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                AI assistant is offline. Start the AI service to use chat.
                <br />
                You can still browse your{' '}
                <a href="/recipes" className="underline font-medium">saved recipes</a>{' '}
                or check your{' '}
                <a href="/pantry" className="underline font-medium">pantry</a>.
              </div>
            )}

            {tab === 'assistant' ? (
              <>
                <div
                  ref={scrollRef}
                  className="flex max-h-[55vh] min-h-[260px] flex-1 flex-col gap-2 overflow-y-auto bg-gray-50 p-3"
                >
                  {turns.length === 0 && (
                    <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm space-y-2">
                      <p>
                        Ask anything about cooking, substitutions, scaling recipes, or
                        what to make with what's in your pantry. You can also say
                        "add chicken stir fry to Friday dinner" and I'll update your
                        weekly plan.
                      </p>
                      <div className="rounded border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-900 leading-normal">
                        <strong>Notice:</strong> Assistant responses are computational estimates and not clinical medical or dietetic advice. Always verify allergens on physical packaging.
                      </div>
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
                        {m.content ? (
                          m.content.split('\n').map((line, j) => (
                            <p key={j} className={j > 0 ? 'mt-1' : undefined}>
                              {line}
                            </p>
                          ))
                        ) : (
                          <TypingDots />
                        )}
                      </div>
                      {m.role === 'assistant' &&
                        m.appliedActions?.map((action, k) => (
                          <AppliedActionCard key={k} action={action} />
                        ))}
                    </motion.div>
                  ))}
                  {(chat.isPending || isStreaming) && turns[turns.length - 1]?.role !== 'assistant' && (
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
                    maxLength={500}
                    placeholder="Ask the assistant…"
                    aria-label="Chat message"
                    disabled={!aiStatus.serviceOnline}
                    className="flex-1 rounded-full border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <button
                    type="submit"
                    disabled={!aiStatus.serviceOnline || chat.isPending || isStreaming || !draft.trim()}
                    className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 enabled:hover:bg-brand-700"
                  >
                    Send
                  </button>
                </form>
              </>
            ) : tab === 'recipe-qa' ? (
              <>
                {/* Recipe Q&A tab */}
                <div
                  ref={scrollRef}
                  className="flex max-h-[55vh] min-h-[260px] flex-1 flex-col gap-3 overflow-y-auto bg-gray-50 p-3"
                >
                  {qaHistory.length === 0 && (
                    <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                      <p className="font-medium text-gray-800 mb-1">Recipe Database Q&A</p>
                      <p>Ask anything about recipes in our system - ingredients, substitutes, cooking methods. Answers come <span className="font-medium">only</span> from our recipe database.</p>
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
                    maxLength={500}
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
            ) : (
              <>
                {/* Knowledge Graph Substitutes tab */}
                <div className="flex max-h-[55vh] min-h-[260px] flex-1 flex-col gap-2 overflow-y-auto bg-gray-50 p-3">
                  <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                    <p className="font-medium text-gray-800 mb-1">Knowledge Graph Swaps</p>
                    <p className="text-xs text-gray-500 mb-2">
                      Find verified culinary substitutes with volumetric ratios and flavor context from our graph database.
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {['Buttermilk', 'Egg', 'Butter', 'Heavy Cream', 'Soy Sauce', 'All-Purpose Flour'].map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            setSubQuery(item);
                            searchSubstitutes(item);
                          }}
                          className="rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100 transition"
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  {subLoading && (
                    <div className="self-start rounded-2xl bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">
                      <TypingDots />
                    </div>
                  )}

                  {subResults.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {subResults.map((sub, idx) => (
                        <div key={idx} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-900 text-sm">{sub.substitute}</span>
                            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                              Ratio: {sub.ratio}
                            </span>
                          </div>
                          {sub.context && (
                            <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase font-bold text-gray-600">
                              {sub.context}
                            </span>
                          )}
                          {sub.notes && (
                            <p className="mt-1.5 text-xs text-gray-600 italic">
                              "{sub.notes}"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {subError && (
                  <p role="alert" className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {subError}
                  </p>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    searchSubstitutes(subQuery);
                  }}
                  className="flex items-center gap-2 border-t border-gray-100 bg-white p-2"
                >
                  <input
                    value={subQuery}
                    onChange={(e) => setSubQuery(e.target.value)}
                    placeholder="Search ingredient (e.g. buttermilk)…"
                    aria-label="Substitute search"
                    className="flex-1 rounded-full border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <button
                    type="submit"
                    disabled={subLoading || !subQuery.trim()}
                    className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 enabled:hover:bg-brand-700"
                  >
                    Find
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
      <div className="w-full max-w-[280px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
        <p className="font-semibold">{statusLabel}</p>
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
    <div className="w-full max-w-[300px] overflow-hidden rounded-lg border border-line bg-card text-xs text-ink shadow-sm">
      {recipe.imageUrl && (
        <img
          src={recipe.imageUrl}
          alt={recipe.title}
          width={300}
          height={112}
          loading="lazy"
          decoding="async"
          className="h-28 w-full object-cover"
          onError={(e) => {
            // Hide gracefully if the URL is broken or blocked - we don't have
            // local state in this card so just remove the element.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="px-3 py-2">
        <p className="flex flex-wrap items-center gap-1 font-semibold text-ink">
          Added <span className="font-bold">{recipe.title}</span>
          {recipe.generated && (
            <span className="ml-1 rounded bg-canvas-soft border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
              Generated
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
