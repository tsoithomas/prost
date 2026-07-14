import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  CornerDownLeft,
  Download,
  FileCode,
  History,
  Settings2,
  Square,
  SquarePen,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatMessage, ChatMode } from '@prost/shared-types';
import './chatMarkdown.css';
import { Button, IconButton, Surface } from '@prost/ui';
import {
  fetchConversation,
  streamAiChat,
  useAppendConversation,
  useConversations,
  useDeleteConversation,
  useLlmEndpoints,
  type ChatTokenUsage,
} from '../api/ai';
import { ApiError, apiErrorDetail } from '../lib/apiClient';
import { useAiStore } from '../stores/aiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { LlmEndpointsModal } from './LlmEndpointsModal';

interface Props {
  connectionId: string;
}

export function ChatPanel({ connectionId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usages, setUsages] = useState<Record<number, ChatTokenUsage>>({});
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ChatMode>('ask');
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: endpoints = [], isLoading: endpointsLoading } = useLlmEndpoints();
  const { data: conversations = [] } = useConversations(connectionId);
  const appendConversation = useAppendConversation(connectionId);
  const deleteConversation = useDeleteConversation(connectionId);
  const loadQuery = useWorkspaceStore((state) => state.loadQuery);
  // The active query tab's SQL — the subject for Explain mode (falls back to the first query tab).
  const activeQuerySql = useWorkspaceStore((state) => {
    const active = state.tabs.find((t) => t.id === state.activeTabId);
    const target = active?.kind === 'query' ? active : state.tabs.find((t) => t.kind === 'query');
    return target?.sql?.trim() ?? '';
  });

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

  function sendMessage(text: string, sendMode: ChatMode) {
    if (!text || isStreaming || !selectedEndpointId || !selectedModel) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const next: ChatMessage[] = [...messages, userMsg];
    const assistantIndex = next.length; // index of the seeded assistant message below
    // Seed an empty assistant message that fills in as deltas stream in.
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let received = false;
    let assistantContent = '';

    streamAiChat(
      connectionId,
      { messages: next, mode: sendMode, endpointId: selectedEndpointId, model: selectedModel },
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
        // Persist the completed exchange, adopting the server-assigned id for the thread.
        if (!assistantContent) return;
        appendConversation.mutate(
          {
            ...(conversationId ? { conversationId } : {}),
            messages: [userMsg, { role: 'assistant', content: assistantContent }],
          },
          { onSuccess: (convo) => setConversationId(convo.id) },
        );
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
        setIsStreaming(false);
        abortRef.current = null;
      });
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
    if (mode === 'explain') {
      // Explain's subject is the current editor query; any typed text is an extra instruction.
      const typed = input.trim();
      if (!activeQuerySql && !typed) return;
      const parts: string[] = [];
      if (activeQuerySql) parts.push(`Explain this query:\n\`\`\`sql\n${activeQuerySql}\n\`\`\``);
      if (typed) parts.push(typed);
      sendMessage(parts.join('\n\n'), 'explain');
      return;
    }
    sendMessage(input.trim(), mode);
  }

  const canSend = mode === 'explain' ? Boolean(activeQuerySql || input.trim()) : Boolean(input.trim());

  // Consume a prompt handed in from elsewhere ("Fix with AI"): switch to Ask mode and auto-send once a
  // model is selected, then clear the hand-off so it doesn't re-fire. If the panel just opened, the
  // model may not be picked yet — this effect re-runs when the selection lands.
  useEffect(() => {
    if (!pendingChatPrompt || !selectedEndpointId || !selectedModel) return;
    setMode('ask');
    sendMessage(pendingChatPrompt, 'ask');
    clearPendingChatPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChatPrompt, selectedEndpointId, selectedModel]);

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
          <div className="relative">
            <IconButton
              aria-label="Chat history"
              onClick={() => setHistoryOpen((v) => !v)}
              disabled={conversations.length === 0}
            >
              <History size={15} />
            </IconButton>
            {historyOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setHistoryOpen(false)} />
                <Surface
                  level="overlay"
                  bordered
                  className="absolute right-0 top-8 z-20 max-h-80 w-64 overflow-y-auto rounded-sm p-xs shadow-lg"
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
              </>
            ) : null}
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

        {/* Mode selector */}
        <div className="flex gap-1 border-b border-border px-sm py-1">
          {(['ask', 'generateSql', 'explain'] as ChatMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-sm px-sm py-0.5 text-xs transition-colors ${
                mode === m
                  ? 'bg-accent-muted font-medium text-accent'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text'
              }`}
            >
              {m === 'ask' ? 'Ask' : m === 'generateSql' ? 'Generate SQL' : 'Explain'}
            </button>
          ))}
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
              <MessageBubble key={i} msg={msg} usage={usages[i]} onLoadSql={loadQuery} />
            ),
          )}
          {awaitingFirstToken ? <TypingIndicator /> : null}
          {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <Surface level="raised" className="border-t border-border p-sm">
          {mode === 'explain' ? (
            <p className="mb-1 flex items-center gap-xs text-xs text-text-faint">
              <FileCode size={12} />
              {activeQuerySql ? 'Explaining your current query' : 'Open or type a query to explain'}
            </p>
          ) : null}
          <div className="flex items-end gap-sm">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderForMode(mode, Boolean(activeQuerySql))}
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

function placeholderForMode(mode: ChatMode, hasQuery: boolean): string {
  switch (mode) {
    case 'generateSql':
      return 'Describe the query you want…';
    case 'explain':
      return hasQuery ? 'Add a question, or just send to explain your query…' : 'Type a query to explain…';
    default:
      return 'Ask about your schema, generate SQL…';
  }
}

function MessageBubble({
  msg,
  usage,
  onLoadSql,
}: {
  msg: ChatMessage;
  usage?: ChatTokenUsage;
  onLoadSql: (sql: string) => void;
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
          <MarkdownMessage content={msg.content} onLoadSql={onLoadSql} />
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
function MarkdownMessage({ content, onLoadSql }: { content: string; onLoadSql: (sql: string) => void }) {
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
              <CodeBlock lang={match?.[1]} code={raw} codeClassName={className} onLoadSql={onLoadSql}>
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
  onLoadSql,
  children,
}: {
  lang?: string;
  code: string;
  codeClassName?: string;
  onLoadSql: (sql: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-sm">
      <pre className="overflow-x-auto rounded-sm bg-surface-sunken p-sm font-mono text-xs text-text">
        <code className={codeClassName}>{children}</code>
      </pre>
      <div className="mt-xs flex items-center gap-md">
        {lang === 'sql' ? (
          <button
            type="button"
            onClick={() => onLoadSql(code)}
            className="flex items-center gap-xs text-xs text-accent hover:underline"
          >
            <Download size={11} />
            Load into editor
          </button>
        ) : null}
        <CopyButton text={code} />
      </div>
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
