import { afterEach, describe, expect, it } from 'vitest';
import { useThemeStore } from './themeStore';

afterEach(() => {
  // Restore a neutral state and clear persisted localStorage key between tests.
  useThemeStore.setState({ colorMode: 'system' });
  document.documentElement.classList.remove('dark');
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
});
