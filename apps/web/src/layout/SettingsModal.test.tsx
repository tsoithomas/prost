import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { useSettingsStore } from '../stores/settingsStore';
import { useThemeStore } from '../stores/themeStore';

const mutate = vi.fn();
vi.mock('../api/preferences', () => ({
  useUpdatePreferences: () => ({ mutate }),
  usePreferences: () => ({ refetch: vi.fn().mockResolvedValue({}) }),
}));
// Sections read connections (react-query); stub them to keep this provider-free.
vi.mock('../api/connections', () => ({ useActiveConnection: () => undefined, useConnections: () => ({ data: [] }) }));

function open(section = 'appearance') {
  useSettingsStore.getState().openSettings(section);
}

beforeEach(() => {
  mutate.mockClear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-reduce-motion');
  useThemeStore.setState({ editor: {}, grid: {}, behavior: {}, reduceMotion: false, aiEnabled: true });
});
afterEach(() => {
  useSettingsStore.setState({ open: false });
});

describe('SettingsModal', () => {
  it('is hidden until opened, then shows the section nav', () => {
    const { rerender } = render(<SettingsModal />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    open();
    rerender(<SettingsModal />);
    expect(screen.getByRole('tab', { name: /appearance/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^grid$/i })).toBeInTheDocument();
  });

  it('applies a new font family live and persists it', () => {
    open();
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Serif' }));

    expect(document.documentElement.style.getPropertyValue('--font-sans')).toMatch(/serif/i);
    expect(useThemeStore.getState().fontFamily).toBe('serif');
    expect(mutate).toHaveBeenCalledWith({ fontFamily: 'serif' }, expect.anything());
  });

  it('has separate Theme, Editor and Grid sections', () => {
    open();
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('tab', { name: /theme/i }));
    expect(screen.getByText('Color mode')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^editor$/i }));
    expect(screen.getByText('Editor font')).toBeInTheDocument();
    expect(screen.queryByText('Grid density')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^grid$/i }));
    expect(screen.getByText('Grid density')).toBeInTheDocument();
  });

  it('filters controls by the search box', () => {
    open();
    render(<SettingsModal />);
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'font' } });
    expect(screen.getByText('Font size')).toBeInTheDocument();
    expect(screen.queryByText('Color mode')).not.toBeInTheDocument();
  });

  it('resets appearance to defaults', () => {
    useThemeStore.getState().setFontFamily('serif');
    open();
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('button', { name: /reset appearance/i }));

    expect(useThemeStore.getState().fontFamily).toBe('inter');
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ fontFamily: 'inter' }), expect.anything());
  });

  it('toggles an editor option (minimap) and persists it', () => {
    open('editor');
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('checkbox', { name: /minimap/i }));

    expect(useThemeStore.getState().editor.minimap).toBe(true);
    expect(mutate).toHaveBeenCalledWith({ editor: { minimap: true } }, expect.anything());
  });

  it('changes the NULL display and persists it', () => {
    open('grid');
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'NULL' }));

    expect(useThemeStore.getState().grid.nullDisplay).toBe('upper');
    expect(mutate).toHaveBeenCalledWith({ grid: { nullDisplay: 'upper' } }, expect.anything());
  });

  it('applies reduce motion and persists it', () => {
    open('appearance');
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('checkbox', { name: /reduce motion/i }));

    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true);
    expect(mutate).toHaveBeenCalledWith({ reduceMotion: true }, expect.anything());
  });

  it('closes on Escape (Modal focus trap)', () => {
    open();
    render(<SettingsModal />);
    expect(useSettingsStore.getState().open).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useSettingsStore.getState().open).toBe(false);
  });
});
