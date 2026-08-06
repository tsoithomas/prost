import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  DdlPreviewRequest,
  GenerateMigrationResponse,
  SchemaDiff,
  SchemaDiffChangeItem,
  SchemaRef,
} from '@prost/shared-types';
import { ConnectionsService } from '../connections/connections.service';
import { PoolManager } from '../database/pool-manager.service';
import { MetadataService } from '../metadata/metadata.service';
import { DdlService } from '../ddl/ddl.service';
import { buildMigrationCandidates, buildSchemaDiff, isDestructiveChange, type ResolvedTable } from './diff.util';

@Injectable()
export class SchemaDiffService {
  private readonly logger = new Logger(SchemaDiffService.name);

  constructor(
    private readonly connections: ConnectionsService,
    private readonly pool: PoolManager,
    private readonly metadata: MetadataService,
    private readonly ddl: DdlService,
  ) {}

  /**
   * Both sides are read live and diffed in memory — nothing is persisted (principle §1). A re-compare
   * always re-reads both connections, so the result is only ever as stale as the caller lets it be.
   */
  async compare(userId: string, left: SchemaRef, right: SchemaRef): Promise<SchemaDiff> {
    await this.connections.assertOwnership(userId, left.connectionId);
    await this.connections.assertOwnership(userId, right.connectionId);
    await this.assertSameEngine(left.connectionId, right.connectionId);

    const [leftTables, rightTables] = await Promise.all([
      this.resolveSchemaTables(left.connectionId, left.schema),
      this.resolveSchemaTables(right.connectionId, right.schema),
    ]);

    return buildSchemaDiff(left, leftTables, right, rightTables);
  }

  /**
   * Recomputes the diff itself (never trusts a client-echoed diff — principle §4), builds candidate ops,
   * then re-validates each through the *existing* `DdlService.preview` — the same candidate→preview→
   * drop-on-failure discipline `AiService.suggestSchemaChanges` uses for AI suggestions (Phase 33). A
   * candidate that no longer applies (the live target moved since the diff was computed) is dropped, not
   * surfaced. No SQL is executed here — applying a survivor goes through the normal DDL routes.
   */
  async generateMigration(
    userId: string,
    left: SchemaRef,
    right: SchemaRef,
    source: 'left' | 'right',
  ): Promise<GenerateMigrationResponse> {
    const diff = await this.compare(userId, left, right);
    const targetConnectionId = source === 'left' ? right.connectionId : left.connectionId;
    const candidates = buildMigrationCandidates(diff, source);

    const changes: SchemaDiffChangeItem[] = [];
    for (const change of candidates) {
      try {
        const { sql } = await this.ddl.preview(targetConnectionId, change as DdlPreviewRequest);
        changes.push({ change, sql, destructive: isDestructiveChange(change) });
      } catch (err) {
        this.logger.warn(
          `schema-diff migration candidate dropped kind=${change.kind} connectionId=${targetConnectionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { changes };
  }

  private async assertSameEngine(leftConnectionId: string, rightConnectionId: string): Promise<void> {
    const [leftDriver, rightDriver] = await Promise.all([
      this.pool.driverFor(leftConnectionId),
      this.pool.driverFor(rightConnectionId),
    ]);
    if (leftDriver.descriptor.engine !== rightDriver.descriptor.engine) {
      throw new BadRequestException('Schema comparison requires both connections to use the same engine');
    }
  }

  private async resolveSchemaTables(connectionId: string, schema: string): Promise<ResolvedTable[]> {
    const [schemas, foreignKeys] = await Promise.all([
      this.metadata.getSchemas(connectionId),
      this.metadata.getSchemaForeignKeys(connectionId, schema),
    ]);
    const target = schemas.find((s) => s.name === schema);
    const tables = target?.tables ?? [];

    const fksByTable = new Map<string, typeof foreignKeys>();
    for (const fk of foreignKeys) {
      const list = fksByTable.get(fk.table) ?? [];
      list.push(fk);
      fksByTable.set(fk.table, list);
    }

    return Promise.all(
      tables.map(async (table) => ({
        name: table.name,
        columns: table.columns,
        indexes: await this.metadata.getTableIndexes(connectionId, schema, table.name),
        foreignKeys: fksByTable.get(table.name) ?? [],
      })),
    );
  }
}
