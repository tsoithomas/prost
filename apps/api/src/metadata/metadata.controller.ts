import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import type { SchemaMetadata, SchemaObjectDetail, SchemaObjectKind, SchemaOverview, TableStructure } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { MetadataService } from './metadata.service';

const OBJECT_KINDS: ReadonlySet<SchemaObjectKind> = new Set([
  'view', 'materializedView', 'sequence', 'function', 'procedure', 'trigger', 'enum',
]);

@Controller('connections')
export class MetadataController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly metadataService: MetadataService,
  ) {}

  @Get(':id/metadata')
  async getMetadata(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SchemaMetadata[]> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.metadataService.getSchemas(id);
  }

  @Get(':id/schemas/:schema/overview')
  async getSchemaOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
  ): Promise<SchemaOverview> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.metadataService.getSchemaOverview(id, schema);
  }

  @Get(':id/tables/:schema/:table/structure')
  async getTableStructure(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
  ): Promise<TableStructure> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.metadataService.getTableStructure(id, schema, table);
  }

  @Get(':id/schemas/:schema/objects/:kind/:name')
  async getObjectDefinition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('kind') kind: string,
    @Param('name') name: string,
  ): Promise<SchemaObjectDetail> {
    await this.connectionsService.assertOwnership(user.userId, id);
    if (!OBJECT_KINDS.has(kind as SchemaObjectKind)) {
      throw new BadRequestException(`Unknown schema object kind "${kind}"`);
    }
    return this.metadataService.getObjectDefinition(id, schema, kind as SchemaObjectKind, name);
  }
}
