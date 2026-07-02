import { Controller, Get, Param } from '@nestjs/common';
import type { SchemaMetadata, SchemaOverview, TableStructure } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { MetadataService } from './metadata.service';

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
}
