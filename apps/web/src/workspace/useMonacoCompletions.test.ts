import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Monaco } from '@monaco-editor/react';
import type { SchemaMetadata } from '@prost/shared-types';
import { useMonacoCompletions } from './useMonacoCompletions';

const SCHEMA: SchemaMetadata[] = [
  {
    name: 'public',
    tables: [
      {
        schema: 'public',
        name: 'users',
        columns: [
          { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false },
        ],
      },
      {
        schema: 'public',
        name: 'orders',
        columns: [{ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true }],
      },
    ],
  },
];

interface Suggestion {
  label: string;
  kind: number;
  detail?: string;
}

interface CapturedProvider {
  triggerCharacters?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provideCompletionItems(model: any, position: any): { suggestions: Suggestion[] };
}

function makeMonaco() {
  let capturedProvider: CapturedProvider | null = null;
  const disposable = { dispose: vi.fn() };

  const monacoMock = {
    languages: {
      registerCompletionItemProvider: vi.fn((_lang: string, provider: CapturedProvider) => {
        capturedProvider = provider;
        return disposable;
      }),
      CompletionItemKind: { Module: 8, Class: 5, Field: 3 },
    },
  };

  function invoke(textBefore: string): { suggestions: Suggestion[] } {
    if (!capturedProvider) throw new Error('provider not registered');
    const model = { getValueInRange: vi.fn().mockReturnValue(textBefore) };
    const position = { lineNumber: 1, column: textBefore.length + 1 };
    return capturedProvider.provideCompletionItems(model, position);
  }

  return { monaco: monacoMock as unknown as Monaco, disposable, invoke };
}

describe('useMonacoCompletions', () => {
  it('registers a completion provider on the monaco instance', () => {
    const { monaco } = makeMonaco();
    renderHook(() => useMonacoCompletions(monaco, SCHEMA));
    expect((monaco as unknown as ReturnType<typeof makeMonaco>['monaco']).languages.registerCompletionItemProvider).toHaveBeenCalledWith(
      'sql',
      expect.objectContaining({ triggerCharacters: ['.'] }),
    );
  });

  it('disposes the provider on unmount', () => {
    const { monaco, disposable } = makeMonaco();
    const { unmount } = renderHook(() => useMonacoCompletions(monaco, SCHEMA));
    unmount();
    expect(disposable.dispose).toHaveBeenCalledOnce();
  });

  it('no dot — returns schema names, table names, and deduplicated column names', () => {
    const { monaco, invoke } = makeMonaco();
    renderHook(() => useMonacoCompletions(monaco, SCHEMA));
    const { suggestions } = invoke('SELECT ');
    const labels = suggestions.map((s) => s.label);
    expect(labels).toContain('public');
    expect(labels).toContain('users');
    expect(labels).toContain('orders');
    expect(labels).toContain('public.users');
    expect(labels).toContain('public.orders');
    expect(labels).toContain('email');
    // 'id' appears in both tables but should be deduped to one suggestion
    expect(labels.filter((l) => l === 'id')).toHaveLength(1);
  });

  it("table. → returns only that table's columns", () => {
    const { monaco, invoke } = makeMonaco();
    renderHook(() => useMonacoCompletions(monaco, SCHEMA));
    const { suggestions } = invoke('SELECT users.');
    const labels = suggestions.map((s) => s.label);
    expect(labels).toContain('id');
    expect(labels).toContain('email');
    expect(labels).not.toContain('users');
    expect(labels).not.toContain('orders');
  });

  it('table. → includes dataType as detail on column suggestions', () => {
    const { monaco, invoke } = makeMonaco();
    renderHook(() => useMonacoCompletions(monaco, SCHEMA));
    const { suggestions } = invoke('SELECT users.');
    const emailSuggestion = suggestions.find((s) => s.label === 'email');
    expect(emailSuggestion?.detail).toBe('character varying');
  });

  it('schema. → returns table names in that schema, not column names', () => {
    const { monaco, invoke } = makeMonaco();
    renderHook(() => useMonacoCompletions(monaco, SCHEMA));
    const { suggestions } = invoke('FROM public.');
    const labels = suggestions.map((s) => s.label);
    expect(labels).toContain('users');
    expect(labels).toContain('orders');
    expect(labels).not.toContain('id');
    expect(labels).not.toContain('email');
  });

  it('returns no suggestions when schema is undefined', () => {
    const { monaco, invoke } = makeMonaco();
    renderHook(() => useMonacoCompletions(monaco, undefined));
    const { suggestions } = invoke('SELECT ');
    expect(suggestions).toHaveLength(0);
  });

  it('does nothing when monaco is null', () => {
    // should not throw
    renderHook(() => useMonacoCompletions(null, SCHEMA));
  });
});
