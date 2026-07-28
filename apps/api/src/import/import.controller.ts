import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { ImportBatchResponse, ImportPreviewResponse } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import type { RequestWithCorrelationId } from '../common/correlation-id.middleware';
import { ConnectionsService } from '../connections/connections.service';
import { ImportBatchDto } from './dto/import-batch.dto';
import { ImportPreviewDto } from './dto/import-preview.dto';
import { ImportService } from './import.service';

@Controller('connections')
export class ImportController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly importService: ImportService,
  ) {}

  /** Validate a mapping against live metadata and return the INSERT shape + any issues (no execution). */
  @Post(':id/import/preview')
  @HttpCode(200)
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ImportPreviewDto,
  ): Promise<ImportPreviewResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.importService.preview(id, dto);
  }

  /** Insert one batch of parsed rows atomically. Rejected on a read-only connection (Phase 25). */
  @Post(':id/import/batch')
  async batch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ImportBatchDto,
    @Req() req: RequestWithCorrelationId,
  ): Promise<ImportBatchResponse> {
    await this.connectionsService.assertOwnership(user.userId, id);
    return this.importService.batch(id, dto, { userId: user.userId, correlationId: req.correlationId });
  }
}
