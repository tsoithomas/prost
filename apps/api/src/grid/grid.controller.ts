import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { GridResponse } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { GetRowsQueryDto } from './dto/get-rows-query.dto';
import { RowDeleteDto } from './dto/row-delete.dto';
import { RowInsertDto } from './dto/row-insert.dto';
import { RowUpdateDto } from './dto/row-update.dto';
import { GridService } from './grid.service';

@Controller('connections')
export class GridController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly gridService: GridService,
  ) {}

  @Get(':id/tables/:schema/:table/rows')
  async getRows(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Query() query: GetRowsQueryDto,
  ): Promise<GridResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.gridService.getRows(id, schema, table, {
      limit: query.limit,
      offset: query.offset,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      filter: query.filter,
    });
  }

  @Patch(':id/tables/:schema/:table/rows')
  async updateRow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Body() dto: RowUpdateDto,
  ): Promise<Record<string, unknown>> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.gridService.updateCell(id, schema, table, dto);
  }

  @Post(':id/tables/:schema/:table/rows')
  @HttpCode(201)
  async insertRow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Body() dto: RowInsertDto,
  ): Promise<Record<string, unknown>> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.gridService.insertRow(id, schema, table, dto);
  }

  @Delete(':id/tables/:schema/:table/rows')
  @HttpCode(204)
  async deleteRow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Body() dto: RowDeleteDto,
  ): Promise<void> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.gridService.deleteRow(id, schema, table, dto);
  }
}
