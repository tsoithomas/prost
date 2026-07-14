import { Injectable } from '@nestjs/common';
import type { TableOverview } from '@prost/shared-types';
import { MetadataService } from '../metadata/metadata.service';

// Character cap for the table-name index. Names are cheap, so this only bites on pathologically
// large schemas; env-configurable, and a per-endpoint override can layer on top.
const DEFAULT_TOKEN_BUDGET_CHARS = Number(process.env['AI_CONTEXT_BUDGET_CHARS']) || 24_000;

// Hard safety cap on how many table names to list, independent of the char budget.
const MAX_INDEX_TABLES = 5_000;
// Cap tables described in a single get_table_schema call.
const MAX_TOOL_TABLES = 15;

const FORBIDDEN_CONTEXT_PATTERNS = ['password', 'secret', 'api_key', 'token', 'credential'];

interface TableRef {
  schema: string;
  name: string;
}

@Injectable()
export class RetrievalService {
  constructor(private readonly metadataService: MetadataService) {}

  /**
   * The schema context is a **names-only index of every table** in the database — no columns, no
   * foreign keys, no row counts. The model pulls a table's detail on demand via the
   * `get_table_schema` tool (see `describeTables`). This keeps every request cheap regardless of
   * schema size while still telling the model exactly what tables exist, so it never wrongly claims
   * a table is missing. Schema metadata only — never row values (principle §1).
   */
  async buildContext(
    connectionId: string,
    opts: { maxChars?: number } = {},
  ): Promise<string> {
    const maxChars = opts.maxChars ?? DEFAULT_TOKEN_BUDGET_CHARS;
    const schemas = await this.metadataService.getSchemas(connectionId);
    const tables: TableRef[] = schemas.flatMap((s) =>
      s.tables.map((t) => ({ schema: s.name, name: t.name })),
    );
    if (tables.length === 0) return '';

    const header = `-- All ${tables.length} tables in the database. Columns are NOT shown here — call the get_table_schema tool for a table's columns and foreign keys before referencing it.`;
    const lines: string[] = [];
    let total = header.length;
    let shown = 0;
    for (const t of tables) {
      if (shown >= MAX_INDEX_TABLES) break;
      const line = `--   ${t.schema}.${t.name}`;
      if (total + line.length > maxChars) break;
      lines.push(line);
      total += line.length + 1;
      shown += 1;
    }
    if (shown < tables.length) {
      lines.push(`--   … and ${tables.length - shown} more tables (use get_table_schema by name)`);
    }
    return `${header}\n${lines.join('\n')}`;
  }

  /**
   * Renders full CREATE-TABLE-shaped blocks for named tables — the executor behind the
   * `get_table_schema` tool. Resolves `schema.table` or a bare `table` name against the schema list.
   * Includes columns, foreign keys, indexes, and (as comments) the table comment + row estimate.
   * Schema metadata only, same seam as the rest of retrieval — never row values (principle §1).
   */
  async describeTables(connectionId: string, names: string[]): Promise<string> {
    const schemas = await this.metadataService.getSchemas(connectionId);
    const all: TableRef[] = schemas.flatMap((s) =>
      s.tables.map((t) => ({ schema: s.name, name: t.name })),
    );
    const overviewCache = new Map<string, Map<string, TableOverview>>();

    const blocks: string[] = [];
    for (const raw of names.slice(0, MAX_TOOL_TABLES)) {
      const wanted = raw.toLowerCase();
      const match = all.find(
        (t) => `${t.schema}.${t.name}`.toLowerCase() === wanted || t.name.toLowerCase() === wanted,
      );
      if (!match) {
        blocks.push(`-- ${raw}: no such table`);
        continue;
      }
      if (!overviewCache.has(match.schema)) {
        overviewCache.set(match.schema, await this.loadOverview(connectionId, match.schema));
      }
      const structure = await this.metadataService.getTableStructure(
        connectionId,
        match.schema,
        match.name,
      );
      const overview = overviewCache.get(match.schema)!.get(match.name);

      // Columns then foreign keys inside one parenthesized body, so the model reads it as a
      // CREATE TABLE-shaped definition — the FK lines tell it exactly how tables join.
      const lines = structure.columns.map((c) => {
        let col = `  ${c.name} ${c.dataType}`;
        if (c.isPrimaryKey) col += ' PRIMARY KEY';
        else if (!c.nullable) col += ' NOT NULL';
        return col;
      });
      for (const fk of structure.foreignKeys ?? []) {
        const ref = fk.referencedSchema
          ? `${fk.referencedSchema}.${fk.referencedTable}`
          : fk.referencedTable;
        lines.push(
          `  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${ref}(${fk.referencedColumns.join(', ')})`,
        );
      }
      const idxLines = structure.indexes
        .filter((i) => !i.isPrimary)
        .map(
          (i) => `  -- INDEX ${i.name} ON (${i.columns.join(', ')})${i.isUnique ? ' UNIQUE' : ''}`,
        )
        .join('\n');

      let head = `-- ${match.schema}.${match.name}`;
      if (overview?.rowEstimate != null) head += ` (~${overview.rowEstimate} rows)`;
      const commentLine = overview?.comment ? `-- ${overview.comment}\n` : '';
      blocks.push(
        `${head}\n${commentLine}(\n${lines.join(',\n')}\n)` + (idxLines ? `\n${idxLines}` : ''),
      );
    }
    return blocks.join('\n\n') || '-- no tables found';
  }

  /**
   * Best-effort per-schema stats (row estimates + table comments) keyed by table name. Aggregate
   * counts only — never row values (principle §1). A failure never blocks the tool response.
   */
  private async loadOverview(
    connectionId: string,
    schema: string,
  ): Promise<Map<string, TableOverview>> {
    try {
      const overview = await this.metadataService.getSchemaOverview(connectionId, schema);
      return new Map(overview.tables.map((t) => [t.name, t]));
    } catch {
      return new Map();
    }
  }

  // Encodes Decision 1: verify assembled context contains only schema metadata.
  containsOnlySchemaMetadata(context: string): boolean {
    const lc = context.toLowerCase();
    return !FORBIDDEN_CONTEXT_PATTERNS.some((p) => lc.includes(p));
  }
}
