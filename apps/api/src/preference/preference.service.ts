import { Injectable } from '@nestjs/common';
import type { UserPreference } from '@prisma/client';
import type { UserPreferenceDto } from '@prost/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePreferenceDto } from './dto/update-preference.dto';

const DEFAULTS: UserPreferenceDto = { colorMode: 'system', accentColor: '#498fff' };

@Injectable()
export class PreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserPreferenceDto> {
    const row = await this.prisma.userPreference.findUnique({ where: { userId } });
    return row ? toUserPreferenceDto(row) : DEFAULTS;
  }

  async update(userId: string, dto: UpdatePreferenceDto): Promise<UserPreferenceDto> {
    const row = await this.prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        colorMode: dto.colorMode ?? DEFAULTS.colorMode,
        accentColor: dto.accentColor ?? DEFAULTS.accentColor,
      },
      update: dto,
    });
    return toUserPreferenceDto(row);
  }
}

export function toUserPreferenceDto(row: UserPreference): UserPreferenceDto {
  return {
    colorMode: row.colorMode as UserPreferenceDto['colorMode'],
    accentColor: row.accentColor,
  };
}
