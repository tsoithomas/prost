import { describe, expect, it, vi } from 'vitest';
import type { UserPreference } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PreferenceService, toUserPreferenceDto } from './preference.service';

function buildRow(overrides: Partial<UserPreference> = {}): UserPreference {
  return { userId: 'user-1', colorMode: 'dark', accentColor: '#abcdef', ...overrides };
}

function createService(findUnique = vi.fn(), upsert = vi.fn()) {
  const prisma = { userPreference: { findUnique, upsert } } as unknown as PrismaService;
  return { service: new PreferenceService(prisma), findUnique, upsert };
}

describe('toUserPreferenceDto', () => {
  it('maps a UserPreference row to a UserPreferenceDto', () => {
    expect(toUserPreferenceDto(buildRow())).toEqual({ colorMode: 'dark', accentColor: '#abcdef' });
  });
});

describe('PreferenceService.get', () => {
  it('returns schema defaults when no row exists', async () => {
    const { service, findUnique } = createService(vi.fn().mockResolvedValue(null));

    const result = await service.get('user-1');

    expect(result).toEqual({ colorMode: 'system', accentColor: '#498fff' });
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('returns the stored row when it exists', async () => {
    const { service } = createService(vi.fn().mockResolvedValue(buildRow()));

    expect(await service.get('user-1')).toEqual({ colorMode: 'dark', accentColor: '#abcdef' });
  });
});

describe('PreferenceService.update', () => {
  it('upserts with defaults on create and the given fields on update, scoped to the user', async () => {
    const { service, upsert } = createService(
      undefined,
      vi.fn().mockResolvedValue(buildRow({ colorMode: 'light' })),
    );

    const result = await service.update('user-1', { colorMode: 'light' });

    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1', colorMode: 'light', accentColor: '#498fff' },
      update: { colorMode: 'light' },
    });
    expect(result).toEqual({ colorMode: 'light', accentColor: '#abcdef' });
  });
});
