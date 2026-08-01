import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { IconButton, Tooltip } from '@prost/ui';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Advances fake timers inside `act()` so the resulting state update flushes to the DOM. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('Tooltip', () => {
  it('shows on focus (not just hover) and sets aria-describedby', () => {
    render(
      <Tooltip content="Refresh data">
        <IconButton aria-label="Refresh">R</IconButton>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.focus(button);
    advance(500);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Refresh data');
    expect(button).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('closes on Escape', () => {
    render(
      <Tooltip content="Refresh data">
        <IconButton aria-label="Refresh">R</IconButton>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.focus(button);
    advance(500);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders a passed shortcut chord', () => {
    render(
      <Tooltip content="Refresh data" shortcut="Alt+R">
        <IconButton aria-label="Refresh">R</IconButton>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Refresh' }));
    advance(500);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Alt+R');
  });

  it('never shows on touch-primary devices', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(hover: none)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    render(
      <Tooltip content="Refresh data">
        <IconButton aria-label="Refresh">R</IconButton>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Refresh' }));
    advance(500);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    window.matchMedia = originalMatchMedia;
  });
});
