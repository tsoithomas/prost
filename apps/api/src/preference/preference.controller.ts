import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { UserPreferenceDto } from '@prost/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { PreferenceService } from './preference.service';

@Controller('preferences')
export class PreferenceController {
  constructor(private readonly preferenceService: PreferenceService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser): Promise<UserPreferenceDto> {
    return this.preferenceService.get(user.userId);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePreferenceDto): Promise<UserPreferenceDto> {
    return this.preferenceService.update(user.userId, dto);
  }
}
