import { Body, Controller, HttpException, Logger, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { ConnectionsService } from '../connections/connections.service';
import { ExportDto } from './dto/export.dto';
import { ExportService } from './export.service';

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  sql: 'application/sql; charset=utf-8',
};

@Controller('connections')
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly exportService: ExportService,
  ) {}

  /**
   * Stream a table or query result as CSV/JSON. Read-safe — no `assertWritable`, so export stays
   * available on read-only connections. Validation runs eagerly (`prepare`) so an unknown table / bad
   * filter / non-SELECT returns a clean JSON error *before* any bytes are written; once streaming has
   * begun, a mid-stream failure just ends the response (mirrors the AI SSE pattern).
   */
  @Post(':id/export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ExportDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.connectionsService.assertOwnership(user.userId, id);

    let prepared;
    try {
      prepared = await this.exportService.prepare(id, dto);
    } catch (err) {
      if (err instanceof HttpException) {
        res.status(err.getStatus()).json({ message: err.message });
      } else {
        this.logger.error('Export prepare failed', err instanceof Error ? err.stack : String(err));
        res.status(500).json({ message: 'Export failed.' });
      }
      return;
    }

    res.setHeader('Content-Type', CONTENT_TYPES[dto.format] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${prepared.filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.flushHeaders();

    try {
      await this.exportService.stream({ write: (chunk) => res.write(chunk) }, id, prepared);
    } catch (err) {
      // Headers/first bytes are already sent — we can only log and end the (partial) response.
      this.logger.error('Export stream failed', err instanceof Error ? err.stack : String(err));
    } finally {
      res.end();
    }
  }
}
