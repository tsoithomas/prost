import { Body, Controller, Delete, HttpCode, Patch, Post, Param } from '@nestjs/common';
import type {
  AlterTableOperation,
  AlterTableResult,
  CreateIndexResult,
  CreateTableResult,
  DdlPreviewRequest,
  DdlPreviewResult,
  DropIndexResult,
} from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { AlterTableDto } from './dto/alter-table.dto';
import { CreateIndexDto } from './dto/create-index.dto';
import { CreateTableDto } from './dto/create-table.dto';
import { AlterTablePreviewRequestDto, DdlPreviewDto } from './dto/ddl-preview.dto';
import { DropIndexDto } from './dto/drop-index.dto';
import { DdlService } from './ddl.service';

@Controller('connections')
export class DdlController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly ddlService: DdlService,
  ) {}

  @Post(':id/ddl/tables')
  @HttpCode(201)
  async createTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateTableDto,
  ): Promise<CreateTableResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.createTable(id, dto);
  }

  @Patch(':id/ddl/tables/:schema/:table')
  async alterTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Body() dto: AlterTableDto,
  ): Promise<AlterTableResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    const operation = this.dtoToOperation(dto);
    return this.ddlService.alterTable(id, { schema, table, operation });
  }

  @Post(':id/ddl/indexes')
  @HttpCode(201)
  async createIndex(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateIndexDto,
  ): Promise<CreateIndexResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.createIndex(id, dto);
  }

  @Delete(':id/ddl/indexes')
  async dropIndex(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DropIndexDto,
  ): Promise<DropIndexResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.dropIndex(id, dto);
  }

  @Post(':id/ddl/preview')
  @HttpCode(200)
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DdlPreviewDto,
  ): Promise<DdlPreviewResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.preview(id, this.dtoToPreviewRequest(dto));
  }

  private dtoToPreviewRequest(dto: DdlPreviewDto): DdlPreviewRequest {
    switch (dto.kind) {
      case 'createTable':
        return { kind: 'createTable', request: dto.request as CreateTableDto };
      case 'alterTable': {
        const request = dto.request as AlterTablePreviewRequestDto;
        return {
          kind: 'alterTable',
          request: {
            schema: request.schema,
            table: request.table,
            operation: this.dtoToOperation(request),
          },
        };
      }
      case 'createIndex':
        return { kind: 'createIndex', request: dto.request as CreateIndexDto };
      case 'dropIndex':
        return { kind: 'dropIndex', request: dto.request as DropIndexDto };
    }
  }

  private dtoToOperation(dto: AlterTableDto): AlterTableOperation {
    switch (dto.kind) {
      case 'addColumn':
        return { kind: 'addColumn', column: dto.column! };
      case 'dropColumn':
        return { kind: 'dropColumn', column: dto.columnName! };
      case 'setNotNull':
        return { kind: 'setNotNull', column: dto.columnName!, notNull: dto.notNull! };
      case 'setDefault':
        return { kind: 'setDefault', column: dto.columnName!, default: dto.default ?? null };
      case 'changeType':
        return { kind: 'changeType', column: dto.columnName!, type: dto.type!, using: dto.using };
      default:
        throw new Error(`Unknown operation kind: ${dto.kind}`);
    }
  }
}
