import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { GenerateMigrationResponse, SchemaDiff } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { GenerateMigrationDto, SchemaCompareDto } from './dto/schema-diff.dto';
import { SchemaDiffService } from './schema-diff.service';

@Controller('connections')
export class SchemaDiffController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly schemaDiffService: SchemaDiffService,
  ) {}

  /** Live-vs-live schema compare (Phase 42) — nothing persisted, always re-read on request. */
  @Post(':id/schema-diff/compare')
  @HttpCode(200)
  async compare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SchemaCompareDto,
  ): Promise<SchemaDiff> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.schemaDiffService.compare(user.userId, { connectionId: id, schema: dto.schema }, dto.right);
  }

  /** Reconciling change-set, re-validated through the existing DDL preview (Phase 42 Decision 3). */
  @Post(':id/schema-diff/migration')
  @HttpCode(200)
  async migration(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: GenerateMigrationDto,
  ): Promise<GenerateMigrationResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.schemaDiffService.generateMigration(
      user.userId,
      { connectionId: id, schema: dto.schema },
      dto.right,
      dto.source,
    );
  }
}
