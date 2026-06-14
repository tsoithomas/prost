import { Injectable } from '@nestjs/common';
import { MetadataService } from '../metadata/metadata.service';

const DEFAULT_TOKEN_BUDGET_CHARS = 8_000;

const FORBIDDEN_CONTEXT_PATTERNS = ['password', 'secret', 'api_key', 'token', 'credential'];

@Injectable()
export class RetrievalService {
  constructor(private readonly metadataService: MetadataService) {}

  async buildContext(
    connectionId: string,
    maxChars = DEFAULT_TOKEN_BUDGET_CHARS,
  ): Promise<string> {
    const schemas = await this.metadataService.getSchemas(connectionId);
    const blocks: string[] = [];
    let total = 0;

    outer: for (const schema of schemas) {
      for (const table of schema.tables) {
        const structure = await this.metadataService.getTableStructure(
          connectionId,
          schema.name,
          table.name,
        );

        const cols = structure.columns
          .map((c) => {
            let col = `  ${c.name} ${c.dataType}`;
            if (c.isPrimaryKey) col += ' PRIMARY KEY';
            else if (!c.nullable) col += ' NOT NULL';
            return col;
          })
          .join(',\n');

        const idxLines = structure.indexes
          .filter((i) => !i.isPrimary)
          .map(
            (i) =>
              `  -- INDEX ${i.name} ON (${i.columns.join(', ')})${i.isUnique ? ' UNIQUE' : ''}`,
          )
          .join('\n');

        const block =
          `-- ${schema.name}.${table.name}\n(\n${cols}\n)` +
          (idxLines ? `\n${idxLines}` : '');

        if (total + block.length > maxChars) break outer;
        blocks.push(block);
        total += block.length;
      }
    }

    return blocks.join('\n\n');
  }

  // Encodes Decision 1: verify assembled context contains only schema metadata.
  containsOnlySchemaMetadata(context: string): boolean {
    const lc = context.toLowerCase();
    return !FORBIDDEN_CONTEXT_PATTERNS.some((p) => lc.includes(p));
  }
}
