import { describe, expect, it } from 'vitest';
import type { SchemaMetadata, SnippetDto } from '@prost/shared-types';
import {
  PER_GROUP_LIMIT,
  buildMetadataItems,
  createMetadataFuse,
  createSnippetFuse,
  flattenResults,
  search,
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
      },
    ];
    const fuse = createMetadataFuse(buildMetadataItems(many));
    const groups = search('table', fuse, snippetFuse, []);
    expect(groups.tables.length).toBe(PER_GROUP_LIMIT);
  });
});
