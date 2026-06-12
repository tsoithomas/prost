import type { ConnectionDto } from '@prost/shared-types';

const timestamp = '2023-10-01T00:00:00.000Z';

export const mockConnections: ConnectionDto[] = [
  {
    id: '1',
    name: 'Production DB',
    host: 'db.prost.io',
    port: 5432,
    database: 'prost_main',
    username: 'admin_prost',
    sslEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: '2',
    name: 'Staging Main',
    host: 'staging.prost.io',
    port: 5432,
    database: 'prost_main',
    username: 'admin_prost',
    sslEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: '3',
    name: 'Local Dev',
    host: 'localhost',
    port: 5432,
    database: 'prost_dev',
    username: 'postgres',
    sslEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: '4',
    name: 'Analytics Warehouse',
    host: 'wh.prost.io',
    port: 5432,
    database: 'analytics',
    username: 'admin_prost',
    sslEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];
