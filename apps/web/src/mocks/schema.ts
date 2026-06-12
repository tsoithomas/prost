import type { SchemaMetadata } from '@prost/shared-types';

export const mockSchemas: SchemaMetadata[] = [
  {
    name: 'public',
    tables: [
      { schema: 'public', name: 'users' },
      { schema: 'public', name: 'orders' },
      { schema: 'public', name: 'products' },
    ],
  },
];
