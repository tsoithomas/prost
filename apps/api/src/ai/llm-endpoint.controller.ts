import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { LlmEndpointDto, LlmProbeResult } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { CreateLlmEndpointDto } from './dto/create-llm-endpoint.dto';
import { ProbeLlmEndpointDto } from './dto/probe-llm-endpoint.dto';
import { UpdateLlmEndpointDto } from './dto/update-llm-endpoint.dto';
import { LlmEndpointService } from './llm-endpoint.service';

@Controller('llm-endpoints')
export class LlmEndpointController {
  constructor(private readonly llmEndpointService: LlmEndpointService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<LlmEndpointDto[]> {
    return this.llmEndpointService.list(user.userId);
  }

  /** Best-effort model + context-window discovery from `{baseUrl}/v1/models`, to prefill the modal. */
  @Post('probe')
  @HttpCode(200)
  probe(@Body() dto: ProbeLlmEndpointDto): Promise<LlmProbeResult> {
    return this.llmEndpointService.probe(dto.baseUrl, dto.apiKey);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLlmEndpointDto,
  ): Promise<LlmEndpointDto> {
    return this.llmEndpointService.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLlmEndpointDto,
  ): Promise<LlmEndpointDto> {
    return this.llmEndpointService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.llmEndpointService.remove(user.userId, id);
  }
}
