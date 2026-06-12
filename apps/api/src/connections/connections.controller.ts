import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { ConnectionDto, TestConnectionResult } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from './connections.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ConnectionDto[]> {
    return this.connectionsService.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConnectionDto): Promise<ConnectionDto> {
    return this.connectionsService.create(user.userId, dto);
  }

  @Post('test')
  test(@CurrentUser() user: AuthenticatedUser, @Body() dto: TestConnectionDto): Promise<TestConnectionResult> {
    return this.connectionsService.test(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConnectionDto,
  ): Promise<ConnectionDto> {
    return this.connectionsService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.connectionsService.remove(user.userId, id);
  }
}
