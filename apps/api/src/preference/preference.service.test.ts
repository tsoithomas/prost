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
    columnRenderOverrides: '{"conn-1":{"public.orders":{"created_at":"date"}}}',
    maskedColumns: '{"conn-1":{"public.users":["email"]}}',
    fontFamily: null,
    monoFontFamily: null,
    radiusScale: 'normal',
    dataColors: '{}',
    editor: '{}',
    grid: '{}',
    behavior: '{}',
    reduceMotion: false,
    aiEnabled: true,
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
      columnRenderOverrides: { 'conn-1': { 'public.orders': { created_at: 'date' } } },
      maskedColumns: { 'conn-1': { 'public.users': ['email'] } },
      fontFamily: undefined,
      monoFontFamily: undefined,
      radiusScale: 'normal',
      dataColors: {},
      editor: {},
      grid: {},
      behavior: {},
      reduceMotion: false,
      aiEnabled: true,
    });
  });

  it('parses the nested preference clusters (editor/grid/behavior) and flat flags', () => {
    const dto = toUserPreferenceDto(
      buildRow({
        editor: '{"minimap":true,"tabSize":4}',
        grid: '{"nullDisplay":"upper","pageSize":200}',
        behavior: '{"confirmWrites":true}',
        reduceMotion: true,
        aiEnabled: false,
      }),
    );
    expect(dto.editor).toEqual({ minimap: true, tabSize: 4 });
    expect(dto.grid).toEqual({ nullDisplay: 'upper', pageSize: 200 });
    expect(dto.behavior).toEqual({ confirmWrites: true });
    expect(dto.reduceMotion).toBe(true);
    expect(dto.aiEnabled).toBe(false);
  });

  it('maps the fine-tune styling fields (font, radius, data colors)', () => {
    const dto = toUserPreferenceDto(
      buildRow({ fontFamily: 'serif', monoFontFamily: 'fira-code', radiusScale: 'roomy', dataColors: '{"number":"#123456"}' }),
    );
    expect(dto.fontFamily).toBe('serif');
    expect(dto.monoFontFamily).toBe('fira-code');
    expect(dto.radiusScale).toBe('roomy');
    expect(dto.dataColors).toEqual({ number: '#123456' });
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
      columnRenderOverrides: {},
      maskedColumns: {},
      radiusScale: 'normal',
      dataColors: {},
      editor: {},
      grid: {},
      behavior: {},
      reduceMotion: false,
      aiEnabled: true,
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
        radiusScale: 'normal',
      },
      update: { colorMode: 'light' },
    });
  });

  it('passes through fine-tune fields and stringifies dataColors', async () => {
    const { service, upsert } = createService(undefined, vi.fn().mockResolvedValue(buildRow()));

    await service.update('user-1', {
      fontFamily: 'serif',
      radiusScale: 'roomy',
      dataColors: { number: '#123456' },
    });

    const call = upsert.mock.calls[0]![0];
    expect(call.update.fontFamily).toBe('serif');
    expect(call.update.radiusScale).toBe('roomy');
    expect(call.update.dataColors).toBe('{"number":"#123456"}');
  });

  it('rejects an invalid data color before any write', async () => {
    const upsert = vi.fn();
    const { service } = createService(undefined, upsert);

    await expect(service.update('user-1', { dataColors: { number: 'blue' } })).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('validates + stringifies the nested clusters and passes flat flags through', async () => {
    const { service, upsert } = createService(undefined, vi.fn().mockResolvedValue(buildRow()));

    await service.update('user-1', {
      editor: { minimap: true },
      grid: { pageSize: 500 },
      reduceMotion: true,
      aiEnabled: false,
    });

    const call = upsert.mock.calls[0]![0];
    expect(call.update.editor).toBe('{"minimap":true}');
    expect(call.update.grid).toBe('{"pageSize":500}');
    expect(call.update.reduceMotion).toBe(true);
    expect(call.update.aiEnabled).toBe(false);
  });

  it('rejects an invalid nested cluster value before any write', async () => {
    const upsert = vi.fn();
    const { service } = createService(undefined, upsert);

    // Cast past the compile-time enum to exercise the runtime validator with an out-of-range value.
    await expect(service.update('user-1', { grid: { pageSize: 999 as unknown as 100 } })).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
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
