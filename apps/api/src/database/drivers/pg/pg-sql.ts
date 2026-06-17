import { quoteIdent } from '@prost/utils';
import type { SqlFragment, TableRef } from '../../types';

export const pgQuoteIdent = quoteIdent;
export const pgPlaceholder = (index: number): string => `$${index}`;

/** PG: namespace = schema; default to `public` only where a single-table op needs it (callers pass it explicitly). */
function qualify(ref: TableRef): string {
  const table = pgQuoteIdent(ref.name);
  return ref.namespace ? `${pgQuoteIdent(ref.namespace)}.${table}` : table;
}

export function pgBuildListTables(): SqlFragment {
  return {
    sql: `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           AND table_schema NOT LIKE 'pg_toast%'
           AND table_type = 'BASE TABLE'
         ORDER BY table_schema, table_name`,
    params: [],
  };
}

export function pgBuildListAllColumns(): SqlFragment {
  return {
    sql: `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable,
           EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = c.table_schema
               AND tc.table_name = c.table_name
               AND kcu.column_name = c.column_name
           ) AS is_primary_key
         FROM information_schema.columns c
         WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
           AND c.table_schema NOT LIKE 'pg_toast%'
         ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    params: [],
  };
}

export function pgBuildListColumns(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT
         c.column_name,
         c.data_type,
         c.is_nullable,
         EXISTS (
           SELECT 1
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
             AND tc.table_schema = c.table_schema
             AND tc.table_name = c.table_name
             AND kcu.column_name = c.column_name
         ) AS is_primary_key
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
    params: [ref.namespace, ref.name],
  };
}

export function pgBuildListIndexes(ref: TableRef): SqlFragment {
  return {
    sql: `SELECT
         i.relname                       AS name,
         ix.indisunique                  AS is_unique,
         ix.indisprimary                 AS is_primary,
         am.amname                       AS method,
         pg_get_indexdef(ix.indexrelid)  AS definition,
         ARRAY(
           SELECT a.attname
           FROM   pg_attribute a
           WHERE  a.attrelid = t.oid
             AND  a.attnum   = ANY(ix.indkey)
           ORDER BY array_position(ix.indkey::int[], a.attnum)
         )::text[] AS columns
       FROM   pg_index     ix
       JOIN   pg_class     t  ON t.oid  = ix.indrelid
       JOIN   pg_class     i  ON i.oid  = ix.indexrelid
       JOIN   pg_namespace n  ON n.oid  = t.relnamespace
       JOIN   pg_am        am ON am.oid = i.relam
       WHERE  n.nspname = $1
         AND  t.relname = $2
       ORDER BY ix.indisprimary DESC, i.relname`,
    params: [ref.namespace, ref.name],
  };
}

export { qualify as pgQualify };
