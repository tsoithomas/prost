import { describe, expect, it, vi } from 'vitest';
import type { UserPreference } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PreferenceService, toUserPreferenceDto } from './preference.service';

function buildRow(overrides: Partial<UserPreference> = {}): UserPreference {
  return {
    userId: 'user-1',
    colorMode: 'dark',
    accentColor: '#abcdef',
    fontSize: 'lg',
    gridDensity: 'compact',
    keybindings: '{"run-all":"mod+r"}',
    customPalettes: '[{"name":"Prod","colors":{"accent":"#ff0000"}}]',
    connectionOverrides: '{"conn-1":{"accentColor":"#00ff00"}}',
    ...overrides,
  };
}

function createService(findUnique = vi.fn(), upsert = vi.fn()) {
  const prisma = { userPreference: { findUnique, upsert } } as unknown as PrismaService;
  return { service: new PreferenceService(prisma), findUnique, upsert };
}

describe('toUserPreferenceDto', () => {
  it('maps a UserPreference row to a UserPreferenceDto, parsing the JSON columns', () => {
    expect(toUserPreferenceDto(buildRow())).toEqual({
      colorMode: 'dark',
      accentColor: '#abcdef',
      fontSize: 'lg',
      gridDensity: 'compact',
      keybindings: { 'run-all': 'mod+r' },
      customPalettes: [{ name: 'Prod', colors: { accent: '#ff0000' } }],
      connectionOverrides: { 'conn-1': { accentColor: '#00ff00' } },
    });
  });

  it('falls back to empty structures when a JSON column is malformed', () => {
    const dto = toUserPreferenceDto(buildRow({ keybindings: 'not json', customPalettes: '{' }));
    expect(dto.keybindings).toEqual({});
    expect(dto.customPalettes).toEqual([]);
  });
});

describe('PreferenceService.get', () => {
  it('returns schema defaults when no row exists', async () => {
    const { service, findUnique } = createService(vi.fn().mockResolvedValue(null));

    const result = await service.get('user-1');

    expect(result).toEqual({
      colorMode: 'system',
      accentColor: '#498fff',
      fontSize: 'md',
      gridDensity: 'normal',
      keybindings: {},
      customPalettes: [],
      connectionOverrides: {},
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('returns the stored row when it exists', async () => {
    const { service } = createService(vi.fn().mockResolvedValue(buildRow()));

    expect(await service.get('user-1')).toMatchObject({ colorMode: 'dark', fontSize: 'lg' });
  });
});

describe('PreferenceService.update', () => {
  it('upserts scalar fields scoped to the user, only touching provided keys', async () => {
    const { service, upsert } = createService(
      undefined,
      vi.fn().mockResolvedValue(buildRow({ colorMode: 'light' })),
    );

    await service.update('user-1', { colorMode: 'light' });

    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: {
        userId: 'user-1',
        colorMode: 'light',
        accentColor: '#498fff',
        fontSize: 'md',
        gridDensity: 'normal',
      },
      update: { colorMode: 'light' },
    });
  });

  it('JSON-stringifies the structured fields before persisting', async () => {
    const { service, upsert } = createService(undefined, vi.fn().mockResolvedValue(buildRow()));

    await service.update('user-1', {
      keybindings: { 'run-all': 'mod+r' },
      customPalettes: [{ name: 'Prod', colors: { accent: '#ff0000' } }],
    });

    const call = upsert.mock.calls[0]![0];
    expect(call.update.keybindings).toBe('{"run-all":"mod+r"}');
    expect(call.update.customPalettes).toBe('[{"name":"Prod","colors":{"accent":"#ff0000"}}]');
  });

  it('rejects an invalid custom palette before any write', async () => {
    const upsert = vi.fn();
    const { service } = createService(undefined, upsert);

    await expect(
      service.update('user-1', { customPalettes: [{ name: 'Bad', colors: { accent: 'red' } }] }),
    ).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});
