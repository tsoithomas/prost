import { Body, Controller, Delete, HttpCode, Patch, Post, Param, Req } from '@nestjs/common';
import type { RequestWithCorrelationId } from '../common/correlation-id.middleware';
import type {
  AlterTableOperation,
  AlterTableResult,
  CreateIndexResult,
  CreateTableResult,
  DdlPreviewRequest,
  DdlPreviewResult,
  DropIndexResult,
  DropTableResult,
  ForeignKeyAction,
  TruncateTableResult,
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
    @Req() req: RequestWithCorrelationId,
  ): Promise<CreateTableResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.createTable(id, dto, { userId: user.userId, correlationId: req.correlationId });
  }

  @Patch(':id/ddl/tables/:schema/:table')
  async alterTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Body() dto: AlterTableDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<AlterTableResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    const operation = this.dtoToOperation(dto);
    return this.ddlService.alterTable(id, { schema, table, operation }, { userId: user.userId, correlationId: req.correlationId });
  }

  @Delete(':id/ddl/tables/:schema/:table')
  async dropTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Req() req: RequestWithCorrelationId,
  ): Promise<DropTableResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.dropTable(id, { schema, table }, { userId: user.userId, correlationId: req.correlationId });
  }

  @Post(':id/ddl/tables/:schema/:table/truncate')
  @HttpCode(200)
  async truncateTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Req() req: RequestWithCorrelationId,
  ): Promise<TruncateTableResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.truncateTable(id, { schema, table }, { userId: user.userId, correlationId: req.correlationId });
  }

  @Post(':id/ddl/indexes')
  @HttpCode(201)
  async createIndex(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateIndexDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<CreateIndexResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.createIndex(id, dto, { userId: user.userId, correlationId: req.correlationId });
  }

  @Delete(':id/ddl/indexes')
  async dropIndex(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DropIndexDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<DropIndexResult> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.ddlService.dropIndex(id, dto, { userId: user.userId, correlationId: req.correlationId });
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
      case 'setComment':
        return {
          kind: 'setComment',
          ...(dto.columnName ? { column: dto.columnName } : {}),
          comment: dto.comment ?? null,
        };
      case 'addForeignKey':
        return {
          kind: 'addForeignKey',
          ...(dto.constraintName ? { constraintName: dto.constraintName } : {}),
          columns: dto.columns!,
          referencedSchema: dto.referencedSchema ?? null,
          referencedTable: dto.referencedTable!,
          referencedColumns: dto.referencedColumns!,
          ...(dto.onDelete ? { onDelete: dto.onDelete as ForeignKeyAction } : {}),
          ...(dto.onUpdate ? { onUpdate: dto.onUpdate as ForeignKeyAction } : {}),
        };
      case 'dropForeignKey':
        return { kind: 'dropForeignKey', constraintName: dto.constraintName! };
      default:
        throw new Error(`Unknown operation kind: ${dto.kind}`);
    }
  }
}
