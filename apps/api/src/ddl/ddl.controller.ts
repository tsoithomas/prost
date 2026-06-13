import { Body, Controller, HttpCode, Post, Param } from '@nestjs/common';
import type { CreateTableResult } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { CreateTableDto } from './dto/create-table.dto';
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
}
