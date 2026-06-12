import type { QueryResult } from '@prost/shared-types';

/**
 * Mock results for the sample SQL editor query, which joins `orders` with `users`.
 * A joined query has no single source table or primary key, so it's read-only.
 */
export const orderResultsQuery = `SELECT o.id, u.email, o.status, o.total, o.created_at
FROM orders o
JOIN users u ON u.id = o.user_id
ORDER BY o.created_at DESC;`;

export const orderResultsQueryResult: QueryResult = {
  columns: [
    { name: 'id', dataType: 'int4', nullable: false, isPrimaryKey: false },
    { name: 'email', dataType: 'varchar', nullable: false, isPrimaryKey: false },
    { name: 'status', dataType: 'varchar', nullable: false, isPrimaryKey: false },
    { name: 'total', dataType: 'numeric', nullable: false, isPrimaryKey: false },
    { name: 'created_at', dataType: 'timestamp', nullable: false, isPrimaryKey: false },
  ],
  rows: [
    { id: 1, email: 'alice@example.com', status: 'shipped', total: 124.5, created_at: '2023-10-24 14:32:01' },
    { id: 2, email: 'bob.jones@example.com', status: 'shipped', total: 89.99, created_at: '2023-10-24 14:15:22' },
    { id: 3, email: 'charlie@example.com', status: 'shipped', total: 210.0, created_at: '2023-10-24 13:45:10' },
    { id: 4, email: 'dana@example.com', status: 'pending', total: 45.25, created_at: '2023-10-24 12:10:05' },
    { id: 5, email: 'evan@example.com', status: 'shipped', total: 899.99, created_at: '2023-10-24 11:05:44' },
    { id: 6, email: 'alice@example.com', status: 'cancelled', total: 59.0, created_at: '2023-10-23 09:00:00' },
  ],
  totalRows: 6,
  editable: false,
  executionTimeMs: 12,
};
