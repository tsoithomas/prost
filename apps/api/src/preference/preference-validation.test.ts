import { describe, expect, it } from 'vitest';
import {
  validateColumnRenderOverrides,
  validateConnectionOverrides,
  validateCustomPalettes,
  validateKeybindings,
} from './preference-validation';

describe('validateKeybindings', () => {
  it('accepts known actions with well-formed chords', () => {
    const map = { 'run-all': 'mod+shift+enter', 'command-palette': 'mod+k' };
    expect(validateKeybindings(map)).toEqual(map);
  });

  it('rejects an unknown action id', () => {
    expect(() => validateKeybindings({ 'teleport': 'mod+t' })).toThrow(/Unknown keybinding action/);
  });

  it('rejects a malformed chord', () => {
    expect(() => validateKeybindings({ 'run-all': 'banana' })).toThrow(/Invalid chord/);
  });
});

describe('validateCustomPalettes', () => {
  it('accepts a well-formed palette', () => {
    const palettes = [{ name: 'Prod', colors: { accent: '#ff0000', surface: '#111' } }];
    expect(validateCustomPalettes(palettes)).toEqual(palettes);
  });

  it('rejects an unparseable color', () => {
    expect(() => validateCustomPalettes([{ name: 'Bad', colors: { accent: 'red' } }])).toThrow(
      /Invalid color/,
    );
  });

  it('rejects an unknown color key', () => {
    expect(() => validateCustomPalettes([{ name: 'Bad', colors: { shadow: '#000000' } }])).toThrow(
      /Unknown palette color key/,
    );
  });

  it('rejects a palette with a blank name', () => {
    expect(() => validateCustomPalettes([{ name: '  ', colors: {} }])).toThrow(/name is required/);
  });

  it('rejects more than the cap', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ name: `p${i}`, colors: {} }));
    expect(() => validateCustomPalettes(many)).toThrow(/At most/);
  });
});

describe('validateConnectionOverrides', () => {
  it('accepts valid overrides', () => {
    const overrides = { 'conn-1': { accentColor: '#abcdef', colorMode: 'dark' as const } };
    expect(validateConnectionOverrides(overrides)).toEqual(overrides);
  });

  it('rejects an invalid override accent color', () => {
    expect(() => validateConnectionOverrides({ 'conn-1': { accentColor: 'nope' } })).toThrow(
      /Invalid override accentColor/,
    );
  });

  it('rejects an invalid override color mode', () => {
    expect(() => validateConnectionOverrides({ 'conn-1': { colorMode: 'neon' } })).toThrow(
      /Invalid override colorMode/,
    );
  });
});

describe('validateColumnRenderOverrides', () => {
  it('accepts a well-formed nested override map', () => {
    const overrides = {
      'conn-1': { 'public.orders': { created_at: 'date' as const, is_paid: 'boolean' as const } },
    };
    expect(validateColumnRenderOverrides(overrides)).toEqual(overrides);
  });

  it('accepts an empty map', () => {
    expect(validateColumnRenderOverrides({})).toEqual({});
  });

  it('rejects an unknown render mode', () => {
    expect(() => validateColumnRenderOverrides({ 'conn-1': { 'public.orders': { x: 'rainbow' } } })).toThrow(
      /Invalid column render mode/,
    );
  });

  it('rejects a non-object at the table level', () => {
    expect(() => validateColumnRenderOverrides({ 'conn-1': { 'public.orders': 'nope' } })).toThrow(
      /table render-override entry must be an object/,
    );
  });
});
