import { Injectable } from '@nestjs/common';
import type { UserPreference } from '@prisma/client';
import type {
  ColumnRenderOverrides,
  ConnectionThemeOverride,
  CustomPalette,
  KeybindingMap,
  UserPreferenceDto,
} from '@prost/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import {
  validateColumnRenderOverrides,
  validateConnectionOverrides,
  validateCustomPalettes,
  validateKeybindings,
} from './preference-validation';

const DEFAULTS: UserPreferenceDto = {
  colorMode: 'system',
  accentColor: '#498fff',
  fontSize: 'md',
  gridDensity: 'normal',
  keybindings: {},
  customPalettes: [],
  connectionOverrides: {},
  columnRenderOverrides: {},
};

@Injectable()
export class PreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserPreferenceDto> {
    const row = await this.prisma.userPreference.findUnique({ where: { userId } });
    return row ? toUserPreferenceDto(row) : DEFAULTS;
  }

  async update(userId: string, dto: UpdatePreferenceDto): Promise<UserPreferenceDto> {
    // Deep-validate + serialize the JSON-backed fields (400 on bad shape, before any write).
    const data = toRowData(dto);
    const row = await this.prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        colorMode: dto.colorMode ?? DEFAULTS.colorMode,
        accentColor: dto.accentColor ?? DEFAULTS.accentColor,
        fontSize: dto.fontSize ?? DEFAULTS.fontSize,
        gridDensity: dto.gridDensity ?? DEFAULTS.gridDensity,
        ...data,
      },
      update: data,
    });
    return toUserPreferenceDto(row);
  }
}

// All persisted columns are TEXT, so a plain string record is valid for both `create` and `update`.
type PreferenceRowData = Partial<
  Record<
    | 'colorMode'
    | 'accentColor'
    | 'fontSize'
    | 'gridDensity'
    | 'keybindings'
    | 'customPalettes'
    | 'connectionOverrides'
    | 'columnRenderOverrides',
    string
  >
>;

/** Maps a partial update DTO to the Prisma row shape, JSON-stringifying (and validating) the
 *  structured fields. Only keys present on the DTO are included, preserving PATCH semantics. */
function toRowData(dto: UpdatePreferenceDto): PreferenceRowData {
  const data: PreferenceRowData = {};
  if (dto.colorMode !== undefined) data.colorMode = dto.colorMode;
  if (dto.accentColor !== undefined) data.accentColor = dto.accentColor;
  if (dto.fontSize !== undefined) data.fontSize = dto.fontSize;
  if (dto.gridDensity !== undefined) data.gridDensity = dto.gridDensity;
  if (dto.keybindings !== undefined) data.keybindings = JSON.stringify(validateKeybindings(dto.keybindings));
  if (dto.customPalettes !== undefined) {
    data.customPalettes = JSON.stringify(validateCustomPalettes(dto.customPalettes));
  }
  if (dto.connectionOverrides !== undefined) {
    data.connectionOverrides = JSON.stringify(validateConnectionOverrides(dto.connectionOverrides));
  }
  if (dto.columnRenderOverrides !== undefined) {
    data.columnRenderOverrides = JSON.stringify(validateColumnRenderOverrides(dto.columnRenderOverrides));
  }
  return data;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toUserPreferenceDto(row: UserPreference): UserPreferenceDto {
  return {
    colorMode: row.colorMode as UserPreferenceDto['colorMode'],
    accentColor: row.accentColor,
    fontSize: row.fontSize as UserPreferenceDto['fontSize'],
    gridDensity: row.gridDensity as UserPreferenceDto['gridDensity'],
    keybindings: parseJson<KeybindingMap>(row.keybindings, {}),
    customPalettes: parseJson<CustomPalette[]>(row.customPalettes, []),
    connectionOverrides: parseJson<Record<string, ConnectionThemeOverride>>(row.connectionOverrides, {}),
    columnRenderOverrides: parseJson<ColumnRenderOverrides>(row.columnRenderOverrides, {}),
  };
}
