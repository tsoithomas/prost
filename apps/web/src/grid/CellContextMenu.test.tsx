import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellContextMenu, type CellMenuItem } from './CellContextMenu';

describe('CellContextMenu — generic actions (Phase 40)', () => {
  it('always renders generic actions, even with no FK targets', () => {
    const items: CellMenuItem[] = [
      { kind: 'copy', label: 'Copy value', onSelect: vi.fn() },
      { kind: 'filter', label: 'Filter by this value', onSelect: vi.fn() },
    ];
    render(<CellContextMenu state={{ x: 0, y: 0, items }} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Copy value' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter by this value' })).toBeInTheDocument();
  });

  it('calls onSelect and closes when an item is clicked', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const items: CellMenuItem[] = [{ kind: 'copy', label: 'Copy value', onSelect }];
    render(<CellContextMenu state={{ x: 0, y: 0, items }} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy value' }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('draws a separator ahead of FK targets that follow generic actions', () => {
    const items: CellMenuItem[] = [
      { kind: 'copy', label: 'Copy value', onSelect: vi.fn() },
      { direction: 'forward', label: 'Open referenced row in users', separatorBefore: true, onSelect: vi.fn() },
    ];
    const { container } = render(<CellContextMenu state={{ x: 0, y: 0, items }} onClose={vi.fn()} />);
    // Exactly one divider: before the first (and only) FK entry, none before the generic action.
    expect(container.querySelectorAll('.bg-border').length).toBe(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    const items: CellMenuItem[] = [{ kind: 'copy', label: 'Copy value', onSelect: vi.fn() }];
    render(<CellContextMenu state={{ x: 0, y: 0, items }} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<CellContextMenu state={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
