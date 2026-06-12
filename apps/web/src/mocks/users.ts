import type { GridResponse } from '@prost/shared-types';

export const usersGridResponse: GridResponse = {
  columns: [
    { name: 'id', dataType: 'int4', nullable: false, isPrimaryKey: true },
    { name: 'email', dataType: 'varchar', nullable: false, isPrimaryKey: false },
    { name: 'first_name', dataType: 'varchar', nullable: false, isPrimaryKey: false },
    { name: 'last_name', dataType: 'varchar', nullable: true, isPrimaryKey: false },
    { name: 'created_at', dataType: 'timestamp', nullable: false, isPrimaryKey: false },
  ],
  rows: [
    { id: 1, email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith', created_at: '2023-10-24 14:32:10' },
    { id: 2, email: 'bob.jones@example.com', first_name: 'Bob', last_name: 'Jones', created_at: '2023-10-25 09:15:00' },
    { id: 3, email: 'charlie@example.com', first_name: 'Charlie', last_name: null, created_at: '2023-10-25 11:42:33' },
    { id: 4, email: 'dana@example.com', first_name: 'Dana', last_name: 'Lee', created_at: '2023-10-26 08:05:41' },
    { id: 5, email: 'evan@example.com', first_name: 'Evan', last_name: 'Wright', created_at: '2023-10-27 16:20:09' },
  ],
  totalRows: 5,
  editable: true,
  sourceTable: 'users',
  primaryKey: ['id'],
};
