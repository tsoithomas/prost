import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  Check,
  Copy,
  CornerDownLeft,
  Download,
  History,
  Play,
  Settings2,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatMessage } from '@prost/shared-types';
import './chatMarkdown.css';
import { Button, IconButton, Surface, Switch } from '@prost/ui';
import {
  fetchConversation,
  streamAiChat,
  useAppendConversation,
  useConversations,
  useDeleteConversation,
  useLlmEndpoints,
  useRunReadQuery,
  type ChatTokenUsage,
} from '../api/ai';
import { useActiveConnection } from '../api/connections';
import { SchemaSuggestionList } from '../ddl/SchemaSuggestionList';
import { useSchemaSuggestions } from '../ddl/useSchemaSuggestions';
import { ApiError, apiErrorDetail } from '../lib/apiClient';
import { useAiStore } from '../stores/aiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { LlmEndpointsModal } from './LlmEndpointsModal';

interface Props {
  connectionId: string;
}

/** Cap on consecutive auto-runs per user turn, so an agent can't loop propose→run→propose forever. */
const MAX_AUTO_RUNS = 3;

/** The first fenced ```sql block whose statement reads like a query (SELECT/WITH), or `null`. */
function firstReadQueryBlock(content: string): string | null {
  const match = /```sql\s*([\s\S]*?)```/i.exec(content);
  const sql = match?.[1]?.trim();
  return sql && /^(select|with)\b/i.test(sql) ? sql : null;
}

