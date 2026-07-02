import { useEffect, useRef, useState } from 'react';
import { Bot, CornerDownLeft, Download, Settings2 } from 'lucide-react';
import type { ChatMessage, ChatMode } from '@prost/shared-types';
import { Button, IconButton, Surface } from '@prost/ui';
import { useAiChat, useLlmEndpoints } from '../api/ai';
import { apiErrorDetail } from '../lib/apiClient';
import { useAiStore } from '../stores/aiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { LlmEndpointsModal } from './LlmEndpointsModal';

interface Props {
  connectionId: string;
}

export function ChatPanel({ connectionId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ChatMode>('ask');
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: endpoints = [], isLoading: endpointsLoading } = useLlmEndpoints();
  const chat = useAiChat(connectionId);
  const loadQuery = useWorkspaceStore((state) => state.loadQuery);

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
  }, [messages, chat.isPending]);

  function sendMessage(text: string, sendMode: ChatMode) {
    if (!text || chat.isPending || !selectedEndpointId || !selectedModel) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setError(null);

    chat.mutate(
      { messages: next, mode: sendMode, endpointId: selectedEndpointId, model: selectedModel },
      {
        onSuccess: (res) => setMessages((prev) => [...prev, res.message]),
        onError: (err) => {
          setError(apiErrorDetail(err, 'AI request failed.'));
          setMessages((prev) => prev.slice(0, -1));
          setInput(text);
        },
      },
    );
  }

  function handleSend() {
    sendMessage(input.trim(), mode);
  }

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
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} onLoadSql={loadQuery} />
          ))}
          {chat.isPending ? <TypingIndicator /> : null}
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
              placeholder="Ask about your schema, generate SQL…"
              rows={2}
              className="min-h-[2.5rem] flex-1 resize-none rounded-sm border border-border bg-surface px-sm py-xs text-sm text-text placeholder-text-faint focus:border-accent focus:outline-none"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSend}
              disabled={!input.trim() || chat.isPending || !selectedModel}
              aria-label="Send"
            >
              <CornerDownLeft size={14} />
            </Button>
          </div>
        </Surface>
      </div>
    </>
  );
}

function MessageBubble({ msg, onLoadSql }: { msg: ChatMessage; onLoadSql: (sql: string) => void }) {
  const isUser = msg.role === 'user';
  const parts = msg.content.split(/(```sql\n[\s\S]*?```)/g);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-md py-sm text-sm ${
          isUser ? 'bg-accent text-accent-fg' : 'bg-surface-raised text-text'
        }`}
      >
        {parts.map((part, i) => {
          const sqlMatch = part.match(/^```sql\n([\s\S]*?)```$/);
          if (sqlMatch) {
            const sql = (sqlMatch[1] ?? '').trim();
            return (
              <div key={i} className="mt-sm">
                <pre className="overflow-x-auto rounded-sm bg-surface-sunken p-sm font-mono text-xs text-text">
                  {sql}
                </pre>
                <button
                  type="button"
                  onClick={() => onLoadSql(sql)}
                  className="mt-xs flex items-center gap-xs text-xs text-accent hover:underline"
                >
                  <Download size={11} />
                  Load into editor
                </button>
              </div>
            );
          }
          return <span key={i} className="whitespace-pre-wrap">{part}</span>;
        })}
      </div>
    </div>
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
