import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShortcutsHelp } from './ShortcutsHelp';
import { useShortcutsStore } from '../stores/shortcutsStore';
import { useThemeStore } from '../stores/themeStore';

afterEach(() => {
  useShortcutsStore.setState({ open: false });
  useThemeStore.setState({ keybindings: {} });
});

describe('ShortcutsHelp', () => {
  it('is hidden until opened', () => {
    render(<ShortcutsHelp />);
    expect(screen.queryByText('New query tab')).not.toBeInTheDocument();
  });

  it('lists every action with its resolved (default) chord', () => {
    useShortcutsStore.setState({ open: true });
    render(<ShortcutsHelp />);
    expect(screen.getByText('Open command palette')).toBeInTheDocument();
    expect(screen.getByText('New query tab')).toBeInTheDocument();
    // Default chord alt+t → "Alt+T" on a non-mac test environment.
    expect(screen.getByText('Alt+T')).toBeInTheDocument();
  });

  it('reflects a remapped chord from preferences', () => {
    useThemeStore.setState({ keybindings: { 'new-query-tab': 'mod+shift+p' } });
    useShortcutsStore.setState({ open: true });
    render(<ShortcutsHelp />);
    expect(screen.getByText('Ctrl+Shift+P')).toBeInTheDocument();
  });
});