export function ChatPanel({ connectionId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usages, setUsages] = useState<Record<number, ChatTokenUsage>>({});
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyBtnRef = useRef<HTMLDivElement>(null);
  // Viewport-anchored position for the history dropdown, which portals to <body> to escape the AI
  // panel's `overflow-hidden` (otherwise it's clipped by the sidebar edge).
  const [historyPos, setHistoryPos] = useState<{ top: number; right: number } | null>(null);
  // Streaming status as a ref so post-stream callbacks (auto-run feed-back) see the up-to-date value.
  const isStreamingRef = useRef(false);
  // Bounds auto-run to a few rounds per user turn so a propose→run→propose loop can't run away.
  const autoRunCountRef = useRef(0);
  const pendingAutoRunSqlRef = useRef<string | null>(null);
  // Always-current messages, so post-stream callbacks (the run→feed-back turn) append to the latest
  // history instead of a stale closure snapshot (which would wipe the question + proposed SQL).
  const messagesRef = useRef<ChatMessage[]>([]);
  // The connection we've already auto-loaded the latest conversation for (once per connection).
  const autoLoadedConnRef = useRef<string | null>(null);
  // Live conversation id so a follow-up turn appends to the same thread despite the async id assignment.
  const conversationIdRef = useRef<string | null>(null);

  const { data: endpoints = [], isLoading: endpointsLoading } = useLlmEndpoints();
  const { data: conversations = [] } = useConversations(connectionId);
  const appendConversation = useAppendConversation(connectionId);
  const deleteConversation = useDeleteConversation(connectionId);
  const loadQuery = useWorkspaceStore((state) => state.loadQuery);
  const runReadQuery = useRunReadQuery(connectionId);
  const autoRunReadQueries = useAiStore((s) => s.autoRunReadQueries);
  const setAutoRunReadQueries = useAiStore((s) => s.setAutoRunReadQueries);
  // Schema suggestions are DDL writes, so the per-block entry point is hidden on read-only
  // connections — the server refuses them there too (Phase 25).
  const writable = !useActiveConnection()?.capabilities.readOnly;

  const selectedEndpointId = useAiStore((s) => s.selectedEndpointId);
  const selectedModel = useAiStore((s) => s.selectedModel);
  const setSelection = useAiStore((s) => s.setSelection);
  const pendingChatPrompt = useAiStore((s) => s.pendingChatPrompt);
  const clearPendingChatPrompt = useAiStore((s) => s.clearPendingChatPrompt);

  // Keep a valid selection: pick the first available model when none chosen or the
  // persisted one no longer exists.
  useEffect(() => {
    if (endpoints.length === 0) return;
    const stillValid = endpoints.some(
      (e) => e.id === selectedEndpointId && e.models.includes(selectedModel ?? ''),
    );
    if (!stillValid) {
      const first = endpoints.find((e) => e.models.length > 0);
      if (first && first.models[0]) setSelection(first.id, first.models[0]);
    }
  }, [endpoints, selectedEndpointId, selectedModel, setSelection]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Abort any in-flight stream when the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Mirror the latest messages + conversation id into refs for callbacks that fire outside the render.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  function sendMessage(text: string) {
    if (!text || isStreamingRef.current || !selectedEndpointId || !selectedModel) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    // Build from the live ref, not the render's `messages` closure — the feed-back turn runs from an
    // older closure and would otherwise drop the prior turns.
    const next: ChatMessage[] = [...messagesRef.current, userMsg];
    const assistantIndex = next.length; // index of the seeded assistant message below
    // Seed an empty assistant message that fills in as deltas stream in.
    const seeded = [...next, { role: 'assistant' as const, content: '' }];
    messagesRef.current = seeded;
    setMessages(seeded);
    setInput('');
    setError(null);
    isStreamingRef.current = true;
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let received = false;
    let assistantContent = '';

    streamAiChat(
      connectionId,
      { messages: next, endpointId: selectedEndpointId, model: selectedModel },
      {
        signal: controller.signal,
        onUsage: (usage) => setUsages((prev) => ({ ...prev, [assistantIndex]: usage })),
        onDelta: (delta) => {
          received = true;
          assistantContent += delta;
          setMessages((prev) => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') {
              copy[copy.length - 1] = { ...last, content: last.content + delta };
            }
            return copy;
          });
        },
      },
    )
      .then(() => {
        // Persist the completed exchange, adopting the server-assigned id for the thread. Use the id
        // ref (not the closure) so a follow-up turn (the run→feed-back) lands in the SAME conversation
        // rather than forking a new one — otherwise a reload would show only the tail without the question.
        if (!assistantContent) return;
        appendConversation.mutate(
          {
            ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
            messages: [userMsg, { role: 'assistant', content: assistantContent }],
          },
          {
            onSuccess: (convo) => {
              conversationIdRef.current = convo.id;
              setConversationId(convo.id);
            },
          },
        );
        // Auto-run: if enabled (read live, not from a stale closure) and under the round cap, queue the
        // first proposed read-only query to run once streaming has fully settled (in `finally`).
        if (useAiStore.getState().autoRunReadQueries && autoRunCountRef.current < MAX_AUTO_RUNS) {
          const sql = firstReadQueryBlock(assistantContent);
          if (sql) pendingAutoRunSqlRef.current = sql;
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return; // Stop: keep partial
        // A mid-stream failure surfaces as a plain Error whose message carries the provider hint
        // (e.g. "…(HTTP 404)"); a pre-stream failure is an ApiError. Show whichever we have.
        const message =
          err instanceof ApiError
            ? apiErrorDetail(err, 'AI request failed.')
            : err instanceof Error && err.message
              ? err.message
              : 'AI request failed.';
        setError(message);
        if (!received) {
          // Nothing streamed — drop the empty assistant + user turn and restore the input.
          setMessages((prev) => prev.slice(0, -2));
          setInput(text);
        }
      })
      .finally(() => {
        isStreamingRef.current = false;
        setIsStreaming(false);
        abortRef.current = null;
        const auto = pendingAutoRunSqlRef.current;
        pendingAutoRunSqlRef.current = null;
        if (auto) {
          autoRunCountRef.current += 1;
          void handleRunReadQuery(auto);
        }
      });
  }

  /**
   * Run a read-only query the assistant proposed (Phase 31). The server proves + engine-enforces
   * read-only; a sanitized sample is fed back so the model answers inline. A refusal (422) surfaces its
   * reason. Used by the per-query "Run" button and auto-run. The fed-back turn is plain text (no ```
   * fences) since user messages render raw, not as markdown.
   */
  async function handleRunReadQuery(sql: string) {
    if (isStreamingRef.current || runReadQuery.isPending) return;
    setError(null);
    try {
      const res = await runReadQuery.mutateAsync({ sql });
      const note = res.sample.truncated ? ' (truncated sample)' : '';
      const feedback =
        `Results of the query I proposed${note}, as JSON (columns then rows):\n` +
        `${JSON.stringify({ columns: res.sample.columns, rows: res.sample.rows })}\n\n` +
        `Answer the original question using these results.`;
      sendMessage(feedback);
    } catch (err) {
      setError(apiErrorDetail(err, 'Could not run the query.'));
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleNewChat() {
    abortRef.current?.abort();
    setMessages([]);
    setUsages({});
    setError(null);
    setInput('');
    setConversationId(null);
    setHistoryOpen(false);
  }

  async function handleLoadConversation(id: string) {
    abortRef.current?.abort();
    setHistoryOpen(false);
    setError(null);
    setUsages({});
    try {
      const convo = await fetchConversation(connectionId, id);
      setMessages(convo.messages);
      setConversationId(convo.id);
    } catch (err) {
      setError(apiErrorDetail(err, 'Failed to load conversation.'));
    }
  }

  function handleDeleteConversation(id: string) {
    deleteConversation.mutate(id, {
      onSuccess: () => {
        if (conversationId === id) handleNewChat();
      },
    });
  }

  function handleSend() {
    // A fresh user turn resets the auto-run budget (bounds a runaway propose→run→propose loop).
    autoRunCountRef.current = 0;
    sendMessage(input.trim());
  }

  const canSend = Boolean(input.trim());

  // Consume a prompt handed in from elsewhere ("Fix with AI"): auto-send once a model is selected, then
  // clear the hand-off so it doesn't re-fire. If the panel just opened, the model may not be picked yet
  // — this effect re-runs when the selection lands.
  useEffect(() => {
    if (!pendingChatPrompt || !selectedEndpointId || !selectedModel) return;
    sendMessage(pendingChatPrompt);
    clearPendingChatPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChatPrompt, selectedEndpointId, selectedModel]);

  // On open (and per connection), resume the most recent conversation so the user can continue it —
  // but only into a fresh, empty panel, and never over a "Fix with AI" hand-off that's taking over.
  useEffect(() => {
    if (pendingChatPrompt || conversations.length === 0) return;
    if (autoLoadedConnRef.current === connectionId) return;
    autoLoadedConnRef.current = connectionId;
    if (messages.length === 0 && conversationId === null) {
      void handleLoadConversation(conversations[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, conversations, pendingChatPrompt]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const modal = <LlmEndpointsModal open={manageOpen} onClose={() => setManageOpen(false)} />;

  if (!endpointsLoading && endpoints.length === 0) {
    return (
      <>
        {modal}
        <div className="flex h-full flex-col items-center justify-center gap-sm px-md py-lg text-center">
          <Bot size={32} className="text-text-faint" />
          <p className="text-sm font-medium text-text">No LLM endpoints yet</p>
          <p className="text-xs text-text-faint">Add an OpenAI-compatible endpoint to start chatting.</p>
          <Button variant="primary" size="sm" onClick={() => setManageOpen(true)}>
            <Settings2 size={14} />
            Add endpoint
          </Button>
        </div>
      </>
    );
  }

  const selectValue = selectedEndpointId && selectedModel ? `${selectedEndpointId}::${selectedModel}` : '';
  const lastMessage = messages[messages.length - 1];
  const awaitingFirstToken =
    isStreaming && lastMessage?.role === 'assistant' && lastMessage.content === '';

  return (
    <>
      {modal}
      <div className="flex h-full flex-col">
        {/* Toolbar: model picker + manage */}
        <div className="flex items-center gap-sm border-b border-border px-sm py-1">
          <select
            value={selectValue}
            onChange={(e) => {
              const [endpointId, model] = e.target.value.split('::');
              if (endpointId && model) setSelection(endpointId, model);
            }}
            aria-label="Model"
            className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface px-sm text-xs text-text focus:border-accent focus:outline-none"
          >
            {endpoints.map((endpoint) => (
              <optgroup key={endpoint.id} label={endpoint.name}>
                {endpoint.models.map((model) => (
                  <option key={`${endpoint.id}::${model}`} value={`${endpoint.id}::${model}`}>
                    {model}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div ref={historyBtnRef} className="relative">
            <IconButton
              aria-label="Chat history"
              onClick={() => {
                const rect = historyBtnRef.current?.getBoundingClientRect();
                if (rect) setHistoryPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                setHistoryOpen((v) => !v);
              }}
              disabled={conversations.length === 0}
            >
              <History size={15} />
            </IconButton>
            {historyOpen && historyPos
              ? createPortal(
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setHistoryOpen(false)} />
                    <Surface
                      level="overlay"
                      bordered
                      className="fixed z-50 max-h-80 w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-sm p-xs shadow-lg"
                      style={{ top: historyPos.top, right: historyPos.right }}
                    >
                      {conversations.map((c) => (
                        <div key={c.id} className="group flex items-center gap-xs rounded-sm hover:bg-surface-hover">
                          <button
                            type="button"
                            onClick={() => void handleLoadConversation(c.id)}
                            className={`flex-1 truncate px-sm py-1.5 text-left text-xs ${
                              c.id === conversationId ? 'text-accent' : 'text-text'
                            }`}
                            title={c.title ?? 'Untitled'}
                          >
                            {c.title ?? 'Untitled'}
                          </button>
                          <IconButton
                            aria-label={`Delete conversation ${c.title ?? ''}`}
                            className="mr-1 opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={() => handleDeleteConversation(c.id)}
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </div>
                      ))}
                    </Surface>
                  </>,
                  document.body,
                )
              : null}
          </div>
          <IconButton
            aria-label="New chat"
            onClick={handleNewChat}
            disabled={messages.length === 0 && !isStreaming}
          >
            <SquarePen size={15} />
          </IconButton>
          <IconButton aria-label="Manage endpoints" onClick={() => setManageOpen(true)}>
            <Settings2 size={15} />
          </IconButton>
        </div>

        {/* Agentic auto-run toggle */}
        <div className="flex items-center border-b border-border px-sm py-1">
          <label
            className="ml-auto flex items-center gap-xs text-xs text-text-muted"
            title="Run the assistant's proposed read-only queries automatically, without a per-query confirm."
          >
            <Switch
              checked={autoRunReadQueries}
              onChange={(e) => setAutoRunReadQueries(e.target.checked)}
              aria-label="Auto-run read-only queries"
            />
            Auto-run
          </label>
        </div>

        {/* Message list */}
        <div className="flex-1 space-y-md overflow-y-auto p-md">
          {messages.length === 0 ? (
            <p className="text-center text-xs italic text-text-faint">
              Ask a question about your database schema.
            </p>
          ) : null}
          {messages.map((msg, i) =>
            // Skip the seeded empty assistant placeholder — the typing indicator stands in until the
            // first token lands.
            msg.role === 'assistant' && msg.content === '' ? null : (
              <MessageBubble
                key={i}
                msg={msg}
                usage={usages[i]}
                connectionId={connectionId}
                suggestable={writable}
                onLoadSql={loadQuery}
                onRunReadQuery={handleRunReadQuery}
              />
            ),
          )}
          {awaitingFirstToken ? <TypingIndicator /> : null}
          {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <Surface level="raised" className="border-t border-border p-sm">
          <div className="flex items-end gap-sm">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question, generate SQL, or paste a query to explain…"
              rows={2}
              className="min-h-[2.5rem] flex-1 resize-none rounded-sm border border-border bg-surface px-sm py-xs text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none"
            />
            {isStreaming ? (
              <Button variant="ghost" size="sm" onClick={handleStop} aria-label="Stop">
                <Square size={14} />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSend}
                disabled={!canSend || !selectedModel}
                aria-label="Send"
              >
                <CornerDownLeft size={14} />
              </Button>
            )}
          </div>
        </Surface>
      </div>
    </>
  );
}

function MessageBubble({
  msg,
  usage,
  connectionId,
  suggestable,
  onLoadSql,
  onRunReadQuery,
}: {
  msg: ChatMessage;
  usage?: ChatTokenUsage;
  connectionId: string;
  suggestable: boolean;
  onLoadSql: (sql: string) => void;
  onRunReadQuery: (sql: string) => void;
}) {
  const isUser = msg.role === 'user';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-md py-sm text-sm ${
          isUser ? 'bg-accent text-accent-fg' : 'bg-surface-raised text-text'
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{msg.content}</span>
        ) : (
          <MarkdownMessage
            content={msg.content}
            connectionId={connectionId}
            suggestable={suggestable}
            onLoadSql={onLoadSql}
            onRunReadQuery={onRunReadQuery}
          />
        )}
      </div>
      {usage ? (
        <span className="mt-0.5 px-1 text-[10px] text-text-faint" title="Prompt + completion tokens">
          {usage.promptTokens} + {usage.completionTokens} = {usage.totalTokens} tokens
        </span>
      ) : null}
    </div>
  );
}

/** Extracts the raw text of a rendered markdown node (highlight.js turns code into nested spans). */
function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return '';
}

/** Renders an assistant reply as GitHub-flavored markdown; code blocks get copy + SQL load actions. */
function MarkdownMessage({
  content,
  connectionId,
  suggestable,
  onLoadSql,
  onRunReadQuery,
}: {
  content: string;
  connectionId: string;
  suggestable: boolean;
  onLoadSql: (sql: string) => void;
  onRunReadQuery: (sql: string) => void;
}) {
  return (
    <div className="chat-markdown space-y-sm break-words leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-0.5 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-0.5 pl-4">{children}</ol>,
          h1: ({ children }) => <h1 className="mt-sm text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-sm text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-sm text-sm font-semibold">{children}</h3>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="my-sm w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
          // Let the `code` renderer own block markup so it isn't double-wrapped in a <pre>.
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className ?? '');
            const raw = nodeText(children).replace(/\n$/, '');
            const isBlock = Boolean(match) || raw.includes('\n');
            if (!isBlock) {
              return (
                <code className="rounded-sm bg-surface-sunken px-1 py-0.5 font-mono text-xs">
                  {children}
                </code>
              );
            }
            // `children` carries highlight.js token spans; `raw` is the plain text for the buttons.
            return (
              <CodeBlock
                lang={match?.[1]}
                code={raw}
                codeClassName={className}
                connectionId={connectionId}
                suggestable={suggestable}
                onLoadSql={onLoadSql}
                onRunReadQuery={onRunReadQuery}
              >
                {children}
              </CodeBlock>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({
  lang,
  code,
  codeClassName,
  connectionId,
  suggestable,
  onLoadSql,
  onRunReadQuery,
  children,
}: {
  lang?: string;
  code: string;
  codeClassName?: string;
  connectionId: string;
  /** False on read-only connections, where schema changes are blocked (Phase 25). */
  suggestable: boolean;
  onLoadSql: (sql: string) => void;
  onRunReadQuery: (sql: string) => void;
  children: React.ReactNode;
}) {
  // The server proves + engine-enforces read-only, so "Run" is safe to offer on any SQL block; a
  // non-read statement returns a clear refusal rather than executing.
  const isSql = lang === 'sql';
  const suggest = useSchemaSuggestions(connectionId);

  return (
    <div className="mt-sm">
      <pre className="overflow-x-auto rounded-sm bg-surface-sunken p-sm font-mono text-xs text-text">
        <code className={codeClassName}>{children}</code>
      </pre>
      <div className="mt-xs flex flex-wrap items-center gap-md">
        {isSql ? (
          <button
            type="button"
            onClick={() => onRunReadQuery(code)}
            className="flex items-center gap-xs text-xs text-accent hover:underline"
          >
            <Play size={11} />
            Run (read-only)
          </button>
        ) : null}
        {isSql ? (
          <button
            type="button"
            onClick={() => onLoadSql(code)}
            className="flex items-center gap-xs text-xs text-accent hover:underline"
          >
            <Download size={11} />
            Load into editor
          </button>
        ) : null}
        {isSql && suggestable ? (
          <button
            type="button"
            onClick={() => suggest.request({ sql: code })}
            disabled={suggest.isPending}
            className="flex items-center gap-xs text-xs text-accent hover:underline disabled:opacity-50"
          >
            <Sparkles size={11} />
            {suggest.isPending ? 'Thinking…' : 'Suggest indexes'}
          </button>
        ) : null}
        <CopyButton text={code} />
      </div>
      {suggest.suggestions !== null || suggest.isPending ? (
        <SchemaSuggestionList
          connectionId={connectionId}
          suggestions={suggest.suggestions ?? []}
          loading={suggest.isPending}
          error={suggest.error}
          className="mt-sm"
        />
      ) : null}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-xs text-xs text-text-muted hover:text-text"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-xs rounded-lg bg-surface-raised px-md py-sm">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-faint [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-faint [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-faint [animation-delay:300ms]" />
      </div>
    </div>
  );
}
