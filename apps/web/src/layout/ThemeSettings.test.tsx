import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KeybindingSettings } from './KeybindingSettings';
import { PaletteSettings } from './PaletteSettings';
import { useThemeStore } from '../stores/themeStore';

afterEach(() => {
  useThemeStore.setState({ accentColor: '#498fff', customPalettes: [], activePaletteName: null });
  localStorage.clear();
});

describe('PaletteSettings', () => {
  it('rejects an invalid custom accent hex with a clear message', () => {
    render(<PaletteSettings save={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Custom accent hex'), { target: { value: 'red' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByText(/not a valid hex color/i)).toBeInTheDocument();
  });

  it('renders a native color-picker swatch alongside the accent hex field', () => {
    render(<PaletteSettings save={vi.fn()} />);
    const swatch = screen.getByLabelText('Custom accent hex picker') as HTMLInputElement;
    expect(swatch).toBeInTheDocument();
    expect(swatch.type).toBe('color');
  });

  it('saves a valid palette and clears the form', () => {
    const save = vi.fn();
    render(<PaletteSettings save={save} />);

    fireEvent.change(screen.getByLabelText('New palette name'), { target: { value: 'Prod' } });
    fireEvent.change(screen.getByLabelText('accent color'), { target: { value: '#ff0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add palette' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ customPalettes: [{ name: 'Prod', colors: { accent: '#ff0000' } }] }),
    );
  });

  it('rejects a duplicate palette name', () => {
    useThemeStore.setState({ customPalettes: [{ name: 'Prod', colors: { accent: '#ff0000' } }] });
    const save = vi.fn();
    render(<PaletteSettings save={save} />);

    fireEvent.change(screen.getByLabelText('New palette name'), { target: { value: 'Prod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add palette' }));

    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('KeybindingSettings', () => {
  it('warns when two actions share a chord', () => {
    render(<KeybindingSettings keybindings={{ 'run-statement': 'mod+k' }} onChange={vi.fn()} />);
    expect(screen.getByText(/Conflict/i)).toBeInTheDocument();
  });

  it('reset-to-defaults clears the override map', () => {
    const onChange = vi.fn();
    render(<KeybindingSettings keybindings={{ 'run-statement': 'mod+p' }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
