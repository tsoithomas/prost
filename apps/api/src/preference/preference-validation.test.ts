import { describe, expect, it } from 'vitest';
import {
  validateBehaviorPrefs,
  validateColumnRenderOverrides,
  validateConnectionOverrides,
  validateCustomPalettes,
  validateDataColors,
  validateEditorPrefs,
  validateGridPrefs,
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

describe('validateDataColors', () => {
  it('accepts known keys with valid hex colors', () => {
    const colors = { number: '#0969da', string: '#1a7f37' };
    expect(validateDataColors(colors)).toEqual(colors);
  });

  it('accepts an empty map', () => {
    expect(validateDataColors({})).toEqual({});
  });

  it('rejects an unknown data color key', () => {
    expect(() => validateDataColors({ rainbow: '#000000' })).toThrow(/Unknown data color key/);
  });

  it('rejects an invalid hex color', () => {
    expect(() => validateDataColors({ number: 'blue' })).toThrow(/Invalid color/);
  });
});

describe('validateEditorPrefs', () => {
  it('accepts valid editor prefs', () => {
    const prefs = { fontSize: 'lg', tabSize: 4, minimap: true, lineNumbers: 'relative', formatOnRun: true };
    expect(validateEditorPrefs(prefs)).toEqual(prefs);
  });
  it('rejects an invalid enum value', () => {
    expect(() => validateEditorPrefs({ tabSize: 3 })).toThrow(/Invalid tabSize/);
    expect(() => validateEditorPrefs({ lineNumbers: 'sometimes' })).toThrow(/Invalid lineNumbers/);
  });
  it('rejects a non-boolean flag', () => {
    expect(() => validateEditorPrefs({ minimap: 'yes' })).toThrow(/minimap must be a boolean/);
  });
});

describe('validateGridPrefs', () => {
  it('accepts valid grid prefs', () => {
    const prefs = { nullDisplay: 'symbol', booleanDisplay: 'check', pageSize: 200, dateFormat: 'relative', rowNumbers: true, timeZone: 'UTC' };
    expect(validateGridPrefs(prefs)).toEqual(prefs);
  });
  it('rejects an invalid page size / null display', () => {
    expect(() => validateGridPrefs({ pageSize: 123 })).toThrow(/Invalid pageSize/);
    expect(() => validateGridPrefs({ nullDisplay: 'nada' })).toThrow(/Invalid nullDisplay/);
  });
  it('rejects a non-string time zone', () => {
    expect(() => validateGridPrefs({ timeZone: 5 })).toThrow(/timeZone must be a string/);
  });
});

describe('validateBehaviorPrefs', () => {
  it('accepts valid behavior prefs', () => {
    const prefs = { transactionByDefault: true, confirmWrites: false, startupConnection: 'conn-1' };
    expect(validateBehaviorPrefs(prefs)).toEqual(prefs);
  });
  it('rejects a non-string startupConnection', () => {
    expect(() => validateBehaviorPrefs({ startupConnection: 5 })).toThrow(/startupConnection must be a string/);
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
