import { describe, expect, it } from 'vitest';
import type { SchemaMetadata, SnippetDto } from '@prost/shared-types';
import {
  PER_GROUP_LIMIT,
  buildMetadataItems,
  createCommandFuse,
  createMetadataFuse,
  createSnippetFuse,
  flattenResults,
  search,
  type SearchItem,
} from './searchIndex';

function column(name: string) {
  return { name, dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null };
}

const schemas: SchemaMetadata[] = [
  {
    name: 'public',
    tables: [
      { schema: 'public', name: 'orders', columns: [column('id'), column('total')] },
      { schema: 'public', name: 'order_items', columns: [column('id')] },
    ],
    objects: [],
  },
];

describe('buildMetadataItems', () => {
  it('flattens schemas → tables → columns into search items', () => {
    const items = buildMetadataItems(schemas);
    // 2 tables + (2 + 1) columns
    expect(items).toHaveLength(5);
    expect(items.filter((i) => i.type === 'table')).toHaveLength(2);
    const column = items.find((i) => i.type === 'column' && i.label === 'orders.total');
    expect(column).toMatchObject({ type: 'column', schema: 'public', table: 'orders', column: 'total', dataType: 'text' });
  });
});

describe('search', () => {
  const metadataFuse = createMetadataFuse(buildMetadataItems(schemas));
  const snippetFuse = createSnippetFuse([] as SnippetDto[]);

  it('returns empty groups for a blank query', () => {
    const groups = search('   ', metadataFuse, snippetFuse, []);
    expect(flattenResults(groups)).toEqual([]);
  });

  it('ranks an exact table match above a looser one', () => {
    const groups = search('orders', metadataFuse, snippetFuse, []);
    expect(groups.tables[0]).toMatchObject({ type: 'table', table: 'orders' });
  });

  it('caps each group at PER_GROUP_LIMIT', () => {
    const many: SchemaMetadata[] = [
      {
        name: 'public',
        tables: Array.from({ length: 20 }, (_, i) => ({
          schema: 'public',
          name: `t_table_${i}`,
          columns: [],
        })),
        objects: [],
      },
    ];
    const fuse = createMetadataFuse(buildMetadataItems(many));
    const groups = search('table', fuse, snippetFuse, []);
    expect(groups.tables.length).toBe(PER_GROUP_LIMIT);
  });
});

describe('search — commands (Phase 40)', () => {
  const metadataFuse = createMetadataFuse(buildMetadataItems(schemas));
  const snippetFuse = createSnippetFuse([] as SnippetDto[]);
  const commandItems: SearchItem[] = [
    { type: 'command', id: 'new-query-tab', label: 'New query tab', shortcut: 'Alt+T' },
    { type: 'command', id: 'toggle-focus-mode', label: 'Toggle focus mode' },
  ];
  const commandFuse = createCommandFuse(commandItems);

  it('lists all commands on a blank query — the palette\'s discoverable action surface', () => {
    const groups = search('', metadataFuse, snippetFuse, [], commandItems, commandFuse);
    expect(groups.commands).toEqual(commandItems);
  });

  it('filters commands by fuzzy label match once a query is typed', () => {
    const groups = search('focus', metadataFuse, snippetFuse, [], commandItems, commandFuse);
    expect(groups.commands).toEqual([commandItems[1]]);
  });

  it('commands come first in the flattened keyboard-navigation order', () => {
    const groups = search('', metadataFuse, snippetFuse, [], commandItems, commandFuse);
    const flat = flattenResults(groups);
    expect(flat[0]).toEqual(commandItems[0]);
  });

  it('omitting commands entirely (older call sites) yields no command group', () => {
    const groups = search('', metadataFuse, snippetFuse, []);
    expect(groups.commands).toEqual([]);
  });
});
