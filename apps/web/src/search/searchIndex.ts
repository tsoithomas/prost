import Fuse from 'fuse.js';
import type { IFuseOptions } from 'fuse.js';
import type { QueryHistoryDto, SchemaMetadata, SnippetDto } from '@prost/shared-types';

/** Max results shown per result group, keeping the palette bounded (principle §7). */
export const PER_GROUP_LIMIT = 6;

export type SearchItem =
  | { type: 'table'; schema: string; table: string; label: string }
  | { type: 'column'; schema: string; table: string; column: string; dataType: string; label: string }
  | { type: 'snippet'; id: string; name: string; body: string }
  | { type: 'history'; id: string; sql: string; label?: string; connectionName: string };

/** Flatten cached metadata into searchable table + column items. */
export function buildMetadataItems(schemas: SchemaMetadata[]): SearchItem[] {
  const items: SearchItem[] = [];
  for (const schema of schemas) {
    for (const table of schema.tables) {
      items.push({ type: 'table', schema: schema.name, table: table.name, label: table.name });
      for (const column of table.columns) {
        items.push({
          type: 'column',
          schema: schema.name,
          table: table.name,
          column: column.name,
          dataType: column.dataType,
          label: `${table.name}.${column.name}`,
        });
      }
    }
  }
  return items;
}

const metadataFuseOptions: IFuseOptions<SearchItem> = {
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true,
  keys: ['label', 'table', 'column'],
};

const snippetFuseOptions: IFuseOptions<SnippetDto> = {
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true,
  keys: ['name', 'body'],
};

export function createMetadataFuse(items: SearchItem[]): Fuse<SearchItem> {
  return new Fuse(items, metadataFuseOptions);
}

export function createSnippetFuse(snippets: SnippetDto[]): Fuse<SnippetDto> {
  return new Fuse(snippets, snippetFuseOptions);
}

export interface GroupedResults {
  tables: SearchItem[];
  columns: SearchItem[];
  snippets: SearchItem[];
  history: SearchItem[];
}

/**
 * Runs the fuzzy matchers and assembles the bounded, grouped result set. History arrives already
 * filtered by the server (Phase 19), so it's only mapped + capped here.
 */
export function search(
  query: string,
  metadataFuse: Fuse<SearchItem>,
  snippetFuse: Fuse<SnippetDto>,
  history: QueryHistoryDto[],
): GroupedResults {
  const trimmed = query.trim();
  const metaHits = trimmed ? metadataFuse.search(trimmed).map((r) => r.item) : [];
  const snippetHits = trimmed
    ? snippetFuse.search(trimmed).map((r) => r.item)
    : [];

  return {
    tables: metaHits.filter((i) => i.type === 'table').slice(0, PER_GROUP_LIMIT),
    columns: metaHits.filter((i) => i.type === 'column').slice(0, PER_GROUP_LIMIT),
    snippets: snippetHits
      .slice(0, PER_GROUP_LIMIT)
      .map((s) => ({ type: 'snippet', id: s.id, name: s.name, body: s.body }) satisfies SearchItem),
    history: history.slice(0, PER_GROUP_LIMIT).map(
      (h) =>
        ({
          type: 'history',
          id: h.id,
          sql: h.sql,
          label: h.label,
          connectionName: h.connectionName,
        }) satisfies SearchItem,
    ),
  };
}

/** Flatten grouped results into the linear order used for keyboard navigation. */
export function flattenResults(groups: GroupedResults): SearchItem[] {
  return [...groups.tables, ...groups.columns, ...groups.snippets, ...groups.history];
}
