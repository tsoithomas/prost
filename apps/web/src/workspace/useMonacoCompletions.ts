import { useEffect, useRef } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { SchemaMetadata } from '@prost/shared-types';

export function useMonacoCompletions(monaco: Monaco | null, schema: SchemaMetadata[] | undefined) {
  const schemaRef = useRef(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  useEffect(() => {
    if (!monaco) return;

    const disposable = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.'],
      provideCompletionItems(model, position) {
        const data = schemaRef.current ?? [];
        // Range must span the word being typed so Monaco filters by (and replaces) that prefix;
        // a collapsed range at the cursor breaks both filtering and insertion.
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const textBefore = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const dotMatch = /(\w+)\.(\w*)$/.exec(textBefore);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const suggestions: any[] = [];

        if (dotMatch) {
          const prefix = dotMatch[1]!.toLowerCase();
          // schema.→ suggest table names
          const matchedSchema = data.find((s) => s.name.toLowerCase() === prefix);
          if (matchedSchema) {
            for (const t of matchedSchema.tables) {
              suggestions.push({ label: t.name, kind: monaco.languages.CompletionItemKind.Class, insertText: t.name, range });
            }
          }
          // table.→ suggest column names
          for (const s of data) {
            const t = s.tables.find((t) => t.name.toLowerCase() === prefix);
            if (t) {
              for (const col of t.columns) {
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  detail: col.dataType,
                  range,
                });
              }
            }
          }
          return { suggestions };
        }

        // No dot — schema names, all table names (bare + qualified), all column names (deduped)
        const seenCols = new Set<string>();
        for (const s of data) {
          suggestions.push({ label: s.name, kind: monaco.languages.CompletionItemKind.Module, insertText: s.name, range });
          for (const t of s.tables) {
            suggestions.push({ label: t.name, kind: monaco.languages.CompletionItemKind.Class, insertText: t.name, range });
            suggestions.push({
              label: `${s.name}.${t.name}`,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: `${s.name}.${t.name}`,
              range,
            });
            for (const col of t.columns) {
              if (!seenCols.has(col.name)) {
                seenCols.add(col.name);
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  detail: col.dataType,
                  range,
                });
              }
            }
          }
        }
        return { suggestions };
      },
    });

    return () => disposable.dispose();
  }, [monaco]);
}
