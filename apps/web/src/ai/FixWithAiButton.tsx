import { WandSparkles } from 'lucide-react';
import { Button } from '@prost/ui';
import { useLlmEndpoints } from '../api/ai';
import { useAiStore } from '../stores/aiStore';

interface Props {
  /** The failing statement's own SQL text. */
  sql: string;
  message: string;
  code?: string;
  /** Engine display label (e.g. "PostgreSQL"), when known. */
  engineLabel?: string;
  className?: string;
}

/** Composes a diagnosis prompt from a failed statement — the AI backend adds the schema context itself. */
function buildFixPrompt({ sql, message, code, engineLabel }: Omit<Props, 'className'>): string {
  const engine = engineLabel ? `${engineLabel} ` : '';
  const codePart = code ? ` (${code})` : '';
  return `This ${engine}query failed:\n\n\`\`\`sql\n${sql.trim()}\n\`\`\`\n\nError: ${message}${codePart}\n\nWhat's wrong, and how do I fix it? Reply with the corrected query.`;
}

/**
 * "Fix with AI" — sends a failing query + its error into the chat panel (which auto-sends it). Renders
 * nothing when the user has no LLM endpoint configured, so it never dead-ends.
 */
export function FixWithAiButton({ sql, message, code, engineLabel, className }: Props) {
  const { data: endpoints = [] } = useLlmEndpoints();
  const sendToChat = useAiStore((s) => s.sendToChat);

  if (endpoints.length === 0) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={className}
      onClick={() => sendToChat(buildFixPrompt({ sql, message, code, engineLabel }))}
    >
      <WandSparkles size={13} />
      Fix with AI
    </Button>
  );
}
