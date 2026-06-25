import { afterEach, describe, expect, it } from 'vitest';
import { useThemeStore } from './themeStore';

afterEach(() => {
  // Restore a neutral state and clear persisted localStorage key between tests.
  useThemeStore.setState({
    colorMode: 'system',
    accentColor: '#498fff',
    accentFg: '#00285b',
    fontSize: 'md',
    gridDensity: 'normal',
    customPalettes: [],
    activePaletteName: null,
    connectionOverrides: {},
    activeOverrideConnectionId: null,
  });
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
  localStorage.clear();
});

describe('themeStore', () => {
  it('setColorMode updates the colorMode state', () => {
    useThemeStore.getState().setColorMode('dark');
    expect(useThemeStore.getState().colorMode).toBe('dark');
  });

  it('setColorMode persists to localStorage under the prost-theme key', () => {
    useThemeStore.getState().setColorMode('light');
    const raw = localStorage.getItem('prost-theme');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: { colorMode: string } };
    expect(parsed.state.colorMode).toBe('light');
  });

  it('setAccentColor updates accentColor and accentFg state', () => {
    useThemeStore.getState().setAccentColor('#ff0000', '#ffffff');
    const state = useThemeStore.getState();
    expect(state.accentColor).toBe('#ff0000');
    expect(state.accentFg).toBe('#ffffff');
  });

  it('setAccentColor derives accentFg automatically when not provided', () => {
    useThemeStore.getState().setAccentColor('#000000');
    const state = useThemeStore.getState();
    expect(state.accentColor).toBe('#000000');
    // accentFg is derived — just verify it's a non-empty string
    expect(typeof state.accentFg).toBe('string');
    expect(state.accentFg.length).toBeGreaterThan(0);
  });

  it('setFontSize updates state and the root font size, persisting under prost-theme', () => {
    useThemeStore.getState().setFontSize('lg');
    expect(useThemeStore.getState().fontSize).toBe('lg');
    expect(document.documentElement.style.fontSize).toBe('18px');
    const parsed = JSON.parse(localStorage.getItem('prost-theme')!) as { state: { fontSize: string } };
    expect(parsed.state.fontSize).toBe('lg');
  });

  it('setGridDensity updates state and the --grid-spacing token', () => {
    useThemeStore.getState().setGridDensity('comfortable');
    expect(useThemeStore.getState().gridDensity).toBe('comfortable');
    // Density is driven by AG Grid's `spacing` (auto-derives row height + keeps text centered).
    expect(document.documentElement.style.getPropertyValue('--grid-spacing')).toBe('7px');
  });
});

describe('themeStore — per-connection override', () => {
  it('applies an override accent for the active connection and reverts on switch-away', () => {
    useThemeStore.setState({
      accentColor: '#498fff',
      accentFg: '#00285b',
      connectionOverrides: { 'conn-1': { accentColor: '#ff0000' } },
    });

    // Switch to the connection that has an override.
    useThemeStore.getState().applyConnectionTheme('conn-1');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#ff0000');
    expect(useThemeStore.getState().activeOverrideConnectionId).toBe('conn-1');

    // Switch away → reverts to the global accent.
    useThemeStore.getState().applyConnectionTheme(null);
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#498fff');
    expect(useThemeStore.getState().activeOverrideConnectionId).toBeNull();
  });

  it('leaves the live accent untouched when changing the global accent while an override is active', () => {
    useThemeStore.setState({ connectionOverrides: { 'conn-1': { accentColor: '#ff0000' } } });
    useThemeStore.getState().applyConnectionTheme('conn-1');

    useThemeStore.getState().setAccentColor('#00ff00');

    // The override still owns the live accent; the global value is stored but not applied.
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#ff0000');
    expect(useThemeStore.getState().accentColor).toBe('#00ff00');
  });
});
